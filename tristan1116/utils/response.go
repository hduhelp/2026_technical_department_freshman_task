package utils

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// 业务错误码：0 = 成功，其余按含义分类
// 用常量代替魔法数字，前端和文档都对着这份清单写
const (
	CodeSuccess = 0

	CodeInvalidParam   = 1001 // 参数错误
	CodeUnauthorized   = 1002 // 未登录 / token 无效
	CodeForbidden      = 1003 // 没有权限（比如想改别人的帖子）
	CodeNotFound       = 1004 // 资源不存在
	CodeUsernameTaken  = 1005 // 用户名已被注册
	CodeWrongPassword  = 1006 // 用户名或密码错误
	CodeStatusBackward = 1007 // 状态只能前进，不能回退
	CodeServerError    = 1008 // 服务器内部错误
)

// Response 是所有接口统一的响应结构
// 字段名首字母大写才能被 JSON 序列化；`json:"xxx"` 决定输出时的 key 名
type Response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"` // any 是 interface{} 的简写（Go 1.18+），表示"任意类型"
}

// OK 成功响应（message 固定为 "ok"）
func OK(c *gin.Context, data any) {
	OKMsg(c, "ok", data)
}

// OKMsg 成功响应（自定义 message）
func OKMsg(c *gin.Context, message string, data any) {
	c.JSON(http.StatusOK, Response{Code: CodeSuccess, Message: message, Data: data})
}

// Fail 失败响应：业务码 + 对应的 HTTP 状态码（401/403/404/400/500）
func Fail(c *gin.Context, code int, message string) {
	c.JSON(httpStatus(code), Response{Code: code, Message: message, Data: nil})
}

// httpStatus 把业务码映射成 HTTP 状态码
// 好处：Apifox 里一眼能看出哪些接口是 401/403，前端也能用统一逻辑判断
func httpStatus(code int) int {
	switch code {
	case CodeUnauthorized:
		return http.StatusUnauthorized // 401
	case CodeForbidden:
		return http.StatusForbidden // 403
	case CodeNotFound:
		return http.StatusNotFound // 404
	case CodeServerError:
		return http.StatusInternalServerError // 500
	default:
		return http.StatusBadRequest // 400
	}
}
