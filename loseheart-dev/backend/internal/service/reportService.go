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

// CreateReport 只允许举报他人的当前可见版本，同一用户重复举报返回原记录。
// 锁定帖子后判断 revision，避免举报在作者编辑时漂移到另一个内容版本。
func CreateReport(
	ctx context.Context,
	actor entity.AuthUser,
	postID uint64,
	input dto.CreateReportDTO,
) (*vo.CreateReportResponseVO, bool, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, false, err
	}

	pointer, err := moderationPostPointer(db, postID)
	if err != nil {
		return nil, false, err
	}

	var result vo.CreateReportResponseVO
	created := false
	err = WriteTransactionWithUsers(ctx, actor, false, []uint64{pointer.AuthorID}, func(tx *gorm.DB) error {
		post, err := lockModerationPost(tx, postID)
		if err != nil {
			return err
		}

		if post.AuthorID == actor.ID {
			return errs.ForbiddenError
		}

		author, err := moderationAuthor(tx, post.AuthorID)
		if err != nil {
			return err
		}

		if post.ReviewStatus != "approved" || post.ResolutionStatus == "withdrawn" || author.Status != "active" ||

			!author.IsVerified {
			return errs.ResourceNotFoundError
		}

		if post.Revision != input.PostRevision {
			return errs.StateConflictError
		}

		var report entity.PostReport
		err = tx.Table("post_reports").
			Where(
				"reporter_id = ? AND post_id = ? AND post_revision = ?",
				actor.ID,
				post.ID,
				input.PostRevision,
			).
			Take(&report).Error
		if err == nil {
			result = createReportResponse(report)
			return nil
		}

		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return moderationDatabaseError(err)
		}

		report = entity.PostReport{
			ReporterID:   actor.ID,
			PostID:       post.ID,
			PostRevision: input.PostRevision,
			ReasonType:   input.ReasonType,
			Details:      input.Details,
			Status:       "pending",
			CreatedAt:    time.Now().UTC(),
		}
		if err := tx.Table("post_reports").
			Create(&report).Error; err != nil {
			return moderationDatabaseError(err)
		}

		created, result = true, createReportResponse(report)
		return nil
	})

	return &result, created, err
}

// ListReports 保留每个举报人的独立记录，默认待处理，按举报时间从早到晚显示。
func ListReports(
	ctx context.Context,
	input dto.ReportQueryDTO,
) (*vo.PageResultVO[vo.ReportRecordVO], error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	status := input.Status
	if status == "" {
		status = "pending"
	}

	query := db.Table("post_reports").
		Where("status = ?", status)
	if input.PostID != "" {
		query = query.Where("post_id = ?", input.PostID)
	}

	page, pageSize := PageValues(input.PageQueryDTO)
	result := &vo.PageResultVO[vo.ReportRecordVO]{
		Page:     page,
		PageSize: pageSize,
		Records:  make([]vo.ReportRecordVO, 0),
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return nil, moderationDatabaseError(err)
	}

	var reports []entity.PostReport
	if err := query.Order("created_at ASC, id ASC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&reports).Error; err != nil {
		return nil, moderationDatabaseError(err)
	}

	for _, report := range reports {
		item, err := reportRecordVO(db, report)
		if err != nil {
			return nil, err
		}

		result.Records = append(result.Records, item)
	}

	return result, nil
}

// GetReport 使用 post_revision 读取举报当时的快照，帖子后来编辑不会改变举报依据。
func GetReport(
	ctx context.Context,
	actor entity.AuthUser,
	reportID uint64,
) (*vo.ReportDetailVO, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	var report entity.PostReport
	if err := db.Table("post_reports").
		Where("id = ?", reportID).
		Take(&report).Error; err != nil {
		return nil, moderationRecordError(err)
	}

	var post entity.Post
	if err := db.Table("posts").
		Where("id = ?", report.PostID).
		Take(&post).Error; err != nil {
		return nil, moderationRecordError(err)
	}

	var review entity.PostReview
	if err := db.Table("post_reviews").
		Where("post_id = ? AND revision = ?", report.PostID, report.PostRevision).
		Take(&review).Error; err != nil {
		return nil, moderationRecordError(err)
	}

	author, err := moderationAuthor(db, post.AuthorID)
	if err != nil {
		return nil, err
	}

	record, err := reportRecordVO(db, report)
	if err != nil {
		return nil, err
	}

	return &vo.ReportDetailVO{
		ReportRecordVO:  record,
		ContentSnapshot: review.ContentSnapshot,
		CurrentPost:     currentModerationPost(post, author),
		CanDecide:       report.Status == "pending" && actor.ID != post.AuthorID,
		ETag:            reportETag(report),
	}, nil
}

