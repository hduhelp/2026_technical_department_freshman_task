package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"

	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/jwtutil"
	"hdu-lostfound/internal/pkg/response"
)

// ContextUserKey 是当前登录用户在 Gin context 中的键名。
const ContextUserKey = "user"

// bearerPrefix 是 Authorization 头要求的方案前缀。
const bearerPrefix = "Bearer "

// TokenParser 抽象 JWT 解析能力。
//
// 中间件只依赖这个窄接口而非具体的管理器，便于测试时替换实现。
type TokenParser interface {
	// Parse 校验 token 并返回用户 id。
	Parse(token string) (int64, error)
}

// UserLoader 抽象「按 id 回查用户」的能力。
//
// 为什么中间件需要它：token 里的 uid 只证明签发时用户存在，
// 无法反映此刻是否已被删除。只信 token 会让已注销用户继续通行，
// 因此验签通过后必须回源数据库拿完整用户（SPEC 02 第 6 节）。
type UserLoader interface {
	Authenticate(c *gin.Context, userID int64) (*model.User, error)
}

// Auth 返回强制鉴权中间件。
//
// 处理链：取 Bearer token → 验签 → 回查数据库 → 把 *model.User 写入 context。
// 任一环节失败都以 1002 中断请求，并返回 SPEC 8.1 的统一响应体。
func Auth(parser TokenParser, loader UserLoader) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, ok := extractBearerToken(c)
		if !ok {
			abortUnauthorized(c)
			return
		}

		userID, err := parser.Parse(token)
		if err != nil {
			abortUnauthorized(c)
			return
		}

		u, err := loader.Authenticate(c, userID)
		if err != nil {
			// 用户已被删除等情况同样视为凭证失效，返回 1002 让前端清 token。
			abortUnauthorized(c)
			return
		}

		c.Set(ContextUserKey, u)
		c.Next()
	}
}

// CurrentUser 从 Gin context 取出当前登录用户。
//
// 未经过 Auth 中间件（如软鉴权的游客）时返回 nil，
// 调用方必须自行处理 nil，不要假设它一定非空。
func CurrentUser(c *gin.Context) *model.User {
	value, exists := c.Get(ContextUserKey)
	if !exists {
		return nil
	}
	u, ok := value.(*model.User)
	if !ok {
		return nil
	}
	return u
}

// extractBearerToken 从 Authorization 头解析出 token。
//
// 严格要求 `Bearer ` 前缀（注意末尾空格）且 token 非空；
// 大小写敏感 —— 前缀不符视为未携带凭证，而不是尝试宽松匹配。
func extractBearerToken(c *gin.Context) (string, bool) {
	header := c.GetHeader("Authorization")
	if header == "" {
		return "", false
	}
	if !strings.HasPrefix(header, bearerPrefix) {
		return "", false
	}

	token := strings.TrimSpace(strings.TrimPrefix(header, bearerPrefix))
	if token == "" {
		return "", false
	}
	return token, true
}

// abortUnauthorized 以 1002 中断请求。
//
// 使用 AbortWithStatusJSON 而非 Abort + JSON 两步：
// 前者在一次调用内同时写入响应并标记中断，避免中间发生其他写入。
func abortUnauthorized(c *gin.Context) {
	appErr := apperr.New(apperr.CodeUnauthorized)
	c.AbortWithStatusJSON(appErr.HTTPStatus, response.Body{
		Code:    appErr.Code,
		Message: appErr.Message,
		Data:    nil,
	})
}

// 编译期断言：确保 jwtutil.Manager 满足 TokenParser 契约。
var _ TokenParser = (*jwtutil.Manager)(nil)
