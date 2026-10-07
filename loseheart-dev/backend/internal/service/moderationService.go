package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/model"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ModeratePost 在同一事务中下架帖子、取消待处理审核，并写入通知和操作记录。
// 下架只改变审核状态，已完成时间、内容版本和历史审核结论均保留。
func ModeratePost(
	ctx context.Context,
	actor entity.AuthUser,
	postID uint64,
	etag string,
	input dto.PostModerationDTO,
) (*vo.PostStateResponseVO, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	pointer, err := moderationPostPointer(db, postID)
	if err != nil {
		return nil, err
	}

	var result vo.PostStateResponseVO
	err = WriteTransactionWithUsers(ctx, actor, true, []uint64{pointer.AuthorID}, func(tx *gorm.DB) error {
		post, err := lockModerationPost(tx, postID)
		if err != nil {
			return err
		}

		if etag != PostETag(post) {
			return errs.ResourceChangedError
		}

		if post.ResolutionStatus == "withdrawn" {
			return errs.StateConflictError
		}

		if err := removePostInTransaction(tx, actor.ID, &post, input.Reason, nil); err != nil {
			return err
		}

		result = PostState(post)
		return nil
	})

	return &result, err
}

// ListReviews 默认只展示可以处理的当前 pending 版本；历史筛选保留不可变提交快照。
func ListReviews(
	ctx context.Context,
	input dto.ReviewQueryDTO,
) (*vo.PageResultVO[vo.ReviewRecordVO], error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	decision := input.Decision
	if decision == "" {
		decision = "pending"
	}

	query := db.Table("post_reviews AS r").
		Where("r.decision = ?", decision)
	if input.PostID != "" {
		query = query.Where("r.post_id = ?", input.PostID)
	}
	if decision == "pending" {
		query = query.Joins("JOIN posts AS p ON p.id = r.post_id").
			Joins("JOIN users AS u ON u.id = p.author_id").
			Where("r.revision = p.revision AND p.review_status = ? AND p.resolution_status <> ?", "pending", "withdrawn").
			Where("u.status = ? AND u.is_verified = ?", "active", true)
	}

	page, pageSize := PageValues(input.PageQueryDTO)
	result := &vo.PageResultVO[vo.ReviewRecordVO]{
		Page:     page,
		PageSize: pageSize,
		Records:  make([]vo.ReviewRecordVO, 0),
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return nil, moderationDatabaseError(err)
	}

	var records []entity.PostReview
	if err := query.Select("r.*").
		Order("r.submitted_at ASC, r.id ASC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&records).Error; err != nil {
		return nil, moderationDatabaseError(err)
	}

	for _, record := range records {
		item, err := reviewRecordVO(db, record)
		if err != nil {
			return nil, err
		}

		result.Records = append(result.Records, item)
	}

	return result, nil
}

// GetReview 同时返回提交时的内容和帖子当前状态，避免把历史快照误认为当前内容。
func GetReview(
	ctx context.Context,
	actor entity.AuthUser,
	reviewID uint64,
) (*vo.ReviewDetailVO, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	var review entity.PostReview
	if err := db.Table("post_reviews").
		Where("id = ?", reviewID).
		Take(&review).Error; err != nil {
		return nil, moderationRecordError(err)
	}

	var post entity.Post
	if err := db.Table("posts").
		Where("id = ?", review.PostID).
		Take(&post).Error; err != nil {
		return nil, moderationRecordError(err)
	}

	author, err := moderationAuthor(db, post.AuthorID)
	if err != nil {
		return nil, err
	}

	record, err := reviewRecordVO(db, review)
	if err != nil {
		return nil, err
	}

	return &vo.ReviewDetailVO{
		ReviewRecordVO: record,
		CurrentPost:    currentModerationPost(post, author),
		IsCurrent:      review.Revision == post.Revision,
		CanDecide:      actor.ID != post.AuthorID && canDecideReview(review, post, author),
		ETag:           reviewETag(review.ID, post.StateVersion),
	}, nil
}

