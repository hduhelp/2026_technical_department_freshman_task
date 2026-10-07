package service

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/config"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ImageMaxBytes 是接口合同规定的单图大小上限，上传和代理读取使用同一个值。
const ImageMaxBytes = 5 * 1024 * 1024

// UploadPostImage 使用真实图片内容决定 MIME/扩展名；不信任文件名或表单 Content-Type。
func UploadPostImage(
	ctx context.Context,
	actor entity.AuthUser,
	data []byte,
) (*vo.ImageUploadResponseVO, error) {
	if len(data) > ImageMaxBytes {
		return nil, errs.FileTooLargeError
	}
	if len(data) == 0 {
		return nil, errs.UnsupportedMediaTypeError
	}

	imageConfig, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png") {
		return nil, errs.UnsupportedMediaTypeError
	}
	// ponytail: 解码最多 3200 万像素；需要超大原图时改成隔离的流式验证/缩图任务。
	if imageConfig.Width <= 0 || imageConfig.Height <= 0 || int64(imageConfig.Width)*int64(imageConfig.Height) > 32_000_000 {
		return nil, errs.UnsupportedMediaTypeError
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return nil, errs.UnsupportedMediaTypeError
	}

	extension := ".jpg"
	mimeType := "image/jpeg"
	if format == "png" {
		extension = ".png"
		mimeType = "image/png"
	}
	filename := uuid.NewString() + extension
	key := imageObjectPrefix(actor.ID) + filename

	// 上传同样在写事务内重查登录版本，防止中间件验证后账号被禁用仍能上传。
	err = WriteTransaction(ctx, actor, false, func(tx *gorm.DB) error {
		bucket, err := imageBucket()
		if err != nil {
			return err
		}
		if err := bucket.PutObject(
			key,
			bytes.NewReader(data),
			oss.ContentType(mimeType),
			oss.SetHeader(oss.HTTPHeaderOssForbidOverWrite, "true"),
			oss.WithContext(ctx),
		); err != nil {
			return errs.OSSUnavailableError
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return &vo.ImageUploadResponseVO{
		ObjectKey:  key,
		PreviewURL: "/api/v1/users/me/image-uploads/" + filename + "/content",
		MIMEType:   mimeType,
		SizeBytes:  int64(len(data)),
	}, nil
}

// ValidatePostImages 验证图片 Key 归属、存在性及上传格式；不建图片表，也不接受外部 URL。
func ValidatePostImages(ctx context.Context, userID uint64, keys []string) error {
	if len(keys) > 6 {
		return errs.ValidationError
	}
	if len(keys) == 0 {
		return nil
	}

	seen := make(map[string]bool, len(keys))
	for _, key := range keys {
		if seen[key] || !validImageKey(userID, key) {
			return errs.ValidationError
		}
		seen[key] = true
	}

	bucket, err := imageBucket()
	if err != nil {
		return err
	}
	for _, key := range keys {
		head, err := bucket.GetObjectDetailedMeta(key, oss.WithContext(ctx))
		if err != nil {
			if missingImage(err) {
				return errs.ValidationError
			}
			return errs.OSSUnavailableError
		}
		size, err := strconv.ParseInt(head.Get("Content-Length"), 10, 64)
		if err != nil || size < 1 || size > ImageMaxBytes {
			return errs.ValidationError
		}
		mimeType := strings.Split(head.Get("Content-Type"), ";")[0]
		if mimeType != "image/jpeg" && mimeType != "image/png" {
			return errs.ValidationError
		}
	}
	return nil
}

// PreviewPostImage 仅按本人前缀构建 Key，拒绝路径穿越、Bucket 或 URL 输入。
func PreviewPostImage(
	ctx context.Context,
	actor entity.AuthUser,
	filename string,
	size ...string,
) ([]byte, string, error) {
	if !validImageFilename(filename) {
		return nil, "", errs.ResourceNotFoundError
	}
	return readPrivateImage(ctx, imageObjectPrefix(actor.ID)+filename, size...)
}

// ReadPostImage 每次核对当前内容版本及可见权限，旧 revision 不会读取到新内容图片。
func ReadPostImage(
	ctx context.Context,
	actor entity.AuthUser,
	postID uint64,
	index int,
	revision uint32,
	size ...string,
) ([]byte, string, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, "", err
	}

	var post entity.Post
	if err := db.Table("posts").
		Where("id = ?", postID).
		Take(&post).Error; err != nil {
		return nil, "", postReadError(err)
	}
	if err := canReadPost(db, actor, post); err != nil {
		return nil, "", err
	}
	if post.Revision != revision || index < 0 || index >= len(post.Images) || !validImageKey(post.AuthorID, post.Images[index]) {
		return nil, "", errs.ResourceNotFoundError
	}
	return readPrivateImage(ctx, post.Images[index], size...)
}

// ReadReviewImage 从指定帖子的不可变审核快照中取图，普通读者不能读取历史内容。
func ReadReviewImage(
	ctx context.Context,
	actor entity.AuthUser,
	postID, reviewID uint64,
	index int,
	size ...string,
) ([]byte, string, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, "", err
	}

	var post entity.Post
	if err := db.Table("posts").
		Select("id", "author_id").
		Where("id = ?", postID).
		Take(&post).Error; err != nil {
		return nil, "", postReadError(err)
	}
	if post.AuthorID != actor.ID && actor.Role != "admin" {
		return nil, "", errs.ResourceNotFoundError
	}

	var review entity.PostReview
	if err := db.Table("post_reviews").
		Where("id = ? AND post_id = ?", reviewID, postID).
		Take(&review).Error; err != nil {
		return nil, "", postReadError(err)
	}
	if index < 0 || index >= len(review.ContentSnapshot.Images) || !validImageKey(post.AuthorID, review.ContentSnapshot.Images[index]) {
		return nil, "", errs.ResourceNotFoundError
	}
	return readPrivateImage(ctx, review.ContentSnapshot.Images[index], size...)
}

