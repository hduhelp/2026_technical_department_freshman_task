package middleware

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/model/vo"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type CSRFConfig struct {
	SecretKey  string
	CookieName string
	// AllowedOrigins 明确列出网页的 scheme://host[:port]，不接受通配符。
	AllowedOrigins []string
	SecureCookie   bool
	MiniAppID      string
}

const csrfProtectorKey = "lost_found.csrf.protector"

type CSRFProtector struct {
	auth    *Authenticator
	config  CSRFConfig
	origins map[string]bool
}

func NewCSRFProtector(auth *Authenticator, cfg CSRFConfig) (*CSRFProtector, error) {
	if auth == nil || len(cfg.SecretKey) < 32 || cfg.SecretKey == auth.config.SecretKey || len(cfg.AllowedOrigins) == 0 {
		return nil, errs.CSRFConfigError
	}
	if cfg.CookieName == "" {
		cfg.CookieName = "lf_csrf"
	}
	if cfg.CookieName == auth.config.CookieName {
		return nil, errs.CSRFCookieNameError
	}
	p := &CSRFProtector{auth: auth, config: cfg, origins: make(map[string]bool)}
	for _, origin := range cfg.AllowedOrigins {
		u, err := url.Parse(origin)
		if err != nil || u == nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
			return nil, errs.AllowedOriginError
		}
		value, ok := originOf(u)
		if !ok {
			return nil, errs.AllowedOriginError
		}
		p.origins[value] = true
	}
	return p, nil
}

func originOf(u *url.URL) (string, bool) {
	if u == nil || u.User != nil || u.Opaque != "" || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", false
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), true
}

func (p *CSRFProtector) trustedSource(c *gin.Context) bool {
	values := c.Request.Header.Values("Origin")
	if len(values) > 1 {
		return false
	}
	if len(values) == 1 {
		u, err := url.Parse(values[0])
		if err != nil || u == nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return false
		}
		origin, ok := originOf(u)
		return ok && p.origins[origin]
	}
	values = c.Request.Header.Values("Referer")
	if len(values) != 1 {
		return false
	}
	u, err := url.Parse(values[0])
	if err != nil {
		return false
	}
	origin, ok := originOf(u)
	return ok && p.origins[origin]
}

