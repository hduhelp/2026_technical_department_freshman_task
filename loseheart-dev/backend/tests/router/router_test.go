package router_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"lost-found/backend/common/utils"
	"lost-found/backend/internal/config"
	"lost-found/backend/internal/middleware"
	"lost-found/backend/internal/router"

	"github.com/gin-gonic/gin"
)

// 使用替代用户查询验证路由权限；登录业务由 tests/auth 的集成测试验证。
func testDependencies(t *testing.T, user *middleware.UserIdentity) (*middleware.Authenticator, *middleware.CSRFProtector, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	cfg := config.JWTConfig{SecretKey: strings.Repeat("a", 32), Issuer: "lost-found", Audience: "lost-found-clients"}
	auth, err := middleware.NewAuthenticator(cfg, func(context.Context, uint64) (middleware.UserIdentity, error) { return *user, nil })
	if err != nil {
		t.Fatal(err)
	}
	csrf, err := middleware.NewCSRFProtector(auth, middleware.CSRFConfig{SecretKey: strings.Repeat("b", 32), AllowedOrigins: []string{"http://localhost:5173"}, MiniAppID: "wxac7f48ae41ea7c72"})
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := utils.GenerateJWT(cfg, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	return auth, csrf, token
}

func activeUser() middleware.UserIdentity {
	return middleware.UserIdentity{ID: 1, TokenVersion: 1, Status: "active", IsVerified: true, Role: "user"}
}

func TestRoutesMatchAPIDocument(t *testing.T) {
	user := activeUser()
	auth, csrf, _ := testDependencies(t, &user)
	r, err := router.InitRouter(auth, csrf)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := os.ReadFile("../../../docs/api-design.md")
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile("请求路径：`([^`]+)`\\s+请求方式：`([^`]+)`")
	parameter := regexp.MustCompile(`\{([a-z_]+)\}`)
	expected := make(map[string]bool)
	for _, match := range pattern.FindAllStringSubmatch(string(doc), -1) {
		expected[match[2]+" "+parameter.ReplaceAllString(match[1], ":$1")] = true
	}
	if len(expected) != 37 || len(r.Routes()) != len(expected) {
		t.Fatalf("document=%d, router=%d", len(expected), len(r.Routes()))
	}
	for _, route := range r.Routes() {
		key := route.Method + " " + route.Path
		if !expected[key] {
			t.Errorf("unexpected route: %s", key)
		}
		delete(expected, key)
	}
	if len(expected) != 0 {
		t.Errorf("missing routes: %v", expected)
	}
}

func TestAuthenticationGroups(t *testing.T) {
	user := activeUser()
	auth, csrf, token := testDependencies(t, &user)
	r, err := router.InitRouter(auth, csrf)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, method, path, role string
		bearer, force            bool
		want                     int
	}{
		{"protected", "GET", "/api/v1/posts", "user", false, false, 401},
		{"ordinary reaches database", "GET", "/api/v1/posts", "user", true, false, 503},
		{"ordinary admin denied", "GET", "/api/v1/admin/posts", "user", true, false, 403},
		{"admin reaches database", "GET", "/api/v1/admin/posts", "admin", true, false, 503},
		{"logout requires auth", "DELETE", "/api/v1/auth/tokens/current", "user", false, false, 403},
		{"password change reaches request validation", "PUT", "/api/v1/users/me/password", "user", true, true, 400},
		{"forced password logout reaches database", "DELETE", "/api/v1/auth/tokens/current", "user", true, true, 503},
		{"forced password business denied", "GET", "/api/v1/posts", "user", true, true, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user.Role = tc.role
			user.MustChangePassword = tc.force
			req := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.bearer {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status=%d, want=%d: %s", w.Code, tc.want, w.Body)
			}
			if w.Header().Get("X-Request-ID") == "" {
				t.Fatal("missing request ID")
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing authenticated-response cache protection")
			}
		})
	}
}

