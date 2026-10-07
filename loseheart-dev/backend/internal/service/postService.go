package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
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

var beijingTime = time.FixedZone("Asia/Shanghai", 8*60*60)

// GetPostQuota 查询北京时间自然日额度；查询本身不会创建或预留额度。
func GetPostQuota(
	ctx context.Context,
	userID uint64,
) (*vo.PostQuotaResponseVO, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now().In(beijingTime)
	date := now.Format("2006-01-02")
	var quota entity.PostDailyQuota
	err = db.Table("post_daily_quotas").
		Where("user_id = ? AND quota_date = ?", userID, date).
		Take(&quota).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, postDatabaseError(err)
	}

	return &vo.PostQuotaResponseVO{
		Date:      date,
		Limit:     3,
		Used:      int(quota.SubmittedCount),
		Remaining: 3 - int(quota.SubmittedCount),
		ResetsAt:  time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, beijingTime),
	}, nil
}

// ListPosts 查询审核通过且作者有效的帖子，按首次发布时间排序；重审不会置顶。
func ListPosts(
	ctx context.Context,
	input dto.PostQueryDTO,
) (*vo.PageResultVO[vo.PostListItemVO], error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	query := db.Table("posts").
		Joins("JOIN users ON users.id = posts.author_id").
		Where(
			"posts.review_status = ? AND posts.resolution_status <> ? AND users.status = ? AND users.is_verified = ?",
			"approved", "withdrawn", "active", true,
		)
	query = postSearch(query, input.PostType, input.Campus, input.Keyword)
	status := input.ResolutionStatus
	if status == "" {
		status = "active"
	}
	if status != "all" {
		query = query.Where("posts.resolution_status = ?", status)
	}
	if input.EventDateFrom != "" {
		query = query.Where("posts.event_date >= ?", input.EventDateFrom)
	}
	if input.EventDateTo != "" {
		query = query.Where("posts.event_date <= ?", input.EventDateTo)
	}

	page, size := PageValues(input.PageQueryDTO)
	result := &vo.PageResultVO[vo.PostListItemVO]{
		Page:     page,
		PageSize: size,
		Records:  make([]vo.PostListItemVO, 0),
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return nil, postDatabaseError(err)
	}
	var posts []entity.Post
	if err := query.Select("posts.*").
		Order("posts.first_published_at DESC, posts.id DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&posts).Error; err != nil {
		return nil, postDatabaseError(err)
	}

	for _, post := range posts {
		item, err := postListItem(db, post)
		if err != nil {
			return nil, err
		}
		result.Records = append(result.Records, item)
	}
	return result, nil
}

// GetPostDetail 获取当前内容；隐藏内容只有作者与实时管理员可读。
func GetPostDetail(
	ctx context.Context,
	actor entity.AuthUser,
	id uint64,
	admin bool,
) (any, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}
	if admin && actor.Role != "admin" {
		return nil, errs.ForbiddenError
	}

	var post entity.Post
	if err := db.Table("posts").
		Where("id = ?", id).
		Take(&post).Error; err != nil {
		return nil, postReadError(err)
	}
	if err := canReadPost(db, actor, post); err != nil {
		return nil, err
	}
	return postDetail(db, actor, post)
}

