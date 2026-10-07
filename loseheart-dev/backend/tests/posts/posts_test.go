package posts_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	errs "lost-found/backend/common/errors"
	"lost-found/backend/common/utils"
	"lost-found/backend/global"
	"lost-found/backend/internal/config"
	userController "lost-found/backend/internal/controller/user"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin/binding"
	"github.com/google/uuid"
	"gorm.io/gorm/logger"
)

// TestPostValidation 留下可重复运行的跨字段与空数组检查，不依赖外部服务。
func TestPostValidation(t *testing.T) {
	input := postInput()
	if err := binding.Validator.ValidateStruct(input); err != nil {
		t.Fatal("empty images array must be accepted", err)
	}
	if err := userController.ValidatePostContent(input); err != nil {
		t.Fatal(err)
	}
	bad := input
	bad.Description = " \t\n"
	if err := userController.ValidatePostContent(bad); !errors.Is(err, errs.ValidationError) {
		t.Fatal("blank description accepted")
	}
	bad = input
	start, end := "15:00", "14:00"
	bad.TimePrecision, bad.EventTimeStart, bad.EventTimeEnd = "range", &start, &end
	if err := userController.ValidatePostContent(bad); !errors.Is(err, errs.ValidationError) {
		t.Fatal("reverse time range accepted")
	}
	bad = input
	bad.TimePrecision = "exact"
	shortHour := "2:04"
	bad.EventTimeStart = &shortHour
	if err := userController.ValidatePostContent(bad); !errors.Is(err, errs.ValidationError) {
		t.Fatal("non-canonical HH:mm accepted")
	}
	bad = input
	bad.ContactMethods = []dto.ContactMethodDTO{{Type: "phone", Value: "110"}}
	if err := userController.ValidatePostContent(bad); !errors.Is(err, errs.ValidationError) {
		t.Fatal("invalid phone accepted")
	}
	bad.ContactMethods = []dto.ContactMethodDTO{{Type: "qq", Value: "abcd123"}}
	if err := userController.ValidatePostContent(bad); !errors.Is(err, errs.ValidationError) {
		t.Fatal("invalid QQ accepted")
	}
	bad.ContactMethods = []dto.ContactMethodDTO{{Type: "other", Value: strings.Repeat("字", 201)}}
	if err := binding.Validator.ValidateStruct(bad); err == nil {
		t.Fatal("overlong unicode contact accepted")
	}
	bad = input
	bad.Images = nil
	if err := binding.Validator.ValidateStruct(bad); err == nil {
		t.Fatal("missing images array accepted")
	}
	if err := service.ValidatePostImages(context.Background(), 123, []string{"posts/users/456/" + uuid.NewString() + ".png"}); !errors.Is(err, errs.ValidationError) {
		t.Fatal("another owner's key accepted")
	}
	if _, _, err := service.PreviewPostImage(context.Background(), entity.AuthUser{ID: 123}, "../"+uuid.NewString()+".png"); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("path traversal accepted")
	}
	if _, err := service.UploadPostImage(context.Background(), entity.AuthUser{ID: 123}, []byte("fake jpeg")); !errors.Is(err, errs.UnsupportedMediaTypeError) {
		t.Fatal("fake image accepted")
	}
}