// DecideReview 锁定当前帖子和审核记录后检查 If-Match，只处理仍然有效的 pending 提交。
// 首次通过填写发布时间，后续重审保持首次发布时间，首页排序不会被刷新。
func DecideReview(
	ctx context.Context,
	actor entity.AuthUser,
	reviewID uint64,
	etag string,
	input dto.ReviewDecisionDTO,
) (*vo.ReviewDecisionResponseVO, string, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, "", err
	}

	var pointer entity.PostReview
	if err := db.Table("post_reviews").
		Select("id", "post_id").
		Where("id = ?", reviewID).
		Take(&pointer).Error; err != nil {
		return nil, "", moderationRecordError(err)
	}

	postPointer, err := moderationPostPointer(db, pointer.PostID)
	if err != nil {
		return nil, "", err
	}

	var result vo.ReviewDecisionResponseVO
	var nextETag string
	err = WriteTransactionWithUsers(
		ctx,
		actor,
		true,
		[]uint64{postPointer.AuthorID},
		func(tx *gorm.DB) error {
			// 与作者编辑采用相同帖子 -> 审核记录顺序，防止两个决定覆盖同一版本。
			post, err := lockModerationPost(tx, pointer.PostID)
			if err != nil {
				return err
			}

			var review entity.PostReview
			if err := tx.Table("post_reviews").
				Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", reviewID).
				Take(&review).Error; err != nil {
				return moderationRecordError(err)
			}

			if etag != reviewETag(review.ID, post.StateVersion) {
				return errs.ResourceChangedError
			}

			if actor.ID == post.AuthorID {
				return errs.ForbiddenError
			}

			author, err := moderationAuthor(tx, post.AuthorID)
			if err != nil {
				return err
			}

			if !canDecideReview(review, post, author) {
				return errs.StateConflictError
			}

			now := time.Now().UTC()
			before := PostOperationState(post)
			post.ReviewStatus = input.Decision
			post.ReviewReason = input.Reason
			post.ReviewedBy, post.ReviewedAt = &actor.ID, &now
			post.StateVersion++
			post.UpdatedAt = now
			if input.Decision == "approved" && post.FirstPublishedAt == nil {
				post.FirstPublishedAt = &now
			}
			if err := tx.Table("posts").
				Where("id = ?", post.ID).
				Updates(map[string]any{
					"review_status":      post.ReviewStatus,
					"review_reason":      post.ReviewReason,
					"reviewed_by":        actor.ID,
					"reviewed_at":        now,
					"first_published_at": post.FirstPublishedAt,
					"state_version":      post.StateVersion,
					"updated_at":         now,
				}).Error; err != nil {
				return moderationDatabaseError(err)
			}

			if err := tx.Table("post_reviews").
				Where("id = ?", review.ID).
				Updates(map[string]any{
					"decision":     input.Decision,
					"reason":       input.Reason,
					"reviewer_id":  actor.ID,
					"processed_at": now,
				}).Error; err != nil {
				return moderationDatabaseError(err)
			}

			reason := constant.ReviewApprovedReason
			if input.Reason != nil && *input.Reason != "" {
				reason = *input.Reason
			}
			if err := AddNotification(tx, &entity.Notification{
				UserID:    post.AuthorID,
				Type:      "post_review",
				Title:     constant.NotificationReviewTitle,
				Content:   reason,
				PostID:    &post.ID,
				ReviewID:  &review.ID,
				CreatedAt: now,
			}); err != nil {
				return err
			}

			actions := map[string]string{
				"approved": "approve_post",
				"returned": "return_post",
				"rejected": "reject_post",
			}
			if err := AddOperationLog(tx, &entity.AdminOperationLog{
				OperatorID:   actor.ID,
				Action:       actions[input.Decision],
				TargetUserID: &post.AuthorID,
				TargetPostID: &post.ID,
				Reason:       reason,
				StateBefore:  before,
				StateAfter:   PostOperationState(post),
				CreatedAt:    now,
			}); err != nil {
				return err
			}

			postID := strconv.FormatUint(post.ID, 10)
			result = vo.ReviewDecisionResponseVO{
				ID:               strconv.FormatUint(review.ID, 10),
				PostID:           &postID,
				Revision:         review.Revision,
				Decision:         input.Decision,
				Reason:           input.Reason,
				ProcessedAt:      &now,
				PostReviewStatus: post.ReviewStatus,
				PostStateVersion: post.StateVersion,
				PostETag:         PostETag(post),
			}
			nextETag = reviewETag(review.ID, post.StateVersion)
			return nil
		},
	)

	return &result, nextETag, err
}

// removePostInTransaction 由直接下架和举报下架共用；重复下架不递增版本，不重复通知。
func removePostInTransaction(
	tx *gorm.DB,
	operatorID uint64,
	post *entity.Post,
	reason string,
	reportID *uint64,
) error {
	if post.ReviewStatus == "removed" {
		return nil
	}

	now := time.Now().UTC()
	before := PostOperationState(*post)
	post.ReviewStatus, post.ReviewReason = "removed", &reason
	post.ReviewedBy, post.ReviewedAt = &operatorID, &now
	post.StateVersion++
	post.UpdatedAt = now
	if err := tx.Table("posts").
		Where("id = ?", post.ID).
		Updates(map[string]any{
			"review_status": "removed",
			"review_reason": reason,
			"reviewed_by":   operatorID,
			"reviewed_at":   now,
			"state_version": post.StateVersion,
			"updated_at":    now,
		}).Error; err != nil {
		return moderationDatabaseError(err)
	}
	// 未处理审核失效；已有 approved/returned/rejected 历史结论不修改。
	if err := tx.Table("post_reviews").
		Where("post_id = ? AND decision = ?", post.ID, "pending").
		Updates(map[string]any{
			"decision":     "superseded",
			"processed_at": now,
		}).Error; err != nil {
		return moderationDatabaseError(err)
	}

	if err := AddNotification(tx, &entity.Notification{
		UserID:    post.AuthorID,
		Type:      "post_removed",
		Title:     constant.NotificationRemovedTitle,
		Content:   reason,
		PostID:    &post.ID,
		ReportID:  reportID,
		CreatedAt: now,
	}); err != nil {
		return err
	}

	return AddOperationLog(tx, &entity.AdminOperationLog{
		OperatorID:     operatorID,
		Action:         "remove_post",
		TargetUserID:   &post.AuthorID,
		TargetPostID:   &post.ID,
		TargetReportID: reportID,
		Reason:         reason,
		StateBefore:    before,
		StateAfter:     PostOperationState(*post),
		CreatedAt:      now,
	})
}

