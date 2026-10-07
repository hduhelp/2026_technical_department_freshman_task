package moderation_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
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
	"lost-found/backend/internal/middleware"
	"lost-found/backend/internal/model"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/router"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestModerationIntegration 使用独立测试账号和帖子验证审核、举报及事务一致性。
// 默认跳过；在 backend 目录设置 LOST_FOUND_INTEGRATION=1 执行，不修改演示账号。
func TestModerationIntegration(t *testing.T) {
	if os.Getenv("LOST_FOUND_INTEGRATION") != "1" {
		t.Skip("requires local MySQL and Redis")
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(filepath.Join(cwd, "../..")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	config.Init()
	global.Db.Logger = logger.Default.LogMode(logger.Silent)
	sqlDB, err := global.Db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close(); _ = global.RedisClient.Close() })
	ctx := context.Background()
	prefix := "mod_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	var userIDs, postIDs []uint64
	t.Cleanup(func() {
		// 按外键顺序清理本次生成的记录，不清空表，不触碰其他测试或演示数据。
		if len(postIDs) > 0 {
			for _, table := range []string{"admin_operation_logs", "notifications", "post_reports", "post_reviews"} {
				column := "post_id"
				if table == "admin_operation_logs" {
					column = "target_post_id"
				}
				if err := global.Db.Table(table).Where(column+" IN ?", postIDs).Delete(map[string]any{}).Error; err != nil {
					t.Error("fixture cleanup failed", table, err)
				}
			}
			if err := global.Db.Table("posts").Where("id IN ?", postIDs).Delete(&entity.Post{}).Error; err != nil {
				t.Error("post fixture cleanup failed", err)
			}
		}
		if len(userIDs) > 0 {
			if err := global.Db.Table("users").Where("id IN ? AND account_no LIKE ?", userIDs, prefix+"%").Delete(&entity.User{}).Error; err != nil {
				t.Error("user fixture cleanup failed", err)
			}
		}
	})
	newUser := func(suffix, role string) entity.User {
		user := entity.User{
			AccountNo: prefix + suffix, IdentityType: "student", Nickname: "审核举报测试" + suffix,
			PasswordHash: "fixture-not-used-for-login", TokenVersion: 1, Role: role, Status: "active", IsVerified: true,
		}
		if err := global.Db.Table("users").Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		userIDs = append(userIDs, user.ID)
		return user
	}
	admin := newUser("a", "admin")
	author := newUser("u", "user")
	reporter := newUser("r", "user")
	otherAdmin := newUser("b", "admin")
	identity := func(user entity.User) entity.AuthUser {
		return entity.AuthUser{ID: user.ID, TokenVersion: user.TokenVersion, Role: user.Role, Status: user.Status, IsVerified: user.IsVerified}
	}
	adminActor, authorActor, reporterActor, otherAdminActor := identity(admin), identity(author), identity(reporter), identity(otherAdmin)
	newPost := func(owner entity.User) (entity.Post, entity.PostReview) {
		now := time.Now().UTC().Truncate(time.Millisecond)
		post := entity.Post{
			AuthorID: owner.ID, PostType: "lost", ItemName: "校园卡", Campus: "xiasha", Location: "图书馆",
			EventDate: now.AddDate(0, 0, -1), TimePrecision: "date", Description: "原始提交说明",
			Images: []string{}, ContactMethods: []model.ContactMethod{{Type: "wechat", Value: "demo_contact"}},
			ReviewStatus: "pending", ResolutionStatus: "active", Revision: 1, StateVersion: 1,
			SubmittedAt: now, CreationKey: uuid.NewString(), CreationPayloadHash: make([]byte, 32),
		}
		if err := global.Db.Table("posts").Create(&post).Error; err != nil {
			t.Fatal(err)
		}
		postIDs = append(postIDs, post.ID)
		review := entity.PostReview{PostID: post.ID, Revision: 1, Decision: "pending", ContentSnapshot: service.PostSnapshot(post), SubmittedAt: now}
		if err := global.Db.Table("post_reviews").Create(&review).Error; err != nil {
			t.Fatal(err)
		}
		return post, review
	}
	readPost := func(id uint64) entity.Post {
		var post entity.Post
		if err := global.Db.Table("posts").Where("id = ?", id).Take(&post).Error; err != nil {
			t.Fatal(err)
		}
		return post
	}
	count := func(table, column string, id uint64) int64 {
		var total int64
		if err := global.Db.Table(table).Where(column+" = ?", id).Count(&total).Error; err != nil {
			t.Fatal(err)
		}
		return total
	}
	post, review := newPost(author)
	detail, err := service.GetReview(ctx, adminActor, review.ID)
	if err != nil || !detail.CanDecide || !detail.IsCurrent {
		t.Fatal("current pending review is not actionable", err)
	}
	if _, _, err := service.DecideReview(ctx, adminActor, review.ID, `"stale"`, dto.ReviewDecisionDTO{Decision: "approved"}); !errors.Is(err, errs.ResourceChangedError) {
		t.Fatal("stale review version accepted")
	}
	approved, nextETag, err := service.DecideReview(ctx, adminActor, review.ID, detail.ETag, dto.ReviewDecisionDTO{Decision: "approved"})
	if err != nil || approved.PostReviewStatus != "approved" || approved.PostStateVersion != 2 {
		t.Fatal("approval did not update post", err)
	}
	post = readPost(post.ID)
	firstPublished := *post.FirstPublishedAt
	if count("notifications", "post_id", post.ID) != 1 || count("admin_operation_logs", "target_post_id", post.ID) != 1 {
		t.Fatal("approval notification or log missing")
	}
	if _, _, err := service.DecideReview(ctx, adminActor, review.ID, nextETag, dto.ReviewDecisionDTO{Decision: "approved"}); !errors.Is(err, errs.StateConflictError) {
		t.Fatal("decided review processed again")
	}
	if _, _, err := service.CreateReport(ctx, authorActor, post.ID, dto.CreateReportDTO{PostRevision: 1, ReasonType: "privacy"}); !errors.Is(err, errs.ForbiddenError) {
		t.Fatal("author reported own post")
	}
	initialReason := "历史版本包含隐私"
	report, created, err := service.CreateReport(ctx, reporterActor, post.ID, dto.CreateReportDTO{PostRevision: 1, ReasonType: "privacy", Details: &initialReason})
	if err != nil || !created {
		t.Fatal("cannot create report", err)
	}
	differentReason := "重复请求不能覆盖原说明"
	duplicate, created, err := service.CreateReport(ctx, reporterActor, post.ID, dto.CreateReportDTO{PostRevision: 1, ReasonType: "other", Details: &differentReason})
	if err != nil || created || duplicate.ID != report.ID {
		t.Fatal("duplicate report was not idempotent", err)
	}
	reportID, _ := strconv.ParseUint(report.ID, 10, 64)
	// 作者编辑后，举报仍然指向原始提交快照，首次发布时间保持不变。
	updated, err := service.UpdatePost(ctx, authorActor, post.ID, service.PostETag(post), dto.UpdatePostDTO{PostContentDTO: dto.PostContentDTO{
		PostType: "lost", ItemName: "校园卡", Campus: "xiasha", Location: "图书馆", EventDate: post.EventDate.Format("2006-01-02"),
		TimePrecision: "date", Description: "修改后的提交说明", Images: []string{}, ContactMethods: []dto.ContactMethodDTO{{Type: "wechat", Value: "demo_contact"}},
	}})
	if err != nil || updated == nil {
		t.Fatal("cannot edit fixture post", err)
	}
	var newReview entity.PostReview
	if err := global.Db.Table("post_reviews").Where("post_id = ? AND revision = ?", post.ID, 2).Take(&newReview).Error; err != nil {
		t.Fatal(err)
	}
	newDetail, err := service.GetReview(ctx, adminActor, newReview.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.DecideReview(ctx, adminActor, newReview.ID, newDetail.ETag, dto.ReviewDecisionDTO{Decision: "approved"}); err != nil {
		t.Fatal("reapproval failed", err)
	}
	post = readPost(post.ID)
	if !post.FirstPublishedAt.Equal(firstPublished) {
		t.Fatal("reapproval refreshed first publication time")
	}
	historical, err := service.GetReport(ctx, adminActor, reportID)
	if err != nil || historical.ContentSnapshot.Description != "原始提交说明" || historical.CurrentPost.Revision != 2 || historical.Details != initialReason {
		t.Fatal("report snapshot drifted to new content", err)
	}
	if _, _, err := service.CreateReport(ctx, reporterActor, post.ID, dto.CreateReportDTO{PostRevision: 1, ReasonType: "privacy"}); !errors.Is(err, errs.StateConflictError) {
		t.Fatal("old revision report accepted")
	}
	// 在可见时创建其他举报，供下架及禁用后的独立结案测试使用。
	secondReport, _, err := service.CreateReport(ctx, otherAdminActor, post.ID, dto.CreateReportDTO{PostRevision: 2, ReasonType: "privacy"})
	if err != nil {
		t.Fatal(err)
	}
	thirdReport, _, err := service.CreateReport(ctx, reporterActor, post.ID, dto.CreateReportDTO{PostRevision: 2, ReasonType: "privacy"})
	if err != nil {
		t.Fatal(err)
	}
	wrongVersion := post.StateVersion - 1
	if _, err := service.DecideReport(ctx, adminActor, reportID, historical.ETag, dto.ReportDecisionDTO{
		Status: "handled", ResultAction: "remove_post", HandlingReason: "确认隐私问题", ExpectedPostStateVersion: &wrongVersion,
	}); !errors.Is(err, errs.StateConflictError) {
		t.Fatal("report removed a post with mismatching version")
	}
	if _, err := service.UpdatePostResolution(ctx, authorActor, post.ID, service.PostETag(post), dto.PostResolutionDTO{ResolutionStatus: "completed"}); err != nil {
		t.Fatal(err)
	}
	post = readPost(post.ID)
	completedAt := *post.CompletedAt
	if _, err := service.DecideReport(ctx, adminActor, reportID, historical.ETag, dto.ReportDecisionDTO{
		Status: "handled", ResultAction: "remove_post", HandlingReason: "确认隐私问题", ExpectedPostStateVersion: &post.StateVersion,
	}); err != nil {
		t.Fatal("report removal failed", err)
	}
	post = readPost(post.ID)
	if post.ReviewStatus != "removed" || post.ResolutionStatus != "completed" || !post.CompletedAt.Equal(completedAt) {
		t.Fatal("removal erased completion state")
	}
	var oldReview entity.PostReview
	if err := global.Db.Table("post_reviews").Where("id = ?", newReview.ID).Take(&oldReview).Error; err != nil || oldReview.Decision != "approved" {
		t.Fatal("removal rewrote historical approval")
	}
	logCount, notificationCount := count("admin_operation_logs", "target_post_id", post.ID), count("notifications", "post_id", post.ID)
	noChange, err := service.ModeratePost(ctx, adminActor, post.ID, service.PostETag(post), dto.PostModerationDTO{ReviewStatus: "removed", Reason: "重复下架"})
	if err != nil || noChange.StateVersion != post.StateVersion || logCount != count("admin_operation_logs", "target_post_id", post.ID) || notificationCount != count("notifications", "post_id", post.ID) {
		t.Fatal("repeat removal caused side effects", err)
	}
	// 另一位举报人仍可获得自己的结果；禁用账号只递增一次登录版本。
	secondID, _ := strconv.ParseUint(secondReport.ID, 10, 64)
	secondDetail, _ := service.GetReport(ctx, adminActor, secondID)
	if _, err := service.DecideReport(ctx, adminActor, secondID, secondDetail.ETag, dto.ReportDecisionDTO{Status: "handled", ResultAction: "disable_user", HandlingReason: "确认违规账号"}); err != nil {
		t.Fatal(err)
	}
	thirdID, _ := strconv.ParseUint(thirdReport.ID, 10, 64)
	thirdDetail, _ := service.GetReport(ctx, adminActor, thirdID)
	if _, err := service.DecideReport(ctx, adminActor, thirdID, thirdDetail.ETag, dto.ReportDecisionDTO{Status: "handled", ResultAction: "disable_user", HandlingReason: "已禁用，结案"}); err != nil {
		t.Fatal(err)
	}
	var disabled entity.User
	if err := global.Db.Table("users").Where("id = ?", author.ID).Take(&disabled).Error; err != nil || disabled.Status != "disabled" || disabled.TokenVersion != 2 {
		t.Fatal("repeat disable changed token version", err)
	}
	var disabledNotices int64
	global.Db.Table("notifications").Where("user_id = ? AND type = ?", author.ID, "account_status").Count(&disabledNotices)
	if disabledNotices != 1 {
		t.Fatal("repeat disable created duplicate notification")
	}
	// 审核自己的帖子被拒绝；举报处置不能禁用管理员。
	adminPost, adminReview := newPost(otherAdmin)
	ownDetail, err := service.GetReview(ctx, otherAdminActor, adminReview.ID)
	if err != nil || ownDetail.CanDecide {
		t.Fatal("self review marked actionable")
	}
	if _, _, err := service.DecideReview(ctx, otherAdminActor, adminReview.ID, ownDetail.ETag, dto.ReviewDecisionDTO{Decision: "approved"}); !errors.Is(err, errs.ForbiddenError) {
		t.Fatal("self approval allowed")
	}
	if _, _, err := service.DecideReview(ctx, adminActor, adminReview.ID, ownDetail.ETag, dto.ReviewDecisionDTO{Decision: "approved"}); err != nil {
		t.Fatal(err)
	}
	adminReport, _, err := service.CreateReport(ctx, reporterActor, adminPost.ID, dto.CreateReportDTO{PostRevision: 1, ReasonType: "privacy"})
	if err != nil {
		t.Fatal(err)
	}
	adminReportID, _ := strconv.ParseUint(adminReport.ID, 10, 64)
	adminReportDetail, _ := service.GetReport(ctx, adminActor, adminReportID)
	if _, err := service.DecideReport(ctx, adminActor, adminReportID, adminReportDetail.ETag, dto.ReportDecisionDTO{Status: "handled", ResultAction: "disable_user", HandlingReason: "不能禁用管理员"}); !errors.Is(err, errs.ForbiddenError) {
		t.Fatal("report disabled an administrator")
	}
	// 在最后写日志时模拟失败，之前写入的帖子、审核和通知必须全部回滚。
	rollbackPost, rollbackReview := newPost(reporter)
	rollbackDetail, _ := service.GetReview(ctx, adminActor, rollbackReview.ID)
	callback := "moderation_test_" + prefix
	if err := global.Db.Callback().Create().Before("gorm:create").Register(callback, func(db *gorm.DB) {
		if db.Statement.Table == "admin_operation_logs" {
			db.AddError(errors.New("synthetic operation log failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	_, _, failed := service.DecideReview(ctx, adminActor, rollbackReview.ID, rollbackDetail.ETag, dto.ReviewDecisionDTO{Decision: "approved"})
	if err := global.Db.Callback().Create().Remove(callback); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(failed, errs.AuthDatabaseError) || readPost(rollbackPost.ID).ReviewStatus != "pending" || count("notifications", "post_id", rollbackPost.ID) != 0 {
		t.Fatal("failed log did not roll back approval")
	}
	// 两名管理员同时决定同一个 ETag，仅一个提交，另一个得到过期版本。
	var wg sync.WaitGroup
	outcomes := make(chan error, 2)
	for _, actor := range []entity.AuthUser{adminActor, otherAdminActor} {
		wg.Add(1)
		go func(actor entity.AuthUser) {
			defer wg.Done()
			_, _, err := service.DecideReview(ctx, actor, rollbackReview.ID, rollbackDetail.ETag, dto.ReviewDecisionDTO{Decision: "approved"})
			outcomes <- err
		}(actor)
	}
	wg.Wait()
	close(outcomes)
	successes, conflicts := 0, 0
	for err := range outcomes {
		if err == nil {
			successes++
		} else if errors.Is(err, errs.ResourceChangedError) {
			conflicts++
		} else {
			t.Fatal("unexpected concurrent decision result", err)
		}
	}
	if successes != 1 || conflicts != 1 || count("notifications", "post_id", rollbackPost.ID) != 1 {
		t.Fatal("concurrent decisions were not serialized")
	}
	logs, err := service.ListOperationLogs(ctx, dto.OperationLogQueryDTO{TargetPostID: strconv.FormatUint(post.ID, 10)})
	if err != nil || len(logs.Records) == 0 {
		t.Fatal("cannot query operation logs", err)
	}
	for _, log := range logs.Records {
		if log.Action == "handle_report" && (log.StateBefore.Status == nil || *log.StateBefore.Status != "pending") {
			t.Fatal("report log state_before drifted to final state")
		}
	}
	page := 1000000
	empty, err := service.ListOperationLogs(ctx, dto.OperationLogQueryDTO{PageQueryDTO: dto.PageQueryDTO{Page: &page}, TargetPostID: strconv.FormatUint(post.ID, 10)})
	if err != nil || empty.Records == nil || len(empty.Records) != 0 {
		t.Fatal("empty page is not an empty array", err)
	}
	// 真实 Gin 路由补充验证 JSON、条件字段、路径/筛选 ID 与响应头契约。
	gin.SetMode(gin.TestMode)
	auth, err := middleware.NewAuthenticator(config.ServerConfig.Jwt, middleware.GORMUserLookup(global.Db))
	if err != nil {
		t.Fatal(err)
	}
	csrf, err := middleware.NewCSRFProtector(auth, middleware.CSRFConfig{SecretKey: config.ServerConfig.Jwt.CSRFSecretKey, CookieName: config.ServerConfig.Jwt.CSRFCookieName, AllowedOrigins: config.ServerConfig.CSRF.AllowedOrigins})
	if err != nil {
		t.Fatal(err)
	}
	r, err := router.InitRouter(auth, csrf)
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := utils.GenerateJWT(config.ServerConfig.Jwt, admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body, etag string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if etag != "" {
			req.Header.Set("If-Match", etag)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	for _, tc := range []struct{ method, path, body, etag string }{
		{"GET", "/api/v1/admin/reviews?post_id=18446744073709551616", "", ""},
		{"GET", "/api/v1/admin/reports?post_id=0", "", ""},
		{"GET", "/api/v1/admin/operation-logs?created_from=2026-10-06T00:00:00Z&created_to=2026-10-05T00:00:00Z", "", ""},
		{"PUT", "/api/v1/admin/reviews/" + strconv.FormatUint(rollbackReview.ID, 10) + "/decision", `{"decision":"returned"}`, `"test"`},
		{"PUT", "/api/v1/admin/reviews/" + strconv.FormatUint(rollbackReview.ID, 10) + "/decision", `{"decision":"approved","extra":true}`, `"test"`},
		{"PUT", "/api/v1/admin/reports/" + report.ID + "/decision", `{"status":"handled","result_action":"none","handling_reason":"test"}`, `"test"`},
		{"PUT", "/api/v1/admin/reports/" + report.ID + "/decision", `{"status":"handled","result_action":"remove_post","handling_reason":"test"}`, `"test"`},
	} {
		if w := request(tc.method, tc.path, tc.body, tc.etag); w.Code != 400 {
			t.Fatalf("invalid request status=%d path=%s", w.Code, tc.path)
		}
	}
	for _, path := range []string{
		"/api/v1/admin/posts/" + strconv.FormatUint(post.ID, 10),
		"/api/v1/admin/reviews/" + strconv.FormatUint(review.ID, 10),
		"/api/v1/admin/reports/" + report.ID,
	} {
		w := request("GET", path, "", "")
		var response struct {
			Data struct {
				ETag string `json:"etag"`
			}
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != 200 || response.Data.ETag == "" || w.Header().Get("ETag") != response.Data.ETag || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("detail ETag or privacy headers invalid", path, w.Code)
		}
	}
}
