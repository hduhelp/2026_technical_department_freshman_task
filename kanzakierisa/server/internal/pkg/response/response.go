// Package response 统一 HTTP 响应封装。
//
// 所有接口的响应体形状固定为：
//
//	{ "code": 0, "message": "ok", "data": ... }
//
// 列表类接口的 data 形状由 pagination.Page.Result 组装（含 list/page/pageSize/total），
// 本包只负责「把信封写出去」这一件事。
//
// handler 只调用本包的 OK / OKEmpty / Fail，不自行拼裸结构。
package response

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"hdu-lostfound/internal/pkg/apperr"
)

// Body 是统一响应体的数据结构，与 SPEC 第 8.1 节一致。
//
// 注意：Data 刻意不加 omitempty —— SPEC 要求 data 为 null 时字段必须存在
// 并显式返回 null，而不是整个键消失。
type Body struct {
	Code    int    `json:"code"`    // 业务错误码，0 表示成功
	Message string `json:"message"` // 面向用户的提示文案
	Data    any    `json:"data"`    // 业务数据，可为 null
}

// OK 返回成功响应，data 为业务数据（可为 nil，此时 JSON 中为 null）。
//
// ⚠️ 第一个参数必须是 **HTTP 状态码**，不能想当然地传 apperr.CodeOK：
// 业务码 0 不是一个合法的 HTTP 状态码。gin 的 responseWriter.WriteHeader
// 内部有 `if code > 0` 的兜底，传 0 时它会静默保留默认的 200 ——
// 也就是说写错了也能跑通，只在日志与实际状态码上留下难以察觉的偏差。
// 这里显式写 http.StatusOK，让正确性由代码表达，而不是由库的兜底表达。
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, Body{
		Code:    apperr.CodeOK,
		Message: "ok",
		Data:    data,
	})
}

// OKEmpty 返回成功响应且 data 为 null，用于登出、删除等无返回体的操作。
func OKEmpty(c *gin.Context) {
	OK(c, nil)
}

// Fail 按业务错误写出对应 HTTP 状态码与统一错误响应体。
// 传入非 *apperr.Error 时统一收敛为 5000，不向前端泄露内部细节。
func Fail(c *gin.Context, err error) {
	appErr := apperr.FromError(err)
	c.JSON(appErr.HTTPStatus, Body{
		Code:    appErr.Code,
		Message: appErr.Message,
		Data:    nil,
	})
}