// CreatePost 把帖子、首版审核快照和额度放在同一事务里，失败全部回滚。
// 用户行锁同时串行化同账号并发提交，幂等查询必须在额度扣减之前。
func CreatePost(
	ctx context.Context,
	actor entity.AuthUser,
	key string,
	input dto.CreatePostDTO,
) (any, bool, error) {
	post, err := normalizePostContent(actor.ID, input.PostContentDTO)
	if err != nil {
		return nil, false, err
	}

	payload, err := json.Marshal(PostSnapshot(post))
	if err != nil {
		return nil, false, errs.InternalError
	}

	digest := sha256.Sum256(payload)
	created := false
	var result any
	err = WriteTransaction(ctx, actor, false, func(tx *gorm.DB) error {
		var existing entity.Post
		err := tx.Table("posts").
			Where("author_id = ? AND creation_key = ?", actor.ID, key).
			Take(&existing).Error
		if err == nil {
			if !bytes.Equal(existing.CreationPayloadHash, digest[:]) {
				return errs.IdempotencyConflictError
			}
			result, err = postDetail(tx, actor, existing)
			return err
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return postDatabaseError(err)
		}

		if err := validatePostEvent(post, time.Now()); err != nil {
			return err
		}
		if err := ValidatePostImages(ctx, actor.ID, post.Images); err != nil {
			return err
		}

		now := time.Now().UTC()
		date := now.In(beijingTime).Format("2006-01-02")
		quotaDate, _ := time.Parse("2006-01-02", date)
		quota := entity.PostDailyQuota{
			UserID:    actor.ID,
			QuotaDate: quotaDate,
			UpdatedAt: now,
		}

		// 首次提交创建当日行，之后通过行锁和条件更新保证计数永不超过 3。
		if err := tx.Table("post_daily_quotas").
			Clauses(clause.OnConflict{DoNothing: true}).
			Create(&quota).Error; err != nil {
			return postDatabaseError(err)
		}
		if err := tx.Table("post_daily_quotas").
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ? AND quota_date = ?", actor.ID, date).
			Take(&quota).Error; err != nil {
			return postDatabaseError(err)
		}
		if quota.SubmittedCount >= 3 {
			return errs.PostQuotaExceededError
		}

		post.ReviewStatus = "pending"
		post.ResolutionStatus = "active"
		post.Revision = 1
		post.StateVersion = 1
		post.CreationKey = key
		post.CreationPayloadHash = digest[:]
		post.SubmittedAt = now
		post.CreatedAt = now
		post.UpdatedAt = now
		if err := tx.Table("posts").Create(&post).Error; err != nil {
			return postDatabaseError(err)
		}

		review := entity.PostReview{
			PostID:          post.ID,
			Revision:        1,
			Decision:        "pending",
			ContentSnapshot: PostSnapshot(post),
			SubmittedAt:     now,
		}
		if err := tx.Table("post_reviews").Create(&review).Error; err != nil {
			return postDatabaseError(err)
		}

		update := tx.Table("post_daily_quotas").
			Where("user_id = ? AND quota_date = ? AND submitted_count < 3", actor.ID, date).
			Updates(map[string]any{
				"submitted_count": gorm.Expr("submitted_count + 1"),
				"updated_at":      now,
			})
		if update.Error != nil {
			return postDatabaseError(update.Error)
		}
		if update.RowsAffected != 1 {
			return errs.PostQuotaExceededError
		}

		result, err = postDetail(tx, actor, post)
		created = err == nil
		return err
	})
	return result, created, err
}

// UpdatePost 完整替换内容，保存新快照，旧未审核记录置为 superseded。
// 已完成状态保留；撤回不可编辑；不改变创建摘要、首次发布时间及发帖额度。
func UpdatePost(
	ctx context.Context,
	actor entity.AuthUser,
	id uint64,
	etag string,
	input dto.UpdatePostDTO,
) (any, error) {
	content, err := normalizePostContent(actor.ID, input.PostContentDTO)
	if err != nil {
		return nil, err
	}

	var result any
	err = WriteTransaction(ctx, actor, false, func(tx *gorm.DB) error {
		var post entity.Post
		if err := tx.Table("posts").
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND author_id = ?", id, actor.ID).
			Take(&post).Error; err != nil {
			return postReadError(err)
		}
		if PostETag(post) != etag {
			return errs.ResourceChangedError
		}
		if post.ResolutionStatus == "withdrawn" || post.Revision == math.MaxUint32 || post.StateVersion == math.MaxUint32 {
			return errs.StateConflictError
		}

		if err := validatePostEvent(content, time.Now()); err != nil {
			return err
		}
		if err := ValidatePostImages(ctx, actor.ID, content.Images); err != nil {
			return err
		}

		now := time.Now().UTC()
		if err := supersedePendingReview(tx, post.ID, now); err != nil {
			return err
		}

		post.PostType = content.PostType
		post.ItemName = content.ItemName
		post.Campus = content.Campus
		post.Location = content.Location
		post.EventDate = content.EventDate
		post.TimePrecision = content.TimePrecision
		post.EventTimeStart = content.EventTimeStart
		post.EventTimeEnd = content.EventTimeEnd
		post.Description = content.Description
		post.Images = content.Images
		post.ContactMethods = content.ContactMethods
		post.Revision++
		post.StateVersion++
		post.ReviewStatus = "pending"
		post.ReviewReason = nil
		post.ReviewedBy = nil
		post.ReviewedAt = nil
		post.SubmittedAt = now
		post.UpdatedAt = now

		// Select('*') 确保重提时将旧审核原因、审核人和时间真正置空。
		if err := tx.Table("posts").
			Where("id = ?", post.ID).
			Select("*").
			Omit("id").
			Updates(&post).Error; err != nil {
			return postDatabaseError(err)
		}

		review := entity.PostReview{
			PostID:          post.ID,
			Revision:        post.Revision,
			Decision:        "pending",
			ContentSnapshot: PostSnapshot(post),
			SubmittedAt:     now,
		}
		if err := tx.Table("post_reviews").Create(&review).Error; err != nil {
			return postDatabaseError(err)
		}
		result, err = postDetail(tx, actor, post)
		return err
	})
	return result, err
}