// TestPostsIntegration 创建独立测试用户与帖子，只清理这些记录，不修改演示账号。
// LOST_FOUND_INTEGRATION=1 go test ./tests/posts -run Integration -v
func TestPostsIntegration(t *testing.T) {
	if os.Getenv("LOST_FOUND_INTEGRATION") != "1" {
		t.Skip("requires local MySQL and Redis")
	}
	previous, _ := os.Getwd()
	if err := os.Chdir(filepath.Join(previous, "../..")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(previous) })
	config.Init()
	global.Db.Logger = logger.Default.LogMode(logger.Silent)
	db, err := global.Db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close(); _ = global.RedisClient.Close() })
	ctx := context.Background()
	hash, err := utils.HashPassword("PostTest123!")
	if err != nil {
		t.Fatal(err)
	}
	users := make([]entity.User, 3)
	for index := range users {
		users[index] = entity.User{AccountNo: "p_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:22], IdentityType: "student", Nickname: "帖子测试", PasswordHash: hash, TokenVersion: 1, Role: "user", Status: "active", IsVerified: true, PasswordChangedAt: time.Now().UTC()}
		if index == 2 {
			users[index].Role = "admin"
		}
		if err := global.Db.Table("users").Create(&users[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	ids := []uint64{users[0].ID, users[1].ID, users[2].ID}
	t.Cleanup(func() {
		var posts []entity.Post
		global.Db.Table("posts").Where("author_id IN ?", ids).Find(&posts)
		postIDs := make([]uint64, 0, len(posts))
		for _, post := range posts {
			postIDs = append(postIDs, post.ID)
		}
		if len(postIDs) > 0 {
			global.Db.Table("post_reviews").Where("post_id IN ?", postIDs).Delete(&entity.PostReview{})
			global.Db.Table("posts").Where("id IN ?", postIDs).Delete(&entity.Post{})
		}
		global.Db.Table("post_daily_quotas").Where("user_id IN ?", ids).Delete(&entity.PostDailyQuota{})
		global.Db.Table("users").Where("id IN ?", ids).Delete(&entity.User{})
	})
	actor := entity.AuthUser{ID: users[0].ID, TokenVersion: 1, Role: "user", Status: "active", IsVerified: true}
	reader := entity.AuthUser{ID: users[1].ID, TokenVersion: 1, Role: "user", Status: "active", IsVerified: true}
	admin := entity.AuthUser{ID: users[2].ID, TokenVersion: 1, Role: "admin", Status: "active", IsVerified: true}
	key := uuid.NewString()
	input := dto.CreatePostDTO{PostContentDTO: postInput()}
	data, created, err := service.CreatePost(ctx, actor, key, input)
	if err != nil || !created {
		t.Fatalf("create: %v", err)
	}
	post := data.(*vo.OwnerPostDetailVO)
	postID, _ := strconv.ParseUint(post.ID, 10, 64)
	if post.ReviewStatus != "pending" || post.Revision != 1 || post.StateVersion != 1 {
		t.Fatal("initial state mismatch")
	}
	if _, _, err := service.CreatePost(ctx, actor, key, input); err != nil {
		t.Fatal("idempotent retry failed", err)
	}
	changed := input
	changed.ItemName = "另一件物品"
	if _, _, err := service.CreatePost(ctx, actor, key, changed); !errors.Is(err, errs.IdempotencyConflictError) {
		t.Fatal("same key different content accepted")
	}
	if _, err := service.GetPostDetail(ctx, reader, postID, false); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("reader saw pending post")
	}
	if _, err := service.GetPostDetail(ctx, admin, postID, true); err != nil {
		t.Fatal("admin cannot see pending post", err)
	}
	if _, err := service.UpdatePost(ctx, reader, postID, post.ETag, dto.UpdatePostDTO{PostContentDTO: postInput()}); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("non-author edit accepted")
	}
	if _, err := service.UpdatePost(ctx, actor, postID, `"post-0-v0"`, dto.UpdatePostDTO{PostContentDTO: postInput()}); !errors.Is(err, errs.ResourceChangedError) {
		t.Fatal("stale ETag accepted")
	}
	if _, err := service.UpdatePostResolution(ctx, actor, postID, post.ETag, dto.PostResolutionDTO{ResolutionStatus: "completed"}); !errors.Is(err, errs.StateConflictError) {
		t.Fatal("pending post can be completed")
	}

	// 4 个并发新提交争用剩余 2 个名额，必须恰好 2 成功、2 额度拒绝。
	var group sync.WaitGroup
	results := make(chan error, 4)
	for range 4 {
		group.Add(1)
		go func() {
			defer group.Done()
			_, _, err := service.CreatePost(ctx, actor, uuid.NewString(), input)
			results <- err
		}()
	}
	group.Wait()
	close(results)
	success, limited := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, errs.PostQuotaExceededError) {
			limited++
		} else {
			t.Fatal(err)
		}
	}
	if success != 2 || limited != 2 {
		t.Fatalf("quota race: success=%d limited=%d", success, limited)
	}
	quota, err := service.GetPostQuota(ctx, actor.ID)
	if err != nil || quota.Used != 3 || quota.Remaining != 0 || quota.ResetsAt.Hour() != 0 {
		t.Fatal("quota mismatch", err)
	}
	if _, created, err := service.CreatePost(ctx, actor, key, input); err != nil || created {
		t.Fatal("quota blocked idempotent retry", err)
	}

	// 重提交产生新快照，旧 pending 失效，但不扣额。
	updated, err := service.UpdatePost(ctx, actor, postID, post.ETag, dto.UpdatePostDTO{PostContentDTO: changed.PostContentDTO})
	if err != nil {
		t.Fatal(err)
	}
	post = updated.(*vo.OwnerPostDetailVO)
	history, err := service.ListPostReviews(ctx, actor, postID, dto.PageQueryDTO{})
	if err != nil || len(history.Records) != 2 || history.Records[0].Decision != "pending" || history.Records[1].Decision != "superseded" {
		t.Fatal("revision history mismatch", err)
	}
	if history.Records[1].ContentSnapshot.ItemName != input.ItemName {
		t.Fatal("old snapshot changed")
	}
	replay, _, err := service.CreatePost(ctx, actor, key, input)
	if err != nil || replay.(*vo.OwnerPostDetailVO).Revision != 2 {
		t.Fatal("retry must return current detail", err)
	}

	// 人工设为已审核，检查公开详情不会泄露图片 Key，完成后再编辑保留完成标记。
	now := time.Now().UTC()
	if err := global.Db.Table("posts").Where("id = ?", postID).Updates(map[string]any{"review_status": "approved", "reviewed_by": users[2].ID, "reviewed_at": now, "first_published_at": now, "state_version": 3}).Error; err != nil {
		t.Fatal(err)
	}
	visible, err := service.GetPostDetail(ctx, reader, postID, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := visible.(*vo.PostDetailVO); !ok {
		t.Fatal("reader got owner-only fields")
	}
	feed, err := service.ListPosts(ctx, dto.PostQueryDTO{Keyword: changed.ItemName})
	if err != nil || feed.Total != 1 {
		t.Fatal("approved post not searchable", err)
	}
	state, err := service.UpdatePostResolution(ctx, actor, postID, visible.(*vo.PostDetailVO).ETag, dto.PostResolutionDTO{ResolutionStatus: "completed"})
	if err != nil || state.CompletedAt == nil {
		t.Fatal("complete failed", err)
	}
	updated, err = service.UpdatePost(ctx, actor, postID, state.ETag, dto.UpdatePostDTO{PostContentDTO: input.PostContentDTO})
	if err != nil {
		t.Fatal(err)
	}
	post = updated.(*vo.OwnerPostDetailVO)
	if post.ResolutionStatus != "completed" || post.CompletedAt == nil || post.ReviewStatus != "pending" {
		t.Fatal("edit lost completion state")
	}
	if _, err := service.GetPostDetail(ctx, reader, postID, false); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("reader saw resubmitted post")
	}
	state, err = service.UpdatePostResolution(ctx, actor, postID, post.ETag, dto.PostResolutionDTO{ResolutionStatus: "withdrawn"})
	if err != nil || state.WithdrawnAt == nil {
		t.Fatal("withdraw failed", err)
	}
	noChange, err := service.UpdatePostResolution(ctx, actor, postID, state.ETag, dto.PostResolutionDTO{ResolutionStatus: "withdrawn"})
	if err != nil || noChange.StateVersion != state.StateVersion {
		t.Fatal("same state must be no-op", err)
	}
	if _, err := service.UpdatePost(ctx, actor, postID, state.ETag, dto.UpdatePostDTO{PostContentDTO: input.PostContentDTO}); !errors.Is(err, errs.StateConflictError) {
		t.Fatal("withdrawn post edited")
	}
	if _, err := service.UpdatePostResolution(ctx, actor, postID, state.ETag, dto.PostResolutionDTO{ResolutionStatus: "active"}); !errors.Is(err, errs.StateConflictError) {
		t.Fatal("withdrawn post restored")
	}
	if _, err := service.ListPostReviews(ctx, reader, postID, dto.PageQueryDTO{}); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("reader saw history")
	}

	// 使用隔离的 HTTP RoundTripper 模拟 OSS，验证上传与代理的真实 SDK 请求链。
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	previousTransport := http.DefaultTransport
	previousOSS := config.ServerConfig.AliOSS
	t.Cleanup(func() { http.DefaultTransport = previousTransport; config.ServerConfig.AliOSS = previousOSS })
	config.ServerConfig.AliOSS.Endpoint = "https://oss-cn-beijing.aliyuncs.com"
	config.ServerConfig.AliOSS.BucketName, config.ServerConfig.AliOSS.AccessKeyId, config.ServerConfig.AliOSS.AccessKeySecret = "test-bucket", "test-key", "test-secret"
	objects := make(map[string][]byte)
	var imageProcess string
	http.DefaultTransport = transportFunc(func(request *http.Request) (*http.Response, error) {
		key := strings.TrimPrefix(request.URL.Path, "/")
		if request.Method == http.MethodGet {
			imageProcess = request.URL.Query().Get("x-oss-process")
		}
		body := []byte{}
		header := make(http.Header)
		status := 200
		switch request.Method {
		case http.MethodPut:
			body, _ = io.ReadAll(request.Body)
			objects[key] = body
			body = []byte{}
		case http.MethodHead, http.MethodGet:
			data, ok := objects[key]
			if !ok {
				status = 404
				body = []byte(`<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>`)
			} else {
				header.Set("Content-Length", strconv.Itoa(len(data)))
				header.Set("Content-Type", "image/png")
				if request.Method == http.MethodGet {
					body = data
				}
			}
		}
		return &http.Response{StatusCode: status, Header: header, Body: io.NopCloser(bytes.NewReader(body)), Request: request}, nil
	})
	uploaded, err := service.UploadPostImage(ctx, reader, imageData.Bytes())
	if err != nil {
		t.Fatal("image upload failed", err)
	}
	if uploaded.MIMEType != "image/png" || !strings.HasPrefix(uploaded.ObjectKey, "posts/users/"+strconv.FormatUint(reader.ID, 10)+"/") {
		t.Fatal("upload metadata mismatch")
	}
	if err := service.ValidatePostImages(ctx, reader.ID, []string{uploaded.ObjectKey}); err != nil {
		t.Fatal("uploaded image rejected", err)
	}
	got, mimeType, err := service.PreviewPostImage(ctx, reader, filepath.Base(uploaded.ObjectKey))
	if err != nil || mimeType != "image/png" || !bytes.Equal(got, imageData.Bytes()) {
		t.Fatal("preview failed", err)
	}
	if _, _, err := service.PreviewPostImage(ctx, actor, filepath.Base(uploaded.ObjectKey)); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("other user preview allowed", err)
	}
	imageInput := dto.CreatePostDTO{PostContentDTO: postInput()}
	imageInput.Images = []string{uploaded.ObjectKey}
	imagePostData, _, err := service.CreatePost(ctx, reader, uuid.NewString(), imageInput)
	if err != nil {
		t.Fatal("post cannot reference uploaded image", err)
	}
	imagePost := imagePostData.(*vo.OwnerPostDetailVO)
	imagePostID, _ := strconv.ParseUint(imagePost.ID, 10, 64)
	got, _, err = service.ReadPostImage(ctx, reader, imagePostID, 0, imagePost.Revision)
	if err != nil || !bytes.Equal(got, imageData.Bytes()) {
		t.Fatal("current image proxy failed", err)
	}
	for _, size := range []string{"cover", "display"} {
		if _, _, err := service.ReadPostImage(ctx, reader, imagePostID, 0, imagePost.Revision, size); err != nil || !strings.Contains(imageProcess, "image/resize") || !strings.Contains(imageProcess, "format,jpg") {
			t.Fatal("processed image request failed", err, imageProcess)
		}
		if _, _, err := service.ReadPostImage(ctx, actor, imagePostID, 0, imagePost.Revision, size); !errors.Is(err, errs.ResourceNotFoundError) {
			t.Fatal("processed hidden image leaked", err)
		}
	}
	if _, _, err := service.ReadPostImage(ctx, reader, imagePostID, 0, imagePost.Revision, "arbitrary"); !errors.Is(err, errs.ValidationError) {
		t.Fatal("unrestricted processing accepted", err)
	}
	if _, _, err := service.ReadPostImage(ctx, actor, imagePostID, 0, imagePost.Revision); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("hidden post image leaked", err)
	}
	imageHistory, err := service.ListPostReviews(ctx, reader, imagePostID, dto.PageQueryDTO{})
	if err != nil || len(imageHistory.Records) != 1 {
		t.Fatal("image snapshot missing", err)
	}
	reviewID, _ := strconv.ParseUint(imageHistory.Records[0].ID, 10, 64)
	got, _, err = service.ReadReviewImage(ctx, reader, imagePostID, reviewID, 0)
	if err != nil || !bytes.Equal(got, imageData.Bytes()) {
		t.Fatal("historical image proxy failed", err)
	}
	if _, _, err := service.ReadReviewImage(ctx, actor, imagePostID, reviewID, 0); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("history image leaked", err)
	}
	if _, _, err := service.ReadReviewImage(ctx, admin, postID, reviewID, 0); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("cross-post review image accepted", err)
	}
	if _, err := service.UpdatePost(ctx, reader, imagePostID, imagePost.ETag, dto.UpdatePostDTO{PostContentDTO: postInput()}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.ReadPostImage(ctx, reader, imagePostID, 0, 1); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("old image revision allowed", err)
	}
	if _, _, err := service.ReadReviewImage(ctx, reader, imagePostID, reviewID, 0); err != nil {
		t.Fatal("old immutable image lost after edit", err)
	}
	if _, _, err := service.ReadReviewImage(ctx, reader, imagePostID, reviewID, 5); !errors.Is(err, errs.ResourceNotFoundError) {
		t.Fatal("out-of-range index accepted", err)
	}
	future := dto.CreatePostDTO{PostContentDTO: postInput()}
	future.EventDate = time.Now().Add(48 * time.Hour).Format("2006-01-02")
	if _, _, err := service.CreatePost(ctx, reader, uuid.NewString(), future); !errors.Is(err, errs.ValidationError) {
		t.Fatal("future event accepted", err)
	}
	if err := global.Db.Table("users").Where("id = ?", reader.ID).Update("token_version", 2).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.UploadPostImage(ctx, reader, imageData.Bytes()); !errors.Is(err, errs.TokenRevokedError) {
		t.Fatal("stale token uploaded image", err)
	}
}

func postInput() dto.PostContentDTO {
	return dto.PostContentDTO{PostType: "lost", ItemName: "帖子测试校园卡", Campus: "xiasha", Location: "图书馆", EventDate: "2026-01-01", TimePrecision: "date", Description: "黑色卡套", Images: []string{}, ContactMethods: []dto.ContactMethodDTO{{Type: "wechat", Value: "test_contact"}}}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
