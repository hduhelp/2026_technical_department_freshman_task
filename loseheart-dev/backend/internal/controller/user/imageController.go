package user

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	errs "lost-found/backend/common/errors"
	ctrl "lost-found/backend/internal/controller"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// UploadImage 只接收一张 JPEG/PNG；限制整个 multipart 请求并清理解析临时文件。
func UploadImage(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}

	kind, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || kind != "multipart/form-data" {
		ctrl.Fail(c, errs.UnsupportedMediaTypeError)
		return
	}

	c.Request.Body = http.MaxBytesReader(
		c.Writer,
		c.Request.Body,
		service.ImageMaxBytes+64*1024,
	)
	err = c.Request.ParseMultipartForm(service.ImageMaxBytes + 64*1024)
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			ctrl.Fail(c, errs.FileTooLargeError)
		} else {
			ctrl.Fail(c, errs.InvalidRequestError)
		}
		return
	}

	form := c.Request.MultipartForm
	if form == nil || len(form.File) != 1 || len(form.File["file"]) != 1 || len(form.Value) != 0 {
		ctrl.Fail(c, errs.InvalidRequestError)
		return
	}

	file := form.File["file"][0]
	if file.Size > service.ImageMaxBytes {
		ctrl.Fail(c, errs.FileTooLargeError)
		return
	}

	reader, err := file.Open()
	if err != nil {
		ctrl.Fail(c, errs.InvalidRequestError)
		return
	}

	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, service.ImageMaxBytes+1))
	if err != nil {
		ctrl.Fail(c, errs.InvalidRequestError)
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()
	result, err := service.UploadPostImage(ctx, actor, data)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	ctrl.Success(c, http.StatusCreated, result)
}

// PreviewImage 本人上传尚未发帖的图片也可预览；filename 由服务层严格解析。
func PreviewImage(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}

	var input dto.ImageQueryDTO
	if !ctrl.BindQuery(c, &input) {
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	data, kind, err := service.PreviewPostImage(ctx, actor, c.Param("filename"), input.Size)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	writeImage(c, data, kind)
}

// GetPostImage 读取当前内容版本中的图片，revision 必填且不能借旧 URL 读取新图。
func GetPostImage(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}
	index, ok := imageIndex(c)
	if !ok {
		return
	}

	var input dto.PostImageQueryDTO
	if !ctrl.BindQuery(c, &input) {
		return
	}

	ctx, cancel := ctrl.Context(c)
	defer cancel()
	data, kind, err := service.ReadPostImage(ctx, actor, id, index, input.Revision, input.Size)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	writeImage(c, data, kind)
}

// GetReviewImage 作者或管理员读取指定审核快照中的历史图片。
func GetReviewImage(c *gin.Context) {
	actor, ok := ctrl.Actor(c)
	if !ok {
		return
	}
	id, ok := ctrl.PathID(c, "id")
	if !ok {
		return
	}
	reviewID, ok := ctrl.PathID(c, "review_id")
	if !ok {
		return
	}
	index, ok := imageIndex(c)
	if !ok {
		return
	}

	var input dto.ImageQueryDTO
	if !ctrl.BindQuery(c, &input) {
		return
	}
	ctx, cancel := ctrl.Context(c)
	defer cancel()
	data, kind, err := service.ReadReviewImage(ctx, actor, id, reviewID, index, input.Size)
	if err != nil {
		ctrl.Fail(c, err)
		return
	}
	writeImage(c, data, kind)
}

// imageIndex 接受非负十进制下标；超出最多 6 张图片的范围统一返回资源不存在。
func imageIndex(c *gin.Context) (int, bool) {
	value := c.Param("index")
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			ctrl.Fail(c, errs.InvalidRequestError)
			return 0, false
		}
	}

	index, err := strconv.ParseUint(value, 10, 64)
	if err != nil || index > 5 {
		ctrl.Fail(c, errs.ResourceNotFoundError)
		return 0, false
	}
	return int(index), true
}

// writeImage 直接返回二进制并禁止缓存和 MIME 猜测，不把失败 JSON 伪装成图片。
func writeImage(c *gin.Context, data []byte, kind string) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, kind, data)
}