// DecideReport 原子完成举报结案、可选的下架/禁用、通知和日志，不根据举报数量自动处罚。
// 举报 ETag 校验处理状态；下架另校验当前帖子版本，避免对修改后的内容盲目处罚。
func DecideReport(
	ctx context.Context,
	actor entity.AuthUser,
	reportID uint64,
	etag string,
	input dto.ReportDecisionDTO,
) (*vo.ReportDecisionResponseVO, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	var pointer entity.PostReport
	if err := db.Table("post_reports").
		Select("id", "post_id", "reporter_id").
		Where("id = ?", reportID).
		Take(&pointer).Error; err != nil {
		return nil, moderationRecordError(err)
	}

	postPointer, err := moderationPostPointer(db, pointer.PostID)
	if err != nil {
		return nil, err
	}

	var result vo.ReportDecisionResponseVO
	err = WriteTransactionWithUsers(
		ctx,
		actor,
		true,
		[]uint64{postPointer.AuthorID, pointer.ReporterID},
		func(tx *gorm.DB) error {
			var target entity.User
			if input.ResultAction == "disable_user" {
				// 只在需要修改账号时加用户行锁，顺序与改密/编辑一致：用户 -> 帖子。
				if err := tx.Table("users").
					Clauses(clause.Locking{Strength: "UPDATE"}).
					Select("id", "role", "status", "token_version").
					Where("id = ?", postPointer.AuthorID).
					Take(&target).Error; err != nil {
					return moderationRecordError(err)
				}

				if target.Role != "user" {
					return errs.ForbiddenError
				}
			}
			post, err := lockModerationPost(tx, pointer.PostID)
			if err != nil {
				return err
			}

			var report entity.PostReport
			if err := tx.Table("post_reports").
				Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", reportID).
				Take(&report).Error; err != nil {
				return moderationRecordError(err)
			}

			if etag != reportETag(report) {
				return errs.ResourceChangedError
			}

			if report.Status != "pending" {
				return errs.StateConflictError
			}

			if actor.ID == post.AuthorID {
				return errs.ForbiddenError
			}

			if input.ResultAction == "remove_post" {
				if input.ExpectedPostStateVersion == nil || *input.ExpectedPostStateVersion != post.StateVersion {
					return errs.StateConflictError
				}

				if post.ResolutionStatus == "withdrawn" && post.ReviewStatus != "removed" {
					return errs.StateConflictError
				}

				if err := removePostInTransaction(tx, actor.ID, &post, input.HandlingReason, &report.ID); err != nil {
					return err
				}
			}
			if input.ResultAction == "disable_user" && target.Status != "disabled" {
				if err := disableReportedAuthor(tx, actor.ID, &target, post.ID, report.ID, input.HandlingReason); err != nil {
					return err
				}
			}
			now := time.Now().UTC()
			oldStatus := report.Status
			before := model.OperationState{Status: &oldStatus}
			report.Status, report.ResultAction = input.Status, &input.ResultAction
			report.HandlerID, report.HandlingReason, report.HandledAt = &actor.ID, &input.HandlingReason, &now
			if err := tx.Table("post_reports").
				Where("id = ?", report.ID).
				Updates(map[string]any{
					"status":          report.Status,
					"result_action":   report.ResultAction,
					"handler_id":      actor.ID,
					"handling_reason": report.HandlingReason,
					"handled_at":      now,
				}).Error; err != nil {
				return moderationDatabaseError(err)
			}

			if err := AddNotification(tx, &entity.Notification{
				UserID:    report.ReporterID,
				Type:      "report_result",
				Title:     constant.NotificationReportTitle,
				Content:   input.HandlingReason,
				PostID:    &post.ID,
				ReportID:  &report.ID,
				CreatedAt: now,
			}); err != nil {
				return err
			}

			action := "handle_report"
			if input.Status == "dismissed" {
				action = "dismiss_report"
			}
			if err := AddOperationLog(tx, &entity.AdminOperationLog{
				OperatorID:     actor.ID,
				Action:         action,
				TargetUserID:   &post.AuthorID,
				TargetPostID:   &post.ID,
				TargetReportID: &report.ID,
				Reason:         input.HandlingReason,
				StateBefore:    before,
				StateAfter: model.OperationState{
					Status:       &report.Status,
					ResultAction: report.ResultAction,
				},
				CreatedAt: now,
			}); err != nil {
				return err
			}

			result = vo.ReportDecisionResponseVO{
				ID:             strconv.FormatUint(report.ID, 10),
				Status:         report.Status,
				ResultAction:   report.ResultAction,
				HandlingReason: report.HandlingReason,
				HandledAt:      report.HandledAt,
				ETag:           reportETag(report),
			}
			return nil
		},
	)

	return &result, err
}