// UpdatePostResolution 只改变状态版本，不创建内容版本；同状态请求仍校验 ETag。
func UpdatePostResolution(
	ctx context.Context,
	actor entity.AuthUser,
	id uint64,
	etag string,
	input dto.PostResolutionDTO,
) (*vo.PostResolutionResponseVO, error) {
	var result *vo.PostResolutionResponseVO
	err := WriteTransaction(ctx, actor, false, func(tx *gorm.DB) error {
		var post entity.Post
		if err := tx.Table("posts").
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND author_id = ?", id, actor.ID).
			Take(&post).Error; err != nil {
			return postReadError(err)
		}
		if PostETag(post) != etag {
			return errs.ResourceChangedError
		}

		if post.ResolutionStatus != input.ResolutionStatus {
			if post.ResolutionStatus == "withdrawn" || post.StateVersion == math.MaxUint32 {
				return errs.StateConflictError
			}
			if input.ResolutionStatus != "withdrawn" && post.ReviewStatus != "approved" {
				return errs.StateConflictError
			}

			now := time.Now().UTC()
			switch input.ResolutionStatus {
			case "active":
				post.CompletedAt = nil
			case "completed":
				post.CompletedAt = &now
			case "withdrawn":
				post.WithdrawnAt = &now
				if err := supersedePendingReview(tx, post.ID, now); err != nil {
					return err
				}
			default:
				return errs.ValidationError
			}
			post.ResolutionStatus = input.ResolutionStatus
			post.StateVersion++
			if err := tx.Table("posts").
				Where("id = ?", post.ID).
				Updates(map[string]any{
					"resolution_status": post.ResolutionStatus,
					"state_version":     post.StateVersion,
					"completed_at":      post.CompletedAt,
					"withdrawn_at":      post.WithdrawnAt,
					"updated_at":        now,
				}).Error; err != nil {
				return postDatabaseError(err)
			}
		}

		result = &vo.PostResolutionResponseVO{
			PostStateResponseVO: PostState(post),
			CompletedAt:         post.CompletedAt,
			WithdrawnAt:         post.WithdrawnAt,
		}
		return nil
	})
	return result, err
}

// ListMyPosts 包含本人所有审核与归还状态，列表不返回描述全文或联系方式。
func ListMyPosts(
	ctx context.Context,
	userID uint64,
	input dto.MyPostQueryDTO,
) (*vo.PageResultVO[vo.MyPostListItemVO], error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	query := db.Table("posts").
		Where("author_id = ?", userID)
	if input.ReviewStatus != "" {
		query = query.Where("review_status = ?", input.ReviewStatus)
	}
	if input.ResolutionStatus != "" {
		query = query.Where("resolution_status = ?", input.ResolutionStatus)
	}

	page, size := PageValues(input.PageQueryDTO)
	result := &vo.PageResultVO[vo.MyPostListItemVO]{
		Page:     page,
		PageSize: size,
		Records:  make([]vo.MyPostListItemVO, 0),
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return nil, postDatabaseError(err)
	}
	var posts []entity.Post
	if err := query.Order("created_at DESC, id DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&posts).Error; err != nil {
		return nil, postDatabaseError(err)
	}
	for _, post := range posts {
		item, err := postListItem(db, post)
		if err != nil {
			return nil, err
		}
		result.Records = append(result.Records, vo.MyPostListItemVO{
			PostListItemVO: item,
			ReviewStatus:   post.ReviewStatus,
			Revision:       post.Revision,
			StateVersion:   post.StateVersion,
			ReviewReason:   post.ReviewReason,
			SubmittedAt:    post.SubmittedAt,
			CreatedAt:      post.CreatedAt,
		})
	}
	return result, nil
}

