package auth_test

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
	"time"

	errs "lost-found/backend/common/errors"
	"lost-found/backend/common/utils"
	"lost-found/backend/global"
	"lost-found/backend/internal/config"
	authController "lost-found/backend/internal/controller/auth"
	"lost-found/backend/internal/middleware"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"
	"lost-found/backend/internal/router"
	"lost-found/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm/logger"
)

func TestPasswordHash(t *testing.T) {
	password := "  杭电 password 123  "
	a, err := utils.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	b, err := utils.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("salt must be independent")
	}
	ok, err := utils.VerifyPassword(password, a)
	if err != nil || !ok {
		t.Fatal("correct password rejected")
	}
	ok, err = utils.VerifyPassword(strings.TrimSpace(password), a)
	if err != nil || ok {
		t.Fatal("password must not be trimmed")
	}
	if _, err = utils.VerifyPassword(password, "$argon2id$v=19$m=999999999,t=2,p=1$x$x"); !errors.Is(err, errs.PasswordHashError) {
		t.Fatal("unsafe hash parameters accepted")
	}
}

// TestLoginIntegration 使用本项目数据库及 Redis；只创建、清理本次唯一标识的测试记录和键。
// 默认跳过；在 backend 目录设置 LOST_FOUND_INTEGRATION=1 执行。
func TestLoginIntegration(t *testing.T) {
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
	sqlDB, err := global.Db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close(); _ = global.RedisClient.Close() })
	gin.SetMode(gin.TestMode)
	auth, err := middleware.NewAuthenticator(config.ServerConfig.Jwt, middleware.GORMUserLookup(global.Db))
	if err != nil {
		t.Fatal(err)
	}
	csrf, err := middleware.NewCSRFProtector(auth, middleware.CSRFConfig{SecretKey: config.ServerConfig.Jwt.CSRFSecretKey, CookieName: config.ServerConfig.Jwt.CSRFCookieName, AllowedOrigins: config.ServerConfig.CSRF.AllowedOrigins, SecureCookie: config.ServerConfig.CSRF.SecureCookie})
	if err != nil {
		t.Fatal(err)
	}
	r, err := router.InitRouter(auth, csrf)
	if err != nil {
		t.Fatal(err)
	}
	account := "test_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:20]
	password := "  杭电 password 123  "
	hash, err := utils.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	user := entity.User{AccountNo: account, IdentityType: "student", Nickname: "登录测试", PasswordHash: hash, TokenVersion: 1, Role: "user", Status: "active", IsVerified: true}
	if err := global.Db.Table("users").Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := global.Db.Table("users").Where("id = ? AND account_no = ?", user.ID, account).Delete(&entity.User{}).Error; err != nil {
			t.Error("fixture cleanup failed")
		}
	})
	ctx := context.Background()
	var keys []string
	key := func(kind, value string) string {
		digest := sha256.Sum256([]byte(value))
		k := "lost_found:login:" + kind + ":" + hex.EncodeToString(digest[:])
		keys = append(keys, k)
		return k
	}
	failKey, pauseKey := key("fail", account), key("pause", account)
	t.Cleanup(func() {
		if len(keys) > 0 {
			if err := global.RedisClient.Del(ctx, keys...).Err(); err != nil {
				t.Error("test key cleanup failed")
			}
		}
	})
	ipSeq := 0
	request := func(input dto.LoginRequestDTO, browser bool) *httptest.ResponseRecorder {
		ipSeq++
		ip := "198.18.0." + stringInt(ipSeq)
		key("ip", ip)
		body, _ := json.Marshal(input)
		req := httptest.NewRequest("POST", "/api/v1/auth/tokens", strings.NewReader(string(body)))
		req.RemoteAddr = ip + ":12345"
		req.Header.Set("Content-Type", "application/json")
		if browser {
			origin := config.ServerConfig.CSRF.AllowedOrigins[0]
			pre := httptest.NewRequest("GET", "/api/v1/auth/csrf", nil)
			pre.Header.Set("Origin", origin)
			preW := httptest.NewRecorder()
			r.ServeHTTP(preW, pre)
			if preW.Code != 200 {
				t.Fatal("cannot get prelogin CSRF")
			}
			cookie := preW.Result().Cookies()[0]
			req.Header.Set("Origin", origin)
			req.AddCookie(cookie)
			req.Header.Set("X-CSRF-Token", cookie.Value)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	for _, malformed := range []string{`{"grant_type":"password","client_type":"miniapp","extra":true}`, `{} {}`, `null`} {
		ipSeq++
		ip := "198.18.0." + stringInt(ipSeq)
		key("ip", ip)
		req := httptest.NewRequest("POST", "/api/v1/auth/tokens", strings.NewReader(malformed))
		req.RemoteAddr = ip + ":12345"
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 400 {
			t.Fatal("invalid JSON accepted")
		}
	}
	input := dto.LoginRequestDTO{GrantType: "password", ClientType: "miniapp", AccountNo: account, Password: password}
	mini := request(input, false)
	if mini.Code != 200 {
		t.Fatalf("miniapp login status=%d", mini.Code)
	}
	var output struct {
		Code      int
		Data      vo.LoginResponseVO
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(mini.Body.Bytes(), &output); err != nil {
		t.Fatal(err)
	}
	if output.Data.AccessToken == "" || output.Data.TokenType != "Bearer" || output.Data.CSRFToken != "" || output.RequestID == "" || len(mini.Result().Cookies()) != 0 {
		t.Fatal("invalid miniapp credential delivery")
	}
	claims, err := utils.ParseJWT(config.ServerConfig.Jwt, output.Data.AccessToken)
	if err != nil || claims.TokenVersion != 1 || claims.ExpiresAt.Sub(claims.IssuedAt.Time) != 24*time.Hour {
		t.Fatal("invalid JWT")
	}
	input.ClientType = "web"
	web := request(input, true)
	if web.Code != 200 {
		t.Fatalf("web login status=%d", web.Code)
	}
	var webOutput struct{ Data vo.LoginResponseVO }
	_ = json.Unmarshal(web.Body.Bytes(), &webOutput)
	if webOutput.Data.AccessToken != "" || webOutput.Data.CSRFToken == "" {
		t.Fatal("web credentials exposed or missing")
	}
	var accessCookie *http.Cookie
	for _, cookie := range web.Result().Cookies() {
		if cookie.Name == config.ServerConfig.Jwt.CookieName {
			accessCookie = cookie
		}
	}
	if accessCookie == nil || !accessCookie.HttpOnly || accessCookie.Path != "/api" || accessCookie.SameSite != http.SameSiteLaxMode || accessCookie.MaxAge != 86400 {
		t.Fatal("invalid login cookie")
	}
	webClaims, err := utils.ParseJWT(config.ServerConfig.Jwt, accessCookie.Value)
	if err != nil {
		t.Fatal("invalid web JWT")
	}
	// 登录后的 CSRF + Cookie 应通过中间件；空请求体在帖子 controller 返回 400。
	edit := httptest.NewRequest("POST", "/api/v1/posts", nil)
	edit.Header.Set("Origin", config.ServerConfig.CSRF.AllowedOrigins[0])
	edit.Header.Set("X-CSRF-Token", webOutput.Data.CSRFToken)
	for _, cookie := range web.Result().Cookies() {
		edit.AddCookie(cookie)
	}
	editW := httptest.NewRecorder()
	r.ServeHTTP(editW, edit)
	if editW.Code != 400 || webClaims.ID == claims.ID {
		t.Fatal("postlogin CSRF binding failed")
	}
	input.ClientType = "admin_web"
	if w := request(input, true); w.Code != 403 {
		t.Fatal("ordinary user gained admin login")
	}
	if err := global.Db.Table("users").Where("id = ?", user.ID).Update("role", "admin").Error; err != nil {
		t.Fatal(err)
	}
	if w := request(input, true); w.Code != 200 {
		t.Fatal("admin login rejected")
	}
	if err := global.Db.Table("users").Where("id = ?", user.ID).Update("role", "user").Error; err != nil {
		t.Fatal(err)
	}
	input.ClientType = "miniapp"
	if err := global.Db.Table("users").Where("id = ?", user.ID).Update("must_change_password", true).Error; err != nil {
		t.Fatal(err)
	}
	forced := request(input, false)
	var forcedOutput struct{ Data vo.LoginResponseVO }
	_ = json.Unmarshal(forced.Body.Bytes(), &forcedOutput)
	if forced.Code != 200 || !forcedOutput.Data.User.MustChangePassword {
		t.Fatal("temporary password login rejected")
	}
	forcedReq := httptest.NewRequest("GET", "/api/v1/posts", nil)
	forcedReq.Header.Set("Authorization", "Bearer "+forcedOutput.Data.AccessToken)
	forcedW := httptest.NewRecorder()
	r.ServeHTTP(forcedW, forcedReq)
	if forcedW.Code != 403 {
		t.Fatal("forced password user accessed business")
	}
	if err := global.Db.Table("users").Where("id = ?", user.ID).Update("must_change_password", false).Error; err != nil {
		t.Fatal(err)
	}
	for field, value := range map[string]any{"status": "disabled", "is_verified": false} {
		if err := global.Db.Table("users").Where("id = ?", user.ID).Update(field, value).Error; err != nil {
			t.Fatal(err)
		}
		if w := request(input, false); w.Code != 403 {
			t.Fatal("invalid user state logged in")
		}
		restore := any("active")
		if field == "is_verified" {
			restore = true
		}
		if err := global.Db.Table("users").Where("id = ?", user.ID).Update(field, restore).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 更新登录版本后，原令牌必须失效。
	if err := global.Db.Table("users").Where("id = ?", user.ID).Update("token_version", 2).Error; err != nil {
		t.Fatal(err)
	}
	old := httptest.NewRequest("GET", "/api/v1/posts", nil)
	old.Header.Set("Authorization", "Bearer "+output.Data.AccessToken)
	oldW := httptest.NewRecorder()
	r.ServeHTTP(oldW, old)
	if oldW.Code != 401 {
		t.Fatal("old version token accepted")
	}
	// 并发错误密码计数：5 次触发暂停，暂停期正确密码也拒绝，不延长 TTL。
	input.Password = "wrong-password-123"
	var wg sync.WaitGroup
	failures := make(chan error, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _, err := service.Login(ctx, input); failures <- err }()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		if !errors.Is(err, errs.InvalidCredentialsError) && !errors.Is(err, errs.LoginRateLimitedError) {
			t.Fatal("unexpected concurrent failure")
		}
	}
	ttl := global.RedisClient.TTL(ctx, pauseKey).Val()
	input.Password = password
	_, retry, err := service.Login(ctx, input)
	if !errors.Is(err, errs.LoginRateLimitedError) || retry < 1 || global.RedisClient.TTL(ctx, pauseKey).Val() > ttl {
		t.Fatal("pause missing or extended")
	}
	if err := global.RedisClient.PExpire(ctx, pauseKey, 100*time.Millisecond).Err(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Login(ctx, input); !errors.Is(err, errs.LoginRateLimitedError) {
		t.Fatal("subsecond pause bypassed")
	}
	time.Sleep(150 * time.Millisecond)
	if _, _, err := service.Login(ctx, input); err != nil {
		t.Fatal("pause expiry did not restore login")
	}
	input.Password = "wrong-password-123"
	for i := 0; i < 4; i++ {
		if _, _, err := service.Login(ctx, input); !errors.Is(err, errs.InvalidCredentialsError) {
			t.Fatal("unexpected failure count")
		}
	}
	input.Password = password
	if _, _, err := service.Login(ctx, input); err != nil {
		t.Fatal("valid login rejected")
	}
	if global.RedisClient.Exists(ctx, failKey).Val() != 0 {
		t.Fatal("failure count not cleared")
	}
	// 未知账号与错误密码同样返回 401。
	unknown := input
	unknown.AccountNo = "missing_" + account[:20]
	key("fail", unknown.AccountNo)
	key("pause", unknown.AccountNo)
	if w := request(unknown, false); w.Code != 401 {
		t.Fatal("unknown account response differs")
	}
	// 来源窗口固定，31 次限速；过期后恢复。
	source := "integration-" + account
	sourceKey := key("ip", source)
	for i := 0; i < 30; i++ {
		if _, err := service.LoginSourceLimit(ctx, source); err != nil {
			t.Fatal("source limited too early")
		}
	}
	if _, err := service.LoginSourceLimit(ctx, source); !errors.Is(err, errs.LoginRateLimitedError) {
		t.Fatal("source limit missing")
	}
	if err := global.RedisClient.PExpire(ctx, sourceKey, 100*time.Millisecond).Err(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(150 * time.Millisecond)
	if _, err := service.LoginSourceLimit(ctx, source); err != nil {
		t.Fatal("source expiry did not restore")
	}
	savedRedis := global.RedisClient
	global.RedisClient = redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, DialTimeout: 100 * time.Millisecond})
	_, err = service.LoginSourceLimit(ctx, source)
	_ = global.RedisClient.Close()
	global.RedisClient = savedRedis
	if !errors.Is(err, errs.AuthLimiterUnavailableError) {
		t.Fatal("Redis failure bypassed limiter")
	}
	// 模拟微信上游，不发送真实 AppSecret 或 code。
	oldTransport := http.DefaultTransport
	oldSecret := config.ServerConfig.WeChat.Secret
	config.ServerConfig.WeChat.Secret = "test-only-secret"
	http.DefaultTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"openid":"` + account + `","session_key":"test-session"}`)), Header: make(http.Header)}, nil
	})
	defer func() { http.DefaultTransport = oldTransport; config.ServerConfig.WeChat.Secret = oldSecret }()
	wechat := dto.LoginRequestDTO{GrantType: "wechat_code", ClientType: "miniapp", Code: "test-code"}
	if w := request(wechat, false); w.Code != 409 {
		t.Fatal("unbound WeChat auto-created account")
	}
	now := time.Now()
	if err := global.Db.Table("users").Where("id = ?", user.ID).Updates(map[string]any{"wechat_appid": config.ServerConfig.WeChat.Appid, "wechat_openid": account, "wechat_bound_at": now}).Error; err != nil {
		t.Fatal(err)
	}
	if w := request(wechat, false); w.Code != 200 {
		t.Fatal("bound WeChat login failed")
	}
	http.DefaultTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"errcode":40029}`)), Header: make(http.Header)}, nil
	})
	if w := request(wechat, false); w.Code != 502 {
		t.Fatal("WeChat upstream error not handled")
	}

	// 修改密码使用本次隔离测试账号，不改动演示账号。
	input.ClientType = "web"
	input.Password = password
	passwordWeb := request(input, true)
	if passwordWeb.Code != 200 {
		t.Fatal("password test login failed")
	}
	var passwordLogin struct{ Data vo.LoginResponseVO }
	if err := json.Unmarshal(passwordWeb.Body.Bytes(), &passwordLogin); err != nil {
		t.Fatal(err)
	}
	miniLogin, _, err := service.Login(ctx, dto.LoginRequestDTO{GrantType: "password", ClientType: "miniapp", AccountNo: account, Password: password})
	if err != nil {
		t.Fatal(err)
	}
	if err := global.Db.Table("users").Where("id = ?", user.ID).Update("must_change_password", true).Error; err != nil {
		t.Fatal(err)
	}
	change := func(body string, csrf bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest("PUT", "/api/v1/users/me/password", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", config.ServerConfig.CSRF.AllowedOrigins[0])
		if csrf {
			req.Header.Set("X-CSRF-Token", passwordLogin.Data.CSRFToken)
		}
		for _, cookie := range passwordWeb.Result().Cookies() {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	newPassword := "  新密码 abc12345  "
	payload := func(current, next string) string {
		b, _ := json.Marshal(dto.ChangePasswordRequestDTO{CurrentPassword: current, NewPassword: next})
		return string(b)
	}
	if w := change(payload(password, newPassword), false); w.Code != 403 {
		t.Fatal("password CSRF bypassed")
	}
	for _, malformed := range []string{`null`, `{} {}`, `{"current_password":"Fixture123!","new_password":"12345678","extra":true}`, payload(password, "short")} {
		if w := change(malformed, true); w.Code != 400 {
			t.Fatal("invalid password request accepted")
		}
	}
	if w := change(payload("wrong-password", newPassword), true); w.Code != 401 {
		t.Fatal("wrong current password accepted")
	}
	if w := change(payload(password, password), true); w.Code != 400 {
		t.Fatal("unchanged password accepted")
	}
	var before entity.User
	if err := global.Db.Table("users").Where("id = ?", user.ID).Take(&before).Error; err != nil {
		t.Fatal(err)
	}
	if before.PasswordHash != hash || before.TokenVersion != 2 || !before.MustChangePassword {
		t.Fatal("failed change mutated account")
	}
	success := change(payload(password, newPassword), true)
	if success.Code != 200 {
		t.Fatalf("password change status=%d", success.Code)
	}
	var response struct {
		Code      int
		Data      any
		RequestID string `json:"request_id"`
	}
	if err := json.Unmarshal(success.Body.Bytes(), &response); err != nil || response.Code != 1 || response.Data != nil || response.RequestID == "" {
		t.Fatal("invalid password response")
	}
	cleared := false
	for _, cookie := range success.Result().Cookies() {
		if cookie.Name == config.ServerConfig.Jwt.CookieName && cookie.MaxAge < 0 && cookie.Path == "/api" && cookie.HttpOnly {
			cleared = true
		}
	}
	if !cleared {
		t.Fatal("access cookie not cleared")
	}
	var changed entity.User
	if err := global.Db.Table("users").Where("id = ?", user.ID).Take(&changed).Error; err != nil {
		t.Fatal(err)
	}
	matches, err := utils.VerifyPassword(newPassword, changed.PasswordHash)
	if err != nil || !matches || changed.TokenVersion != 3 || changed.MustChangePassword || !changed.PasswordChangedAt.After(before.PasswordChangedAt) {
		t.Fatal("password update incomplete")
	}
	for _, bearer := range []bool{true, false} {
		req := httptest.NewRequest("GET", "/api/v1/users/me", nil)
		if bearer {
			req.Header.Set("Authorization", "Bearer "+miniLogin.Token)
		} else {
			for _, cookie := range passwordWeb.Result().Cookies() {
				req.AddCookie(cookie)
			}
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 401 || !strings.Contains(w.Body.String(), "TOKEN_REVOKED") {
			t.Fatal("old token survived change")
		}
	}
	fresh, _, err := service.Login(ctx, dto.LoginRequestDTO{GrantType: "password", ClientType: "miniapp", AccountNo: account, Password: newPassword})
	if err != nil {
		t.Fatal("new password login failed")
	}
	// 两个使用同一身份版本的并发改密请求，只有一个可以提交。
	identity := entity.AuthUser{ID: user.ID, TokenVersion: fresh.Claims.TokenVersion}
	outcomes := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			outcomes <- service.ChangePassword(ctx, identity, dto.ChangePasswordRequestDTO{CurrentPassword: newPassword, NewPassword: "concurrent-password"})
		}()
	}
	wg.Wait()
	close(outcomes)
	successes, revoked := 0, 0
	for err := range outcomes {
		if err == nil {
			successes++
		} else if errors.Is(err, errs.TokenRevokedError) {
			revoked++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || revoked != 1 {
		t.Fatal("concurrent change was not serialized")
	}

	// 小程序改密不设置 Cookie，并验证旧密码不能再登录。
	bearerLogin, _, err := service.Login(ctx, dto.LoginRequestDTO{GrantType: "password", ClientType: "miniapp", AccountNo: account, Password: "concurrent-password"})
	if err != nil {
		t.Fatal(err)
	}
	bearerReq := httptest.NewRequest("PUT", "/api/v1/users/me/password", strings.NewReader(payload("concurrent-password", "final-password-123")))
	bearerReq.Header.Set("Content-Type", "application/json")
	bearerReq.Header.Set("Authorization", "Bearer "+bearerLogin.Token)
	bearerW := httptest.NewRecorder()
	r.ServeHTTP(bearerW, bearerReq)
	if bearerW.Code != 200 || len(bearerW.Result().Cookies()) != 0 {
		t.Fatal("invalid miniapp password change")
	}
	if _, _, err := service.Login(ctx, dto.LoginRequestDTO{GrantType: "password", ClientType: "miniapp", AccountNo: account, Password: "concurrent-password"}); !errors.Is(err, errs.InvalidCredentialsError) {
		t.Fatal("old password still accepted")
	}
	if _, _, err := service.Login(ctx, dto.LoginRequestDTO{GrantType: "password", ClientType: "miniapp", AccountNo: account, Password: "final-password-123"}); err != nil {
		t.Fatal("final password rejected")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func stringInt(n int) string                                              { return strconv.Itoa(n) }

// TestPasswordLength 验证登录、改密、哈希工具共用 8–32 字符规则。
func TestPasswordLength(t *testing.T) {
	for _, tc := range []struct {
		name, password string
		valid          bool
	}{
		{"below minimum", strings.Repeat("a", 7), false},
		{"minimum", strings.Repeat("a", 8), true},
		{"maximum Unicode", strings.Repeat("杭", 32), true},
		{"above maximum", strings.Repeat("a", 33), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, hashErr := utils.HashPassword(tc.password)
			loginErr := authController.ValidateLoginRequest(dto.LoginRequestDTO{GrantType: "password", ClientType: "miniapp", AccountNo: "25051408", Password: tc.password})
			changeErr := authController.ValidateChangePasswordRequest(dto.ChangePasswordRequestDTO{CurrentPassword: "Fixture123!", NewPassword: tc.password})
			if (hashErr == nil) != tc.valid || (loginErr == nil) != tc.valid || (changeErr == nil) != tc.valid {
				t.Fatal("password range differs between layers")
			}
		})
	}
}