// disableReportedAuthor 只处置被举报帖的普通用户作者；已禁用账号由调用方跳过，避免重复失效令牌。
func disableReportedAuthor(
	tx *gorm.DB,
	operatorID uint64,
	target *entity.User,
	postID, reportID uint64,
	reason string,
) error {
	now := time.Now().UTC()
	oldStatus, oldVersion := target.Status, target.TokenVersion
	target.Status, target.TokenVersion = "disabled", target.TokenVersion+1
	if err := tx.Table("users").
		Where("id = ?", target.ID).
		Updates(map[string]any{
			"status":        target.Status,
			"token_version": target.TokenVersion,
			"updated_at":    now,
		}).Error; err != nil {
		return moderationDatabaseError(err)
	}

	if err := AddNotification(tx, &entity.Notification{
		UserID:    target.ID,
		Type:      "account_status",
		Title:     constant.NotificationAccountTitle,
		Content:   reason,
		PostID:    &postID,
		ReportID:  &reportID,
		CreatedAt: now,
	}); err != nil {
		return err
	}

	return AddOperationLog(tx, &entity.AdminOperationLog{
		OperatorID:     operatorID,
		Action:         "disable_user",
		TargetUserID:   &target.ID,
		TargetPostID:   &postID,
		TargetReportID: &reportID,
		Reason:         reason,
		StateBefore: model.OperationState{
			Status:       &oldStatus,
			TokenVersion: &oldVersion,
		},
		StateAfter: model.OperationState{
			Status:       &target.Status,
			TokenVersion: &target.TokenVersion,
		},
		CreatedAt: now,
	})
}

func createReportResponse(report entity.PostReport) vo.CreateReportResponseVO {
	postID := strconv.FormatUint(report.PostID, 10)
	return vo.CreateReportResponseVO{
		ID:           strconv.FormatUint(report.ID, 10),
		PostID:       &postID,
		PostRevision: report.PostRevision,
		Status:       report.Status,
		CreatedAt:    report.CreatedAt,
	}
}

func reportRecordVO(db *gorm.DB, report entity.PostReport) (vo.ReportRecordVO, error) {
	reporter, err := UserSummary(db, report.ReporterID)
	if err != nil {
		return vo.ReportRecordVO{}, err
	}

	result := vo.ReportRecordVO{
		CreateReportResponseVO: createReportResponse(report),
		Reporter:               reporter,
		ReasonType:             report.ReasonType,
		ResultAction:           report.ResultAction,
		HandlingReason:         report.HandlingReason,
		HandledAt:              report.HandledAt,
	}
	if report.Details != nil {
		result.Details = *report.Details
	}
	if report.HandlerID != nil {
		handler, err := UserSummary(db, *report.HandlerID)
		if err != nil {
			return result, err
		}

		result.Handler = &handler
	}

	return result, nil
}

func reportETag(report entity.PostReport) string {
	return fmt.Sprintf("\"report-%d-%s\"", report.ID, report.Status)
}
