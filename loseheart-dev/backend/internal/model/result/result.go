package model

// Result 后端统一返回结果
type Result[T any] struct {
	// 成功编码固定为 1；新接口失败响应使用 vo.ErrorResponseVO。
	Code int `json:"code"`
	// 错误信息
	Msg string `json:"msg"`
	// 数据，任意类型
	Data T `json:"data"`
	// 服务端生成的请求追踪 ID
	RequestID string `json:"request_id"`
}

// Success 返回成功结果（不带数据）
func (r *Result[T]) Success() *Result[T] {
	r.Code = 1
	return r
}

// SuccessByData 返回成功结果（带数据）
func (r *Result[T]) SuccessByData(data T) *Result[T] {
	r.Code = 1
	r.Data = data
	return r
}

// Error 保留旧接口兼容。
// Deprecated: 新接口使用 vo.ErrorResponseVO 的字符串业务错误码。
func (r *Result[T]) Error(msg string) *Result[T] {
	r.Code = 0
	r.Msg = msg
	return r
}
