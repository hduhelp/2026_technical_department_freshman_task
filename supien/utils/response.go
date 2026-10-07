// Package utils 放一些通用的小工具：统一响应格式、JWT 令牌处理
package utils

import "github.com/gin-gonic/gin"

// 统一的响应格式：
// 成功 -> {"code":0, "message":"success", "data":...}
// 失败 -> {"code":错误码, "message":"错误原因", "data":null}

// Success 返回成功响应
func Success(c *gin.Context, data interface{}) {
	c.JSON(200, gin.H{
		"code":    0,
		"message": "success",
		"data":    data,
	})
}

// Error 返回错误响应，httpCode 同时作为 HTTP 状态码和业务 code
func Error(c *gin.Context, httpCode int, message string) {
	c.JSON(httpCode, gin.H{
		"code":    httpCode,
		"message": message,
		"data":    nil,
	})
}