func TestBrowserAndMiniappLogin(t *testing.T) {
	user := activeUser()
	auth, csrf, _ := testDependencies(t, &user)
	r, err := router.InitRouter(auth, csrf)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/v1/auth/csrf", nil)
	req.Header.Set("Referer", "http://localhost:5173/login")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("CSRF endpoint: %s", w.Body)
	}
	csrfCookie := w.Result().Cookies()[0]
	// 标签页再次取凭证时复用同一 Cookie，不使另一页的写请求失效。
	second := httptest.NewRequest("GET", "/api/v1/auth/csrf", nil)
	second.Header.Set("Referer", "http://localhost:5173/login")
	second.AddCookie(csrfCookie)
	secondResponse := httptest.NewRecorder()
	r.ServeHTTP(secondResponse, second)
	if secondResponse.Code != 200 || !strings.Contains(secondResponse.Body.String(), csrfCookie.Value) || len(secondResponse.Result().Cookies()) != 0 {
		t.Fatal("valid CSRF cookie rotated between tabs")
	}
	for _, tc := range []struct {
		name               string
		browser, hasCSRF   bool
		want               int
		referer, fetchSite string
	}{
		{"native login reaches service", false, false, 503, "", ""},
		{"wechat native login reaches service", false, false, 503, "https://servicewechat.com/wxac7f48ae41ea7c72/devtools/page-frame.html", ""},
		{"wechat devtools metadata reaches service", false, false, 503, "https://servicewechat.com/wxac7f48ae41ea7c72/devtools/page-frame.html", "same-site"},
		{"wechat referer with origin denied", true, false, 403, "https://servicewechat.com/wxac7f48ae41ea7c72/0/page-frame.html", ""},
		{"other app denied", false, false, 403, "https://servicewechat.com/wxother/0/page-frame.html", ""},
		{"browser fetch metadata denied", false, false, 403, "https://servicewechat.com/wxac7f48ae41ea7c72/0/page-frame.html", "cross-site"},
		{"wechat referer with cookie denied", false, true, 403, "https://servicewechat.com/wxac7f48ae41ea7c72/0/page-frame.html", ""},
		{"browser without csrf", true, false, 403, "", ""},
		{"browser with csrf reaches service", true, true, 503, "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v1/auth/tokens", strings.NewReader(`{}`))
			req.Header.Set("Content-Type", "application/json")
			if tc.referer != "" {
				req.Header.Set("Referer", tc.referer)
			}
			if tc.fetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", tc.fetchSite)
				if tc.fetchSite == "same-site" {
					req.Header.Set("Sec-Fetch-Mode", "cors")
					req.Header.Set("Sec-Fetch-Dest", "empty")
				}
			}
			if tc.browser {
				req.Header.Set("Origin", "http://localhost:5173")
			}
			if tc.hasCSRF {
				req.AddCookie(csrfCookie)
				req.Header.Set("X-CSRF-Token", csrfCookie.Value)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d: %s", w.Code, tc.want, w.Body)
			}
		})
	}
}

func TestMissingDependenciesAndSafeRecovery(t *testing.T) {
	user := activeUser()
	auth, csrf, token := testDependencies(t, &user)
	if r, err := router.InitRouter(nil, csrf); err == nil || r != nil {
		t.Fatal("missing authenticator accepted")
	}
	r, err := router.InitRouter(auth, csrf)
	if err != nil {
		t.Fatal(err)
	}
	r.GET("/test-panic", func(*gin.Context) { panic("private panic details") })
	req := httptest.NewRequest("GET", "/test-panic", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 500 || strings.Contains(w.Body.String(), "private panic details") {
		t.Fatalf("unsafe panic response: %s", w.Body)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/unknown", nil))
	if w.Code != 404 {
		t.Fatalf("unknown route: %d", w.Code)
	}
}

// 其他端退出后，网页删除不可由 JavaScript 清除的旧登录 Cookie，允许重新获取登录凭证。
func TestRevokedCookieDoesNotBlockRelogin(t *testing.T) {
	user := activeUser()
	auth, csrf, token := testDependencies(t, &user)
	r, err := router.InitRouter(auth, csrf)
	if err != nil {
		t.Fatal(err)
	}
	user.TokenVersion++
	req := httptest.NewRequest("GET", "/api/v1/users/me", nil)
	req.AddCookie(&http.Cookie{Name: "lf_access_token", Value: token})
	response := httptest.NewRecorder()
	r.ServeHTTP(response, req)
	cookies := response.Result().Cookies()
	if response.Code != 401 || len(cookies) != 1 || cookies[0].Name != "lf_access_token" || cookies[0].MaxAge != -1 || cookies[0].Path != "/api" || !cookies[0].HttpOnly {
		t.Fatalf("revoked cookie not cleared: status=%d cookies=%v", response.Code, cookies)
	}
	req = httptest.NewRequest("GET", "/api/v1/auth/csrf", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	response = httptest.NewRecorder()
	r.ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatalf("relogin blocked after cookie removal: %s", response.Body)
	}
}
