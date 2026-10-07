package accounts_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	errs "lost-found/backend/common/errors"
	"lost-found/backend/common/utils"
	"lost-found/backend/global"
	"lost-found/backend/internal/config"
	"lost-found/backend/internal/middleware"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"
	"lost-found/backend/internal/router"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm/logger"
)

// TestAccountNotificationIntegration 创建独立账号，验证绑定、处置、通知和退出的真实数据库链路。
// 微信上游使用固定响应，真实 code 联调另由 tests/wechat 执行；不读取或输出真实 AppSecret。
func TestAccountNotificationIntegration(t *testing.T) {
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
	ctx := context.Background()
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
	prefix := "acct_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	password := "account-test-password"
	hash, err := utils.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	users := make([]entity.User, 4)
	for i := range users {
		users[i] = entity.User{AccountNo: prefix + strconv.Itoa(i), IdentityType: "student", Nickname: "账号联调",
			PasswordHash: hash, TokenVersion: 1, Role: "user", Status: "active", IsVerified: true}
		if i >= 2 {
			users[i].Role = "admin"
		}
		if err := global.Db.Table("users").Create(&users[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	ids := []uint64{users[0].ID, users[1].ID, users[2].ID, users[3].ID}
	var redisKeys []string
	t.Cleanup(func() {
		// 只清理本次账号的通知、操作记录和用户，不触碰演示账号或其他测试数据。
		for _, table := range []string{"notifications", "admin_operation_logs"} {
			column := "user_id"
			if table == "admin_operation_logs" {
				column = "operator_id"
			}
			if err := global.Db.Table(table).Where(column+" IN ?", ids).Delete(map[string]any{}).Error; err != nil {
				t.Error("fixture cleanup failed", table)
			}
		}
		if err := global.Db.Table("users").Where("id IN ? AND account_no LIKE ?", ids, prefix+"%").Delete(&entity.User{}).Error; err != nil {
			t.Error("user cleanup failed")
		}
		if len(redisKeys) > 0 {
			if err := global.RedisClient.Del(ctx, redisKeys...).Err(); err != nil {
				t.Error("Redis cleanup failed")
			}
		}
	})
	key := func(kind, value string) string {
		digest := sha256.Sum256([]byte(value))
		value = "lost_found:login:" + kind + ":" + hex.EncodeToString(digest[:])
		redisKeys = append(redisKeys, value)
		return value
	}
	for _, user := range users {
		key("fail", user.AccountNo)
		key("pause", user.AccountNo)
	}
	token := func(index int) string {
		var user entity.User
		if err := global.Db.Table("users").Where("id = ?", users[index].ID).Take(&user).Error; err != nil {
			t.Fatal(err)
		}
		value, _, err := utils.GenerateJWT(config.ServerConfig.Jwt, user.ID, user.TokenVersion)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	ipSeq := 0
	request := func(method, path, credential, body string) *httptest.ResponseRecorder {
		ipSeq++
		ip := "198.19.17." + strconv.Itoa(ipSeq)
		key("ip", ip)
		req := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		req.RemoteAddr = ip + ":12345"
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if credential != "" {
			req.Header.Set("Authorization", "Bearer "+credential)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	aToken, bToken, adminToken := token(0), token(1), token(2)

	// 通知归属、筛选及首次已读时间。
	owned := entity.Notification{UserID: users[0].ID, Type: "post_review", Title: "测试", Content: "通知内容"}
	other := entity.Notification{UserID: users[1].ID, Type: "post_review", Title: "其他用户", Content: "通知内容"}
	for _, notification := range []*entity.Notification{&owned, &other} {
		if err := global.Db.Table("notifications").Create(notification).Error; err != nil {
			t.Fatal(err)
		}
	}
	w := request("GET", "/notifications?read=false", aToken, "")
	var list struct {
		Data vo.PageResultVO[vo.NotificationVO]
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || w.Code != 200 || list.Data.Total != 1 || list.Data.Records[0].ReadAt != nil {
		t.Fatal("notification list/ownership failed")
	}
	w = request("GET", "/notifications/unread-count", aToken, "")
	var unread struct{ Data vo.UnreadCountResponseVO }
	if err := json.Unmarshal(w.Body.Bytes(), &unread); err != nil || w.Code != 200 || unread.Data.Count != 1 {
		t.Fatal("unread count failed")
	}
	readPath := "/notifications/" + strconv.FormatUint(owned.ID, 10) + "/read-state"
	for _, invalid := range []string{`{}`, `{"read":false}`, `null`, `{"read":true,"extra":1}`} {
		if w := request("PUT", readPath, aToken, invalid); w.Code != 400 {
			t.Fatal("invalid read-state accepted")
		}
	}
	if w := request("PUT", "/notifications/"+strconv.FormatUint(other.ID, 10)+"/read-state", aToken, `{"read":true}`); w.Code != 404 {
		t.Fatal("foreign notification writable")
	}
	var first, again struct {
		Data vo.NotificationReadStateResponseVO
	}
	w = request("PUT", readPath, aToken, `{"read":true}`)
	_ = json.Unmarshal(w.Body.Bytes(), &first)
	w = request("PUT", readPath, aToken, `{"read":true}`)
	_ = json.Unmarshal(w.Body.Bytes(), &again)
	if w.Code != 200 || first.Data.ReadAt.IsZero() || !first.Data.ReadAt.Equal(again.Data.ReadAt) {
		t.Fatal("read timestamp changed on retry")
	}

	// 管理员查询与禁用操作：普通用户无权，管理员对象不可处置，重复禁用无副作用。
	if w := request("GET", "/admin/users", aToken, ""); w.Code != 403 {
		t.Fatal("ordinary user reached admin users")
	}
	w = request("GET", "/admin/users?account_no="+users[0].AccountNo, adminToken, "")
	var adminList struct {
		Data vo.PageResultVO[vo.AdminUserVO]
	}
	if err := json.Unmarshal(w.Body.Bytes(), &adminList); err != nil || w.Code != 200 || adminList.Data.Total != 1 {
		t.Fatal("admin user list failed")
	}
	for _, sensitive := range []string{"password_hash", "wechat_openid", "token_version"} {
		if strings.Contains(w.Body.String(), sensitive) {
			t.Fatal("admin response leaked sensitive field")
		}
	}
	adminPath := "/admin/users/" + strconv.FormatUint(users[2].ID, 10)
	if w := request("PATCH", adminPath+"/status", adminToken, `{"status":"disabled","reason":"测试"}`); w.Code != 403 {
		t.Fatal("administrator can be disabled")
	}
	if w := request("POST", adminPath+"/password-resets", adminToken, `{"reason":"测试"}`); w.Code != 403 {
		t.Fatal("administrator password reset allowed")
	}
	// 两名管理员交叉处置对方时，先统一锁用户再判断禁止处置，不能形成锁环。
	crossResults := make(chan error, 2)
	for i := 2; i < 4; i++ {
		go func(index int) {
			_, err := service.DisableUser(ctx,
				entity.AuthUser{ID: users[index].ID, TokenVersion: 1}, users[5-index].ID,
				dto.UserStatusDTO{Status: "disabled", Reason: "交叉处置测试"})
			crossResults <- err
		}(i)
	}
	for i := 0; i < 2; i++ {
		if err := <-crossResults; !errors.Is(err, errs.ForbiddenError) {
			t.Fatal("cross administrator lock order failed")
		}
	}
	bPath := "/admin/users/" + strconv.FormatUint(users[1].ID, 10)
	if w := request("PATCH", bPath+"/status", adminToken, `{"status":"disabled","reason":"   "}`); w.Code != 400 {
		t.Fatal("blank reason accepted")
	}
	for i := 0; i < 2; i++ {
		if w := request("PATCH", bPath+"/status", adminToken, `{"status":"disabled","reason":"测试禁用"}`); w.Code != 200 {
			t.Fatal("disable failed")
		}
	}
	var disabled entity.User
	if err := global.Db.Table("users").Where("id = ?", users[1].ID).Take(&disabled).Error; err != nil || disabled.Status != "disabled" || disabled.TokenVersion != 2 {
		t.Fatal("disable version not atomic/idempotent")
	}
	var disableLogs int64
	global.Db.Table("admin_operation_logs").Where("operator_id = ? AND action = ?", users[2].ID, "disable_user").Count(&disableLogs)
	if disableLogs != 1 || request("GET", "/users/me", bToken, "").Code != 403 {
		t.Fatal("disable side effects or old credential handling failed")
	}

	// 微信初次绑定、同身份无变化、唯一约束冲突及换绑密码限流。
	oldTransport, oldSecret := http.DefaultTransport, config.ServerConfig.WeChat.Secret
	config.ServerConfig.WeChat.Secret = "mock-secret"
	openid := prefix + "_wechat"
	http.DefaultTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"openid":"` + openid + `","session_key":"mock-session"}`))}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = oldTransport; config.ServerConfig.WeChat.Secret = oldSecret })
	bindPath := "/users/me/wechat-binding"
	var bound struct{ Data vo.WechatBindingResponseVO }
	w = request("PUT", bindPath, aToken, `{"code":"mock-code"}`)
	if err := json.Unmarshal(w.Body.Bytes(), &bound); err != nil || w.Code != 200 || !bound.Data.Bound || bound.Data.ReauthRequired {
		t.Fatal("first binding failed")
	}
	var unchanged struct{ Data vo.WechatBindingResponseVO }
	w = request("PUT", bindPath, aToken, `{"code":"new-mock-code"}`)
	_ = json.Unmarshal(w.Body.Bytes(), &unchanged)
	if w.Code != 200 || !bound.Data.BoundAt.Equal(unchanged.Data.BoundAt) || unchanged.Data.ReauthRequired {
		t.Fatal("identical binding changed state")
	}
	// 使用仍有效的管理员账号测试微信唯一约束；失败不能影响现有绑定。
	if w := request("PUT", bindPath, adminToken, `{"code":"conflicting-code"}`); w.Code != 409 {
		t.Fatal("duplicate WeChat identity allowed")
	}
	openid = prefix + "_changed_wechat"
	if w := request("PUT", bindPath, aToken, `{"code":"missing-password"}`); w.Code != 400 {
		t.Fatal("rebinding skipped password verification")
	}
	for i := 0; i < 5; i++ {
		w := request("PUT", bindPath, aToken, `{"code":"wrong-password-code","current_password":"wrong-password"}`)
		want := 401
		if i == 4 {
			want = 429
		}
		if w.Code != want {
			t.Fatal("rebinding account limiter failed")
		}
	}
	w = request("PUT", bindPath, aToken, `{"code":"paused-code","current_password":"`+password+`"}`)
	if w.Code != 429 || w.Header().Get("Retry-After") == "" {
		t.Fatal("account pause bypassed during rebinding")
	}
	global.RedisClient.Del(ctx, key("pause", users[0].AccountNo), key("fail", users[0].AccountNo))
	w = request("PUT", bindPath, aToken, `{"code":"fresh-code","current_password":"`+password+`"}`)
	var rebound struct{ Data vo.WechatBindingResponseVO }
	_ = json.Unmarshal(w.Body.Bytes(), &rebound)
	if w.Code != 200 || !rebound.Data.ReauthRequired || request("GET", "/users/me", aToken, "").Code != 401 {
		t.Fatal("rebinding did not revoke old JWT")
	}
	aToken = token(0)

	// 重置密码仅交付一次明文，数据库只有哈希；旧令牌失效，临时密码身份限制业务访问。
	aPath := "/admin/users/" + strconv.FormatUint(users[0].ID, 10)
	w = request("POST", aPath+"/password-resets", adminToken, `{"reason":"忘记密码"}`)
	var reset struct{ Data vo.PasswordResetResponseVO }
	if err := json.Unmarshal(w.Body.Bytes(), &reset); err != nil || w.Code != 201 || reset.Data.TemporaryPassword == "" || w.Header().Get("Location") == "" {
		t.Fatal("password reset response failed")
	}
	var resetUser entity.User
	global.Db.Table("users").Where("id = ?", users[0].ID).Take(&resetUser)
	match, err := utils.VerifyPassword(reset.Data.TemporaryPassword, resetUser.PasswordHash)
	if err != nil || !match || !resetUser.MustChangePassword || resetUser.TokenVersion != 3 {
		t.Fatal("password reset storage failed")
	}
	var resetLog entity.AdminOperationLog
	global.Db.Table("admin_operation_logs").Where("id = ?", reset.Data.OperationLogID).Take(&resetLog)
	logJSON, _ := json.Marshal(resetLog.StateAfter)
	if strings.Contains(string(logJSON), reset.Data.TemporaryPassword) || strings.Contains(resetLog.Reason, reset.Data.TemporaryPassword) {
		t.Fatal("temporary password leaked to operation log")
	}
	var notices []entity.Notification
	global.Db.Table("notifications").Where("user_id = ?", users[0].ID).Find(&notices)
	for _, notice := range notices {
		if strings.Contains(notice.Content, reset.Data.TemporaryPassword) {
			t.Fatal("temporary password leaked to notification")
		}
	}
	if request("GET", "/users/me", aToken, "").Code != 401 {
		t.Fatal("password reset preserved old JWT")
	}
	login, _, err := service.Login(ctx, dto.LoginRequestDTO{GrantType: "password", ClientType: "miniapp", AccountNo: users[0].AccountNo, Password: reset.Data.TemporaryPassword})
	if err != nil || !login.User.MustChangePassword {
		t.Fatal("temporary password login failed")
	}
	if request("GET", "/notifications", login.Token, "").Code != 403 {
		t.Fatal("forced password-change token reached business endpoint")
	}

	// 同版本并发退出仅提交一次；强制改密用户可以退出，退出后旧 JWT 不可重用。
	actor := entity.AuthUser{ID: users[0].ID, TokenVersion: 3}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- service.Logout(ctx, actor) }()
	}
	wg.Wait()
	close(results)
	successes, revoked := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, errs.TokenRevokedError) {
			revoked++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || revoked != 1 || request("DELETE", "/auth/tokens/current", login.Token, "").Code != 401 {
		t.Fatal("concurrent logout/retry failed")
	}
	if request("DELETE", "/auth/tokens/current", token(0), "").Code != 200 {
		t.Fatal("forced password-change logout forbidden")
	}

	// 网页退出仍遵守 CSRF，并在成功响应中清除 HttpOnly Cookie。
	webToken := token(2)
	accessCookie := &http.Cookie{Name: config.ServerConfig.Jwt.CookieName, Value: webToken, Path: "/api"}
	pre := httptest.NewRequest("GET", "/api/v1/auth/csrf", nil)
	pre.Header.Set("Origin", config.ServerConfig.CSRF.AllowedOrigins[0])
	pre.AddCookie(accessCookie)
	preW := httptest.NewRecorder()
	r.ServeHTTP(preW, pre)
	if preW.Code != 200 || len(preW.Result().Cookies()) == 0 {
		t.Fatal("cannot obtain logout CSRF")
	}
	logoutReq := httptest.NewRequest("DELETE", "/api/v1/auth/tokens/current", nil)
	logoutReq.Header.Set("Origin", config.ServerConfig.CSRF.AllowedOrigins[0])
	logoutReq.AddCookie(accessCookie)
	for _, cookie := range preW.Result().Cookies() {
		logoutReq.AddCookie(cookie)
		logoutReq.Header.Set("X-CSRF-Token", cookie.Value)
	}
	logoutW := httptest.NewRecorder()
	r.ServeHTTP(logoutW, logoutReq)
	cleared := false
	for _, cookie := range logoutW.Result().Cookies() {
		if cookie.Name == config.ServerConfig.Jwt.CookieName && cookie.MaxAge < 0 && cookie.HttpOnly && cookie.Path == "/api" {
			cleared = true
		}
	}
	if logoutW.Code != 200 || !cleared {
		t.Fatal("web logout did not clear access cookie")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }
