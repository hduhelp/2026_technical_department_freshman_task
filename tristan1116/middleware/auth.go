package middleware

import (
	"strings"

	"lostfound/utils"

	"github.com/gin-gonic/gin"
)

// JWTAuth 认证中间件：挂在需要登录的接口前面，负责"验明正身"
//
// 为什么写成 func() gin.HandlerFunc（返回函数的函数，即闭包）而不是直接写处理函数？
// 因为中间件将来可能需要参数（比如权限等级），返回函数的形式可以带参数，
// 这是 Gin 社区的标准写法（本地李文周博客里也是这个签名）
func JWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. 从请求头里取 Authorization，格式规定为：Bearer <token>
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			utils.Fail(c, utils.CodeUnauthorized, "请先登录")
			c.Abort() // ★ 关键：终止后续处理函数，不写这行的话接口还会继续执行！
			return
		}

		// 2. 按空格切成两段，校验格式（SplitN 的 2 表示最多切一刀）
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			utils.Fail(c, utils.CodeUnauthorized, "token 格式错误，应为：Bearer xxx")
			c.Abort()
			return
		}

		// 3. 解析 token（签名对不对？过期没有？）
		claims, err := utils.ParseToken(parts[1])
		if err != nil {
			utils.Fail(c, utils.CodeUnauthorized, "登录已过期，请重新登录")
			c.Abort()
			return
		}

		// 4. 把用户信息存进本次请求的上下文，后面的处理函数用 c.GetUint("user_id") 取
		//    （Context 相当于"这次请求的随身口袋"，中间件放进去，handler 拿出来）
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)

		c.Next() // 放行，交给下一个处理函数
	}
}