// AddNotification 只在调用方事务内保存通知，保证状态更新失败时通知也回滚。
func AddNotification(tx *gorm.DB, notification *entity.Notification) error {
	if err := tx.Table("notifications").
		Create(notification).Error; err != nil {
		return moderationDatabaseError(err)
	}

	return nil
}

// AddOperationLog 保存白名单状态快照，不记录密码、令牌或联系方式。
func AddOperationLog(tx *gorm.DB, log *entity.AdminOperationLog) error {
	if err := tx.Table("admin_operation_logs").
		Create(log).Error; err != nil {
		return moderationDatabaseError(err)
	}

	return nil
}

// PostOperationState 从帖子中提取允许进入操作日志的状态字段。
func PostOperationState(post entity.Post) model.OperationState {
	return model.OperationState{
		ReviewStatus:     &post.ReviewStatus,
		ResolutionStatus: &post.ResolutionStatus,
		Revision:         &post.Revision,
		StateVersion:     &post.StateVersion,
	}
}

func lockModerationPost(tx *gorm.DB, postID uint64) (entity.Post, error) {
	var post entity.Post
	err := tx.Table("posts").
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", postID).
		Take(&post).Error
	return post, moderationRecordError(err)
}

// moderationPostPointer 只预读不可变作者 ID 来确定锁顺序，权限和状态仍在事务内重查。
func moderationPostPointer(db *gorm.DB, postID uint64) (entity.Post, error) {
	var post entity.Post
	err := db.Table("posts").
		Select("id", "author_id").
		Where("id = ?", postID).
		Take(&post).Error
	return post, moderationRecordError(err)
}

func moderationAuthor(db *gorm.DB, authorID uint64) (entity.User, error) {
	var author entity.User
	err := db.Table("users").
		Select("id", "status", "is_verified", "role", "token_version").
		Where("id = ?", authorID).
		Take(&author).Error
	return author, moderationRecordError(err)
}

func currentModerationPost(post entity.Post, author entity.User) vo.CurrentPostStateVO {
	return vo.CurrentPostStateVO{
		ID:               strconv.FormatUint(post.ID, 10),
		Revision:         post.Revision,
		StateVersion:     post.StateVersion,
		ReviewStatus:     post.ReviewStatus,
		ResolutionStatus: post.ResolutionStatus,
		AuthorID:         strconv.FormatUint(post.AuthorID, 10),
		AuthorStatus:     author.Status,
		AuthorIsVerified: author.IsVerified,
	}
}

func canDecideReview(review entity.PostReview, post entity.Post, author entity.User) bool {
	return review.Decision == "pending" && review.Revision == post.Revision &&
		post.ReviewStatus == "pending" && post.ResolutionStatus != "withdrawn" &&
		author.Status == "active" && author.IsVerified
}

func reviewRecordVO(db *gorm.DB, review entity.PostReview) (vo.ReviewRecordVO, error) {
	postID := strconv.FormatUint(review.PostID, 10)
	result := vo.ReviewRecordVO{
		ID:              strconv.FormatUint(review.ID, 10),
		PostID:          &postID,
		Revision:        review.Revision,
		Decision:        review.Decision,
		ContentSnapshot: review.ContentSnapshot,
		Reason:          review.Reason,
		SubmittedAt:     review.SubmittedAt,
		ProcessedAt:     review.ProcessedAt,
	}
	if review.ReviewerID != nil {
		reviewer, err := UserSummary(db, *review.ReviewerID)
		if err != nil {
			return result, err
		}

		result.Reviewer = &reviewer
	}

	return result, nil
}

func reviewETag(reviewID uint64, stateVersion uint32) string {
	return fmt.Sprintf("\"review-%d-post-v%d\"", reviewID, stateVersion)
}

func moderationRecordError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errs.ResourceNotFoundError
	}

	return moderationDatabaseError(err)
}

func moderationDatabaseError(err error) error {
	if err == nil {
		return nil
	}

	return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
}