// ListAdminPosts 包含隐藏、撤回和被禁用作者的帖子，管理页按创建时间倒序。
func ListAdminPosts(
	ctx context.Context,
	input dto.AdminPostQueryDTO,
) (*vo.PageResultVO[vo.AdminPostListItemVO], error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	query := postSearch(db.Table("posts"), input.PostType, input.Campus, input.Keyword)
	if input.ReviewStatus != "" {
		query = query.Where("review_status = ?", input.ReviewStatus)
	}
	if input.ResolutionStatus != "" {
		query = query.Where("resolution_status = ?", input.ResolutionStatus)
	}
	if input.AuthorID != "" {
		id, err := strconv.ParseUint(input.AuthorID, 10, 64)
		if err != nil || id == 0 {
			return nil, errs.ValidationError
		}
		query = query.Where("author_id = ?", id)
	}

	page, size := PageValues(input.PageQueryDTO)
	result := &vo.PageResultVO[vo.AdminPostListItemVO]{
		Page:     page,
		PageSize: size,
		Records:  make([]vo.AdminPostListItemVO, 0),
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return nil, postDatabaseError(err)
	}
	var posts []entity.Post
	if err := query.Order("created_at DESC, id DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&posts).Error; err != nil {
		return nil, postDatabaseError(err)
	}
	for _, post := range posts {
		item, err := postListItem(db, post)
		if err != nil {
			return nil, err
		}
		result.Records = append(result.Records, vo.AdminPostListItemVO{
			PostListItemVO: item,
			AuthorID:       strconv.FormatUint(post.AuthorID, 10),
			ReviewStatus:   post.ReviewStatus,
			Revision:       post.Revision,
			StateVersion:   post.StateVersion,
			SubmittedAt:    post.SubmittedAt,
			CreatedAt:      post.CreatedAt,
		})
	}
	return result, nil
}

// ListPostReviews 仅作者与管理员能获得历史完整快照，按内容版本倒序。
func ListPostReviews(
	ctx context.Context,
	actor entity.AuthUser,
	postID uint64,
	input dto.PageQueryDTO,
) (*vo.PageResultVO[vo.ReviewRecordVO], error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	var post entity.Post
	if err := db.Table("posts").
		Where("id = ?", postID).
		Take(&post).Error; err != nil {
		return nil, postReadError(err)
	}
	if post.AuthorID != actor.ID && actor.Role != "admin" {
		return nil, errs.ResourceNotFoundError
	}

	page, size := PageValues(input)
	result := &vo.PageResultVO[vo.ReviewRecordVO]{
		Page:     page,
		PageSize: size,
		Records:  make([]vo.ReviewRecordVO, 0),
	}
	query := db.Table("post_reviews").
		Where("post_id = ?", postID)
	if err := query.Count(&result.Total).Error; err != nil {
		return nil, postDatabaseError(err)
	}
	var reviews []entity.PostReview
	if err := query.Order("revision DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&reviews).Error; err != nil {
		return nil, postDatabaseError(err)
	}
	for _, review := range reviews {
		postID := strconv.FormatUint(review.PostID, 10)
		item := vo.ReviewRecordVO{
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
				return nil, err
			}
			item.Reviewer = &reviewer
		}
		result.Records = append(result.Records, item)
	}
	return result, nil
}

