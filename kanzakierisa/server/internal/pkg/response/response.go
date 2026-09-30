// Package response 统一 HTTP 响应封装。
//
// 所有接口的响应体形状固定为：
//
//	{ "code": 0, "message": "ok", "data": ... }
//
// handler 只调用本包的 OK / Page / Fail，不自行拼裸结构。
package response

import (
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

// ListData 是列表类接口统一的 data 形状。
type ListData struct {
	List     any   `json:"list"`     // 当前页数据
	Page     int   `json:"page"`     // 当前页码，从 1 开始
	PageSize int   `json:"pageSize"` // 每页条数
	Total    int64 `json:"total"`    // 满足条件的总条数
}

// OK 返回成功响应，data 为业务数据（可为 nil，此时 JSON 中为 null）。
func OK(c *gin.Context, data any) {
	c.JSON(apperr.CodeOK, Body{
		Code:    apperr.CodeOK,
		Message: "ok",
		Data:    data,
	})
}

// OKEmpty 返回成功响应且 data 为 null，用于登出、删除等无返回体的操作。
func OKEmpty(c *gin.Context) {
	OK(c, nil)
}

// Page 返回分页列表响应。list 为 nil 时会被规范化为空切片，
// 保证前端拿到的始终是数组而非 null。
func Page(c *gin.Context, list any, page, pageSize int, total int64) {
	if list == nil {
		list = []any{}
	}
	OK(c, ListData{
		List:     list,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	})
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