// imageBucket 只使用后端固定配置；不接受请求提供 Endpoint、Bucket 或签名 URL。
func imageBucket() (*oss.Bucket, error) {
	cfg := config.ServerConfig.AliOSS
	if cfg.Endpoint == "" || cfg.AccessKeyId == "" || cfg.AccessKeySecret == "" || cfg.BucketName == "" {
		return nil, errs.OSSUnavailableError
	}

	client, err := oss.New(
		cfg.Endpoint,
		cfg.AccessKeyId,
		cfg.AccessKeySecret,
		oss.Timeout(3, 10),
		oss.RedirectEnabled(false),
		oss.HTTPClient(&http.Client{
			Timeout: 10 * time.Second,
		}),
	)
	if err != nil {
		return nil, errs.OSSUnavailableError
	}
	bucket, err := client.Bucket(cfg.BucketName)
	if err != nil {
		return nil, errs.OSSUnavailableError
	}
	return bucket, nil
}

// readPrivateImage 通过后端代理返回有限大小图片；任何错误在开始图片响应前处理。
func readPrivateImage(ctx context.Context, key string, size ...string) ([]byte, string, error) {
	options := []oss.Option{oss.WithContext(ctx)}
	variant := "original"
	if len(size) > 0 && size[0] != "" {
		variant = size[0]
	}
	switch variant {
	case "original":
	case "cover":
		options = append(options, oss.Process("image/resize,m_lfit,w_480,h_480/format,jpg/quality,q_80"))
	case "display":
		options = append(options, oss.Process("image/resize,m_lfit,w_1280,h_1280/format,jpg/quality,q_85"))
	default:
		return nil, "", errs.ValidationError
	}
	started := time.Now()
	bucket, err := imageBucket()
	if err != nil {
		return nil, "", err
	}

	body, err := bucket.GetObject(key, options...)
	headersElapsed := time.Since(started)
	if err != nil {
		log.Printf("OSS image stage=headers size=%s elapsed=%s deadline=%t error_type=%T", variant, headersElapsed, errors.Is(err, context.DeadlineExceeded), err)
		if missingImage(err) {
			return nil, "", errs.ResourceNotFoundError
		}
		return nil, "", errs.OSSUnavailableError
	}
	defer body.Close()

	data, err := io.ReadAll(io.LimitReader(body, ImageMaxBytes+1))
	if err != nil || len(data) > ImageMaxBytes {
		log.Printf("OSS image stage=body size=%s headers=%s total=%s bytes=%d deadline=%t error_type=%T", variant, headersElapsed, time.Since(started), len(data), errors.Is(err, context.DeadlineExceeded), err)
		return nil, "", errs.OSSUnavailableError
	}
	log.Printf("OSS image stage=complete size=%s headers=%s total=%s bytes=%d", variant, headersElapsed, time.Since(started), len(data))
	mimeType := http.DetectContentType(data)
	if mimeType != "image/jpeg" && mimeType != "image/png" {
		return nil, "", errs.OSSUnavailableError
	}
	return data, mimeType, nil
}

func imageObjectPrefix(userID uint64) string {
	return "posts/users/" + strconv.FormatUint(userID, 10) + "/"
}

func validImageKey(userID uint64, key string) bool {
	prefix := imageObjectPrefix(userID)
	return strings.HasPrefix(key, prefix) && validImageFilename(strings.TrimPrefix(key, prefix))
}

// validImageFilename 仅接受上传接口生成的规范 UUID 文件名；不能包含目录或 URL。
func validImageFilename(filename string) bool {
	extension := path.Ext(filename)
	if extension != ".jpg" && extension != ".png" {
		return false
	}
	name := strings.TrimSuffix(filename, extension)
	id, err := uuid.Parse(name)
	return err == nil && id.String() == name && len(name) == 36
}

func missingImage(err error) bool {
	var upstream oss.ServiceError
	return errors.As(err, &upstream) && upstream.StatusCode == http.StatusNotFound
}