// normalizePostContent 统一去除展示文本首尾空白，保留有序图片和联系方式用于创建摘要。
func normalizePostContent(
	authorID uint64,
	input dto.PostContentDTO,
) (entity.Post, error) {
	date, err := time.Parse("2006-01-02", input.EventDate)
	if err != nil || date.Year() < 1000 {
		return entity.Post{}, errs.ValidationError
	}

	// 业务层也核对时间精度组合，避免内部调用产生不符合 SQL 约束的记录。
	switch input.TimePrecision {
	case "date":
		if input.EventTimeStart != nil || input.EventTimeEnd != nil {
			return entity.Post{}, errs.ValidationError
		}
	case "exact":
		if input.EventTimeStart == nil || input.EventTimeEnd != nil {
			return entity.Post{}, errs.ValidationError
		}
	case "range":
		if input.EventTimeStart == nil || input.EventTimeEnd == nil || *input.EventTimeStart > *input.EventTimeEnd {
			return entity.Post{}, errs.ValidationError
		}
	default:
		return entity.Post{}, errs.ValidationError
	}
	for _, value := range []*string{input.EventTimeStart, input.EventTimeEnd} {
		if value != nil {
			parsed, err := time.Parse("15:04", *value)
			if err != nil || parsed.Format("15:04") != *value {
				return entity.Post{}, errs.ValidationError
			}
		}
	}

	post := entity.Post{
		AuthorID:       authorID,
		PostType:       input.PostType,
		ItemName:       strings.TrimSpace(input.ItemName),
		Campus:         input.Campus,
		Location:       strings.TrimSpace(input.Location),
		EventDate:      date,
		TimePrecision:  input.TimePrecision,
		Description:    strings.TrimSpace(input.Description),
		Images:         append([]string{}, input.Images...),
		ContactMethods: make([]model.ContactMethod, 0, len(input.ContactMethods)),
	}
	for _, value := range input.ContactMethods {
		post.ContactMethods = append(post.ContactMethods, model.ContactMethod{
			Type:  value.Type,
			Value: strings.TrimSpace(value.Value),
		})
	}

	if input.EventTimeStart != nil {
		value := *input.EventTimeStart + ":00"
		post.EventTimeStart = &value
	}
	if input.EventTimeEnd != nil {
		value := *input.EventTimeEnd + ":00"
		post.EventTimeEnd = &value
	}
	return post, nil
}

// validatePostEvent 日期和时间始终按北京时间解释，不受服务器时区影响。
func validatePostEvent(post entity.Post, now time.Time) error {
	date := post.EventDate.Format("2006-01-02")
	if date > now.In(beijingTime).Format("2006-01-02") {
		return errs.ValidationError
	}
	for _, value := range []*string{post.EventTimeStart, post.EventTimeEnd} {
		if value != nil {
			event, err := time.ParseInLocation("2006-01-02 15:04:05", date+" "+*value, beijingTime)
			if err != nil || event.After(now) {
				return errs.ValidationError
			}
		}
	}
	return nil
}

// canReadPost 使用帖子状态及作者当前状态判断读者权限，不泄露隐藏资源存在性。
func canReadPost(db *gorm.DB, actor entity.AuthUser, post entity.Post) error {
	if post.AuthorID == actor.ID || actor.Role == "admin" {
		return nil
	}
	if post.ReviewStatus != "approved" || post.ResolutionStatus == "withdrawn" {
		return errs.ResourceNotFoundError
	}

	var author entity.User
	if err := db.Table("users").
		Select("id", "status", "is_verified").
		Where("id = ?", post.AuthorID).
		Take(&author).Error; err != nil {
		return postReadError(err)
	}
	if author.Status != "active" || !author.IsVerified {
		return errs.ResourceNotFoundError
	}
	return nil
}

// postListItem 只返回卡片所需的作者公开摘要与平台封面读取地址。
func postListItem(db *gorm.DB, post entity.Post) (vo.PostListItemVO, error) {
	var author entity.User
	if err := db.Table("users").
		Select("id", "nickname", "avatar_url").
		Where("id = ?", post.AuthorID).
		Take(&author).Error; err != nil {
		return vo.PostListItemVO{}, postReadError(err)
	}

	item := vo.PostListItemVO{
		ID:               strconv.FormatUint(post.ID, 10),
		PostType:         post.PostType,
		ItemName:         post.ItemName,
		Campus:           post.Campus,
		Location:         post.Location,
		EventDate:        post.EventDate.Format("2006-01-02"),
		TimePrecision:    post.TimePrecision,
		EventTimeStart:   postResponseTime(post.EventTimeStart),
		EventTimeEnd:     postResponseTime(post.EventTimeEnd),
		ResolutionStatus: post.ResolutionStatus,
		FirstPublishedAt: post.FirstPublishedAt,
		Author: vo.PostAuthorVO{
			ID:        strconv.FormatUint(author.ID, 10),
			Nickname:  author.Nickname,
			AvatarURL: author.AvatarURL,
		},
		ETag: PostETag(post),
	}
	if len(post.Images) > 0 {
		url := postImageURL(post, 0)
		item.CoverURL = &url
	}
	return item, nil
}

