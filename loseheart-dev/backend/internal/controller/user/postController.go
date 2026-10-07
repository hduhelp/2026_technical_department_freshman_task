package user

import (
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	errs "lost-found/backend/common/errors"
	ctrl "lost-found/backend/internal/controller"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/vo"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ListPosts 查询首页可见帖子；待审核、撤回和失效作者的帖子不会出现在首页。
func ListPosts(c *gin.Context) {
	var input dto.PostQueryDTO
	if !ctrl.BindQuery(c, &input) {
		return
	}
	if input.EventDateFrom != "" && input.EventDateTo != "" && input.EventDateFrom > input.EventDateTo {
		ctrl.Fail(c, errs.ValidationError)
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()
	data, err := service.ListPosts(ctx, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, data)
}

// CreatePost 提交新帖，使用 UUID 幂等键防止重试重复扣减当日额度。
func CreatePost(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}

	key, err := uuid.Parse(c.GetHeader("Idempotency-Key"))
	if err != nil || len(c.GetHeader("Idempotency-Key")) != 36 {
		ctrl.Fail(c, errs.InvalidRequestError)
		return
	}

	var input dto.CreatePostDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}
	if err := ValidatePostContent(input.PostContentDTO); err != nil {
		ctrl.Fail(c, err)
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()
	data, created, err := service.CreatePost(ctx, actor, key.String(), input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}

	setPostDetailETag(c, data)
	status := http.StatusOK
	if created {
		status = http.StatusCreated
		if detail, ok := data.(*vo.OwnerPostDetailVO); ok {
			c.Header("Location", "/api/v1/posts/"+detail.ID)
		}
	}

	ctrl.Success(c, status, data)
}

// GetPost 读取公开详情；作者与管理员额外得到编辑需要的图片 Key 和审核原因。
func GetPost(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()
	data, err := service.GetPostDetail(ctx, actor, id, false)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	setPostDetailETag(c, data)
	ctrl.Success(c, http.StatusOK, data)
}

// UpdatePost 完整替换本人帖子并重新进入人工审核，写入前校验 If-Match。
func UpdatePost(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}
	etag, ok := ctrl.IfMatch(c)
	if !ok {
		return
	}

	var input dto.UpdatePostDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}
	if err := ValidatePostContent(input.PostContentDTO); err != nil {
		ctrl.Fail(c, err)
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()
	data, err := service.UpdatePost(ctx, actor, id, etag, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	setPostDetailETag(c, data)
	ctrl.Success(c, http.StatusOK, data)
}

// UpdatePostResolution 设置完成、撤销完成或不可恢复的撤回状态。
func UpdatePostResolution(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}
	etag, ok := ctrl.IfMatch(c)
	if !ok {
		return
	}

	var input dto.PostResolutionDTO
	if !ctrl.BindJSON(c, &input) {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()
	data, err := service.UpdatePostResolution(ctx, actor, id, etag, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	c.Header("ETag", data.ETag)
	ctrl.Success(c, http.StatusOK, data)
}

// ListPostReviews 仅供作者或管理员追溯不可变的历史提交快照。
func ListPostReviews(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}

	var input dto.PageQueryDTO
	if !ctrl.BindQuery(c, &input) {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()
	data, err := service.ListPostReviews(ctx, actor, id, input)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusOK, data)
}

// ValidatePostContent 校验跨字段组合；Gin 的字段标签负责长度和枚举基础校验。
func ValidatePostContent(input dto.PostContentDTO) error {
	for _, text := range []string{input.ItemName, input.Location, input.Description} {
		if strings.TrimSpace(text) == "" || !utf8.ValidString(text) {
			return errs.ValidationError
		}
	}

	switch input.TimePrecision {
	case "date":
		if input.EventTimeStart != nil || input.EventTimeEnd != nil {
			return errs.ValidationError
		}
	case "exact":
		if input.EventTimeStart == nil || input.EventTimeEnd != nil {
			return errs.ValidationError
		}
	case "range":
		if input.EventTimeStart == nil || input.EventTimeEnd == nil || *input.EventTimeStart > *input.EventTimeEnd {
			return errs.ValidationError
		}
	default:
		return errs.ValidationError
	}

	for _, value := range []*string{input.EventTimeStart, input.EventTimeEnd} {
		if value != nil {
			parsed, err := time.Parse("15:04", *value)
			if err != nil || parsed.Format("15:04") != *value {
				return errs.ValidationError
			}
		}
	}

	phone := regexp.MustCompile(`^1[3-9][0-9]{9}$`)
	qq := regexp.MustCompile(`^[0-9]{5,12}$`)
	for _, contact := range input.ContactMethods {
		value := strings.TrimSpace(contact.Value)
		if value == "" || !utf8.ValidString(value) {
			return errs.ValidationError
		}
		if contact.Type == "phone" && !phone.MatchString(value) {
			return errs.ValidationError
		}
		if contact.Type == "qq" && !qq.MatchString(value) {
			return errs.ValidationError
		}
	}
	return nil
}

// setPostDetailETag 保持响应头与详情 JSON 中的并发版本一致。
func setPostDetailETag(c *gin.Context, data any) {
	switch value := data.(type) {
	case *vo.OwnerPostDetailVO:
		c.Header("ETag", value.ETag)
	case *vo.PostDetailVO:
		c.Header("ETag", value.ETag)
	}
}
