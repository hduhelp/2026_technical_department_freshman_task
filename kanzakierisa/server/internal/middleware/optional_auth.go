package middleware

import (
	"log/slog"

	"github.com/gin-gonic/gin"
)

// OptionalAuth 返回软鉴权中间件（SPEC 8.4「软鉴权说明」）。
//
// 与 Auth 的唯一区别在于**失败不中断请求**：
//
//	无 Authorization 头      → 放行，不设 user（游客）
//	有头但 token 非法/过期   → 放行，不设 user（视为游客）
//	验签通过但用户已被删除   → 放行，不设 user
//	全部通过                 → 校验并回查数据库，c.Set("user", u)
//
// 为什么需要它：帖子详情、匹配列表这类接口对游客开放，
// 但登录用户应当能看到额外信息（例如本人视角的 can_edit、自己的联系方式）。
// 用强制鉴权会让游客访问直接 401，用完全公开又拿不到登录态，
// 「软鉴权」正好落在两者之间。
//
// 为什么 token 失效时静默降级为游客而不是报 1002：
// 详情页是公开内容，一个过期的 token 不应该让用户连帖子都打不开 ——
// 那会表现为「分享链接给别人，自己反而看不了」。用户真正需要
// 重新登录的时刻由前端在需要写操作的接口上感知。
func OptionalAuth(parser TokenParser, loader UserLoader) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, ok := extractBearerToken(c)
		if !ok {
			// 游客路径，最常见的分支，直接放行。
			c.Next()
			return
		}

		userID, err := parser.Parse(token)
		if err != nil {
			// 刻意不 abort：非法 token 在本接口下等价于「未登录」。
			c.Next()
			return
		}

		u, err := loader.Authenticate(c, userID)
		if err != nil {
			// 用户已被删除、数据库抖动等：同样降级为游客。
			// 但记一条日志 —— 数据库故障被静默吞掉会让问题极难发现。
			slog.Warn("软鉴权回查用户失败，按游客处理",
				"request_id", c.GetString(ContextRequestIDKey),
				"userId", userID,
				"error", err,
			)
			c.Next()
			return
		}

		c.Set(ContextUserKey, u)
		c.Next()
	}
}