// postDetail 根据调用者权限选择公开详情或作者/管理员详情，避免敏感字段误返回。
func postDetail(db *gorm.DB, actor entity.AuthUser, post entity.Post) (any, error) {
	item, err := postListItem(db, post)
	if err != nil {
		return nil, err
	}

	owner := actor.ID == post.AuthorID
	canReport := !owner && post.ReviewStatus == "approved" && post.ResolutionStatus != "withdrawn"
	if canReport && actor.Role == "admin" {
		// 管理员可读隐藏帖子，但举报能力仍遵守普通读者的可见范围。
		err := canReadPost(db, entity.AuthUser{ID: actor.ID}, post)
		if err != nil && !errors.Is(err, errs.ResourceNotFoundError) {
			return nil, err
		}
		canReport = err == nil
	}

	detail := vo.PostDetailVO{
		PostListItemVO: item,
		Description:    post.Description,
		ImageURLs:      make([]string, 0, len(post.Images)),
		ContactMethods: post.ContactMethods,
		ReviewStatus:   post.ReviewStatus,
		Revision:       post.Revision,
		StateVersion:   post.StateVersion,
		SubmittedAt:    post.SubmittedAt,
		CompletedAt:    post.CompletedAt,
		WithdrawnAt:    post.WithdrawnAt,
		CanEdit:        owner && post.ResolutionStatus != "withdrawn",
		CanReport:      canReport,
		CanComplete:    owner && post.ReviewStatus == "approved" && post.ResolutionStatus != "withdrawn",
	}
	for index := range post.Images {
		detail.ImageURLs = append(detail.ImageURLs, postImageURL(post, index))
	}
	if owner || actor.Role == "admin" {
		return &vo.OwnerPostDetailVO{
			PostDetailVO: detail,
			Images:       post.Images,
			ReviewReason: post.ReviewReason,
			ReviewedAt:   post.ReviewedAt,
		}, nil
	}
	return &detail, nil
}

// postImageURL 包含内容版本；旧 URL 不能指向后来替换的另一张图。
func postImageURL(post entity.Post, index int) string {
	return fmt.Sprintf("/api/v1/posts/%d/images/%d?revision=%d", post.ID, index, post.Revision)
}

// postResponseTime 将 MySQL 的 HH:mm:ss 转换为接口约定的 HH:mm。
func postResponseTime(value *string) *string {
	if value == nil {
		return nil
	}
	short := *value
	if len(short) >= 5 {
		short = short[:5]
	}
	return &short
}

// postSearch 复用首页与管理页的内容筛选，始终不搜索联系方式。
func postSearch(
	query *gorm.DB,
	postType, campus, keyword string,
) *gorm.DB {
	if postType != "" {
		query = query.Where("posts.post_type = ?", postType)
	}
	if campus != "" {
		query = query.Where("posts.campus = ?", campus)
	}
	if keyword != "" {
		// LOCATE 实现字面包含搜索，用户输入的 %/_ 不被当成 SQL 通配符。
		query = query.Where(
			"LOCATE(?, posts.item_name) > 0 OR LOCATE(?, posts.location) > 0 OR LOCATE(?, posts.description) > 0",
			keyword, keyword, keyword,
		)
	}
	return query
}

// supersedePendingReview 取消过期审核任务，快照内容保留且永不改写。
func supersedePendingReview(tx *gorm.DB, postID uint64, now time.Time) error {
	if err := tx.Table("post_reviews").
		Where("post_id = ? AND decision = ?", postID, "pending").
		Updates(map[string]any{
			"decision":     "superseded",
			"processed_at": now,
		}).Error; err != nil {
		return postDatabaseError(err)
	}
	return nil
}

// postReadError 将不存在与不可见资源统一为 404，其他数据库错误保留错误链。
func postReadError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errs.ResourceNotFoundError
	}
	return postDatabaseError(err)
}

func postDatabaseError(err error) error {
	return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
}
