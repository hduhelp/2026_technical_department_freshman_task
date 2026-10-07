package integration_test

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"lost-found/backend/common/utils"
	"lost-found/backend/global"
	"lost-found/backend/internal/config"
	"lost-found/backend/internal/middleware"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"
	"lost-found/backend/internal/router"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm/logger"
)

// TestBackendWorkflowIntegration 从真实路由串起投稿、审核、编辑、举报处置及通知。
// 独立账号和记录在结束时按外键顺序清理，不改演示账号，不调用真实微信或上传 OSS。
func TestBackendWorkflowIntegration(t *testing.T) {
	if os.Getenv("LOST_FOUND_INTEGRATION") != "1" {
		t.Skip("requires local MySQL and Redis")
	}
	cwd, _ := os.Getwd()
	if err := os.Chdir(filepath.Join(cwd, "../..")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	config.Init()
	global.Db.Logger = logger.Default.LogMode(logger.Silent)
	db, err := global.Db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close(); _ = global.RedisClient.Close() })
	gin.SetMode(gin.TestMode)
	auth, err := middleware.NewAuthenticator(config.ServerConfig.Jwt, middleware.GORMUserLookup(global.Db))
	if err != nil {
		t.Fatal(err)
	}
	csrf, err := middleware.NewCSRFProtector(auth, middleware.CSRFConfig{
		SecretKey: config.ServerConfig.Jwt.CSRFSecretKey, CookieName: config.ServerConfig.Jwt.CSRFCookieName,
		AllowedOrigins: config.ServerConfig.CSRF.AllowedOrigins, SecureCookie: config.ServerConfig.CSRF.SecureCookie,
	})
	if err != nil {
		t.Fatal(err)
	}
	r, err := router.InitRouter(auth, csrf)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := utils.HashPassword("BackendTest123!")
	if err != nil {
		t.Fatal(err)
	}
	prefix := "flow_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	var ids []uint64
	var tokens []string
	t.Cleanup(func() {
		if len(ids) == 0 {
			return
		}
		var postIDs []uint64
		global.Db.Table("posts").Where("author_id IN ?", ids).Pluck("id", &postIDs)
		for _, table := range []string{"notifications", "admin_operation_logs", "post_reports", "post_reviews", "posts", "post_daily_quotas", "users"} {
			column, values := "user_id", ids
			switch table {
			case "admin_operation_logs":
				column = "operator_id"
			case "post_reports", "post_reviews":
				column, values = "post_id", postIDs
			case "posts":
				column = "author_id"
			case "users":
				column = "id"
			}
			if len(values) > 0 {
				if err := global.Db.Table(table).Where(column+" IN ?", values).Delete(map[string]any{}).Error; err != nil {
					t.Error("fixture cleanup failed", table, err)
				}
			}
		}
	})
	for index := 0; index < 3; index++ {
		user := entity.User{AccountNo: prefix + strconv.Itoa(index), IdentityType: "student", Nickname: "后端联调",
			PasswordHash: hash, TokenVersion: 1, Role: "user", Status: "active", IsVerified: true}
		if index == 2 {
			user.Role = "admin"
		}
		if err := global.Db.Table("users").Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		ids = append(ids, user.ID)
		token, _, err := utils.GenerateJWT(config.ServerConfig.Jwt, user.ID, user.TokenVersion)
		if err != nil {
			t.Fatal(err)
		}
		tokens = append(tokens, token)
	}
	// author=0，reader=1，admin=2；使用同一套真实认证/权限中间件。
	request := func(actor int, method, path string, body any, headers map[string]string, want int) *httptest.ResponseRecorder {
		var encoded []byte
		if body != nil {
			encoded, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(string(encoded)))
		req.Header.Set("Authorization", "Bearer "+tokens[actor])
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: status=%d want=%d: %s", method, path, w.Code, want, w.Body)
		}
		if w.Header().Get("X-Request-ID") == "" || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("missing response protection for %s %s", method, path)
		}
		return w
	}
	match := func(etag string) map[string]string { return map[string]string{"If-Match": etag} }
	input := dto.CreatePostDTO{PostContentDTO: dto.PostContentDTO{
		PostType: "lost", ItemName: prefix, Campus: "xiasha", Location: "图书馆",
		EventDate: time.Now().In(time.FixedZone("Beijing", 8*3600)).Format("2006-01-02"), TimePrecision: "date",
		Description: "黑色卡套", Images: []string{}, ContactMethods: []dto.ContactMethodDTO{{Type: "wechat", Value: "demo-contact"}},
	}}
	key := map[string]string{"Idempotency-Key": uuid.NewString()}
	request(0, "GET", "/posts?page=9223372036854775807&page_size=50", nil, nil, 400)
	request(0, "GET", "/posts?event_date_from=0000-01-01", nil, nil, 400)
	bad := input
	bad.EventDate = "0000-01-01"
	request(0, "POST", "/posts", bad, key, 400)
	request(0, "POST", "/posts", map[string]any{"extra": true}, key, 400)

	created := dataOf[vo.OwnerPostDetailVO](t, request(0, "POST", "/posts", input, key, 201))
	path := "/posts/" + created.ID
	request(1, "GET", path, nil, nil, 404)
	retry := dataOf[vo.OwnerPostDetailVO](t, request(0, "POST", "/posts", input, key, 200))
	if retry.ID != created.ID {
		t.Fatal("idempotent retry created another post")
	}
	bad = input
	bad.Description = "不同内容"
	request(0, "POST", "/posts", bad, key, 409)
	quota := dataOf[vo.PostQuotaResponseVO](t, request(0, "GET", "/users/me/post-quota", nil, nil, 200))
	if quota.Used != 1 || quota.Remaining != 2 {
		t.Fatal("failed/retried request consumed quota")
	}
	request(0, "GET", "/users/me/posts", nil, nil, 200)
	request(2, "GET", "/admin/posts?author_id="+strconv.FormatUint(ids[0], 10), nil, nil, 200)
	request(2, "GET", "/admin"+path, nil, nil, 200)
	request(1, "GET", path+"/reviews", nil, nil, 404)

	// 在 HTTP 边界取得审核 ETag，再按当前版本提交；作者无法通过编辑绕过重新审核。
	approve := func() {
		history := dataOf[vo.PageResultVO[vo.ReviewRecordVO]](t, request(0, "GET", path+"/reviews", nil, nil, 200))
		if len(history.Records) == 0 {
			t.Fatal("review snapshot missing")
		}
		reviewPath := "/admin/reviews/" + history.Records[0].ID
		detail := dataOf[vo.ReviewDetailVO](t, request(2, "GET", reviewPath, nil, nil, 200))
		request(2, "PUT", reviewPath+"/decision", map[string]string{"decision": "approved"}, nil, 400)
		request(2, "PUT", reviewPath+"/decision", map[string]string{"decision": "returned"}, match(detail.ETag), 400)
		request(2, "PUT", reviewPath+"/decision", map[string]string{"decision": "approved"}, match(detail.ETag), 200)
		request(2, "PUT", reviewPath+"/decision", map[string]string{"decision": "approved"}, match(detail.ETag), 412)
	}
	request(2, "GET", "/admin/reviews?post_id="+created.ID, nil, nil, 200)
	approve()
	public := dataOf[vo.PostDetailVO](t, request(1, "GET", path, nil, nil, 200))
	adminDetail := dataOf[vo.OwnerPostDetailVO](t, request(2, "GET", "/admin"+path, nil, nil, 200))
	if !public.CanReport || !adminDetail.CanReport {
		t.Fatal("report capability differs from visible-post permission")
	}
	if err := global.Db.Table("users").Where("id = ?", ids[0]).Update("is_verified", false).Error; err != nil {
		t.Fatal(err)
	}
	adminDetail = dataOf[vo.OwnerPostDetailVO](t, request(2, "GET", "/admin"+path, nil, nil, 200))
	if adminDetail.CanReport {
		t.Fatal("admin can_report incorrectly allows hidden author")
	}
	if err := global.Db.Table("users").Where("id = ?", ids[0]).Update("is_verified", true).Error; err != nil {
		t.Fatal(err)
	}
	firstPublished := public.FirstPublishedAt
	feed := dataOf[vo.PageResultVO[vo.PostListItemVO]](t, request(1, "GET", "/posts?keyword="+prefix, nil, nil, 200))
	if feed.Total != 1 || firstPublished == nil {
		t.Fatal("approved post missing from homepage")
	}
	reportInput := dto.CreateReportDTO{PostRevision: public.Revision, ReasonType: "false_information"}
	request(0, "POST", path+"/reports", reportInput, nil, 403)
	report := dataOf[vo.CreateReportResponseVO](t, request(1, "POST", path+"/reports", reportInput, nil, 201))
	duplicate := dataOf[vo.CreateReportResponseVO](t, request(1, "POST", path+"/reports", reportInput, nil, 200))
	if duplicate.ID != report.ID {
		t.Fatal("duplicate report created another record")
	}
	updatedInput := dto.UpdatePostDTO{PostContentDTO: input.PostContentDTO}
	updatedInput.Description = "补充：卡套没有挂绳"
	updated := dataOf[vo.OwnerPostDetailVO](t, request(0, "PUT", path, updatedInput, match(public.ETag), 200))
	request(0, "PUT", path, updatedInput, match(public.ETag), 412)
	request(1, "GET", path, nil, nil, 404)
	if updated.Revision != 2 || updated.ReviewStatus != "pending" {
		t.Fatal("edit failed to create pending revision")
	}
	reportPath := "/admin/reports/" + report.ID
	request(2, "GET", "/admin/reports?post_id="+created.ID, nil, nil, 200)
	reportDetail := dataOf[vo.ReportDetailVO](t, request(2, "GET", reportPath, nil, nil, 200))
	if reportDetail.ContentSnapshot.Description != input.Description || reportDetail.CurrentPost.Revision != 2 {
		t.Fatal("old report snapshot drifted to edited content")
	}
	staleVersion := public.StateVersion
	decision := dto.ReportDecisionDTO{Status: "handled", ResultAction: "remove_post", HandlingReason: "核实后下架", ExpectedPostStateVersion: &staleVersion}
	request(2, "PUT", reportPath+"/decision", decision, match(reportDetail.ETag), 409)
	decision.ExpectedPostStateVersion = &updated.StateVersion
	request(2, "PUT", reportPath+"/decision", decision, match(reportDetail.ETag), 200)
	request(2, "PUT", reportPath+"/decision", decision, match(reportDetail.ETag), 412)
	removed := dataOf[vo.OwnerPostDetailVO](t, request(0, "GET", path, nil, nil, 200))
	request(2, "PATCH", "/admin"+path+"/moderation", dto.PostModerationDTO{ReviewStatus: "removed", Reason: "已下架"}, match(removed.ETag), 200)
	resubmitted := dataOf[vo.OwnerPostDetailVO](t, request(0, "PUT", path, updatedInput, match(removed.ETag), 200))
	approve()
	current := dataOf[vo.OwnerPostDetailVO](t, request(0, "GET", path, nil, nil, 200))
	if current.Revision != resubmitted.Revision || current.FirstPublishedAt == nil || !current.FirstPublishedAt.Equal(*firstPublished) {
		t.Fatal("reapproval changed first publication time")
	}
	completed := dataOf[vo.PostResolutionResponseVO](t, request(0, "PATCH", path+"/resolution", dto.PostResolutionDTO{ResolutionStatus: "completed"}, match(current.ETag), 200))
	withdrawn := dataOf[vo.PostResolutionResponseVO](t, request(0, "PATCH", path+"/resolution", dto.PostResolutionDTO{ResolutionStatus: "withdrawn"}, match(completed.ETag), 200))
	request(0, "PATCH", path+"/resolution", dto.PostResolutionDTO{ResolutionStatus: "active"}, match(withdrawn.ETag), 409)
	request(1, "GET", path, nil, nil, 404)
	quota = dataOf[vo.PostQuotaResponseVO](t, request(0, "GET", "/users/me/post-quota", nil, nil, 200))
	if quota.Used != 1 {
		t.Fatal("editing or changing state consumed new-post quota")
	}
	notifications := dataOf[vo.PageResultVO[vo.NotificationVO]](t, request(1, "GET", "/notifications", nil, nil, 200))
	if len(notifications.Records) == 0 {
		t.Fatal("report handling notification missing")
	}
	request(1, "PUT", "/notifications/"+notifications.Records[0].ID+"/read-state", map[string]bool{"read": true}, nil, 200)
	logs := dataOf[vo.PageResultVO[vo.OperationLogVO]](t, request(2, "GET", "/admin/operation-logs?target_post_id="+created.ID, nil, nil, 200))
	if logs.Total != 4 {
		t.Fatalf("expected two approvals, removal and report decision, got %d logs", logs.Total)
	}
	request(2, "GET", "/admin/operation-logs/"+logs.Records[0].ID, nil, nil, 200)
}

// dataOf 只解析接口响应的 data，失败时保留可定位的 HTTP 证据。
func dataOf[T any](t *testing.T, response *httptest.ResponseRecorder) T {
	t.Helper()
	var body struct {
		Data T `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal("invalid JSON response", err)
	}
	return body.Data
}