type csrfClaims struct {
	Nonce     string `json:"nonce"`
	JTI       string `json:"jti"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

func csrfFailure(c *gin.Context) {
	abortError(c, &authError{http.StatusForbidden, constant.CSRFInvalidCode, constant.CSRFInvalid})
}

// RequireCSRF 应挂到 /api/v1，包括未登录的登录接口；纯 Bearer 只有认证通过才免 CSRF。
func (p *CSRFProtector) RequireCSRF() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(csrfProtectorKey, p)
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}
		_, bearer, present, failure := p.auth.credentials(c)
		if failure != nil {
			abortError(c, failure)
			return
		}
		binding := ""
		if present {
			identity, err := p.auth.authenticate(c)
			if err != nil {
				abortError(c, err)
				return
			}
			if bearer {
				c.Next()
				return
			}
			binding = identity.Claims.ID
		}
		// 小程序首次登录尚无 Bearer。只接受无 Cookie、无浏览器来源头的 JSON 登录请求（允许当前小程序固定 Referer）；
		// 不使用可伪造的 client_type 跳过网页检查，也不允许此分支跳过业务接口认证。
		if !present && p.nativeLoginRequest(c) {
			c.Next()
			return
		}
		if !p.trustedSource(c) {
			csrfFailure(c)
			return
		}
		headers := c.Request.Header.Values("X-CSRF-Token")
		var values []string
		for _, cookie := range c.Request.Cookies() {
			if cookie.Name == p.config.CookieName {
				values = append(values, cookie.Value)
			}
		}
		if len(headers) != 1 || len(values) != 1 || headers[0] == "" || !hmac.Equal([]byte(headers[0]), []byte(values[0])) || !p.validToken(headers[0], binding) {
			csrfFailure(c)
			return
		}
		c.Next()
	}
}

func (p *CSRFProtector) nativeLoginRequest(c *gin.Context) bool {
	if c.Request.Method != http.MethodPost || c.FullPath() != "/api/v1/auth/tokens" || len(c.Request.Cookies()) != 0 {
		return false
	}
	for _, header := range []string{"Origin"} {
		if len(c.Request.Header.Values(header)) != 0 {
			return false
		}
	}
	// 微信原生请求自带固定 Referer；只允许当前 AppID，仍拒绝 Cookie 与 Origin。
	referrers := c.Request.Header.Values("Referer")
	if len(referrers) > 0 {
		if len(referrers) != 1 || p.config.MiniAppID == "" {
			return false
		}
		u, err := url.Parse(referrers[0])
		if err != nil || u.Scheme != "https" || u.Host != "servicewechat.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return false
		}
		parts := strings.Split(u.Path, "/")
		if len(parts) != 4 || parts[1] != p.config.MiniAppID || parts[3] != "page-frame.html" || parts[2] == "" {
			return false
		}
		if parts[2] != "devtools" {
			for _, digit := range parts[2] {
				if digit < '0' || digit > '9' {
					return false
				}
			}
		}
	}
	// 开发者工具附加 same-site/cors/empty；真机通常不带 Fetch 元数据。
	fetchHeaders := []string{"Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Dest"}
	fetchValues := []string{"same-site", "cors", "empty"}
	hasFetch := false
	for _, name := range fetchHeaders {
		hasFetch = hasFetch || len(c.Request.Header.Values(name)) > 0
	}
	if hasFetch {
		if len(referrers) != 1 {
			return false
		}
		for i, name := range fetchHeaders {
			values := c.Request.Header.Values(name)
			if len(values) != 1 || values[0] != fetchValues[i] {
				return false
			}
		}
	}
	values := c.Request.Header.Values("Content-Type")
	if len(values) != 1 {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(values[0])
	return err == nil && mediaType == "application/json"
}

// Issue 用于 GET /auth/csrf 和网页登录成功响应。
// 此方法按请求携带的 JWT 签发；登录响应使用 IssueForLogin 绑定新 JWT。
func (p *CSRFProtector) Issue(c *gin.Context) (string, error) {
	if !p.trustedSource(c) {
		return "", &authError{http.StatusForbidden, constant.CSRFInvalidCode, constant.CSRFSourceDenied}
	}
	_, _, present, failure := p.auth.credentials(c)
	if failure != nil {
		return "", failure
	}
	binding := ""
	if present {
		identity, failure := p.auth.authenticate(c)
		if failure != nil {
			return "", failure
		}
		if identity.Bearer {
			return "", &authError{http.StatusBadRequest, constant.InvalidRequestCode, constant.BearerCSRFNotRequired}
		}
		binding = identity.Claims.ID
	}
	// 同一浏览器多个标签页共用 Cookie，复用当前登录绑定的有效凭证，避免互相覆盖。
	var csrfCookies []string
	for _, cookie := range c.Request.Cookies() {
		if cookie.Name == p.config.CookieName {
			csrfCookies = append(csrfCookies, cookie.Value)
		}
	}
	if len(csrfCookies) == 1 && p.validToken(csrfCookies[0], binding) {
		return csrfCookies[0], nil
	}
	return p.issue(c, binding)
}

// TokenHandler 注册为 GET /api/v1/auth/csrf，无需强制未登录用户先认证。
func (p *CSRFProtector) TokenHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := p.Issue(c)
		if err != nil {
			var failure *authError
			if errors.As(err, &failure) {
				abortError(c, failure)
				return
			}
			_ = c.Error(err)
			abortError(c, &authError{http.StatusInternalServerError, constant.InternalErrorCode, constant.InternalError})
			return
		}
		requestID := c.GetString("request_id")
		if requestID == "" {
			requestID = uuid.NewString()
			c.Set("request_id", requestID)
		}
		c.Header("X-Request-ID", requestID)
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{"code": 1, "msg": constant.Success, "data": vo.CSRFResponseVO{CSRFToken: token}, "request_id": requestID})
	}
}

// IssueForLogin 仅由完成账号认证的网页登录 handler 调用，jti 必须与新 JWT 一致。
func (p *CSRFProtector) IssueForLogin(c *gin.Context, jti string) (string, error) {
	if jti == "" || !p.trustedSource(c) {
		return "", errs.LoginCSRFContextError
	}
	return p.issue(c, jti)
}

func (p *CSRFProtector) issue(c *gin.Context, binding string) (string, error) {
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	now := time.Now()
	data, err := json.Marshal(csrfClaims{base64.RawURLEncoding.EncodeToString(nonce), binding, now.Unix(), now.Add(24 * time.Hour).Unix()})
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(data)
	token := payload + "." + p.signature(payload)
	http.SetCookie(c.Writer, &http.Cookie{Name: p.config.CookieName, Value: token, Path: "/api", MaxAge: 86400,
		Secure: p.config.SecureCookie, HttpOnly: false, SameSite: http.SameSiteLaxMode})
	return token, nil
}

func (p *CSRFProtector) signature(payload string) string {
	mac := hmac.New(sha256.New, []byte(p.config.SecretKey))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (p *CSRFProtector) validToken(token, binding string) bool {
	if len(token) > 2048 {
		return false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 || !hmac.Equal([]byte(parts[1]), []byte(p.signature(parts[0]))) {
		return false
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	var claims csrfClaims
	if json.Unmarshal(data, &claims) != nil {
		return false
	}
	nonce, err := base64.RawURLEncoding.DecodeString(claims.Nonce)
	now := time.Now().Unix()
	return err == nil && len(nonce) == 32 && claims.JTI == binding && claims.IssuedAt > 0 && claims.IssuedAt <= now &&
		claims.ExpiresAt > now && claims.ExpiresAt > claims.IssuedAt && claims.ExpiresAt-claims.IssuedAt <= 86400
}

// IssueLoginCSRF 使用当前路由配置的防护器，绑定登录后新 JWT 的 jti。
func IssueLoginCSRF(c *gin.Context, jti string) (string, error) {
	value, ok := c.Get(csrfProtectorKey)
	if !ok {
		return "", errs.CSRFConfigError
	}
	protector, ok := value.(*CSRFProtector)
	if !ok || protector == nil {
		return "", errs.CSRFConfigError
	}
	return protector.IssueForLogin(c, jti)
}
