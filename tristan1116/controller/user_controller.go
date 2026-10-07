package controller

import (
	"errors"

	"lostfound/models"
	"lostfound/service"
	"lostfound/utils"

	"github.com/gin-gonic/gin"
)

// Register 处理 POST /api/auth/register
func Register(c *gin.Context) {
	// 1. 解析并校验请求体：binding tag 不满足时 ShouldBindJSON 会返回 error
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Fail(c, utils.CodeInvalidParam, "参数错误："+err.Error())
		return
	}

	// 2. 交给 service 处理业务（controller 只做"收参数 → 调 service → 发响应"，不写业务逻辑）
	user, err := service.Register(req)
	if err != nil {
		if errors.Is(err, service.ErrUsernameTaken) {
			utils.Fail(c, utils.CodeUsernameTaken, err.Error())
			return
		}
		utils.Fail(c, utils.CodeServerError, "注册失败")
		return
	}

	// 3. 返回用户信息（Password 字段有 json:"-"，不会泄露）
	utils.OKMsg(c, "注册成功", user)
}

// Login 处理 POST /api/auth/login
func Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Fail(c, utils.CodeInvalidParam, "参数错误："+err.Error())
		return
	}

	user, token, err := service.Login(req)
	if err != nil {
		if errors.Is(err, service.ErrWrongCredentials) {
			utils.Fail(c, utils.CodeWrongPassword, err.Error())
			return
		}
		utils.Fail(c, utils.CodeServerError, "登录失败")
		return
	}

	utils.OKMsg(c, "登录成功", gin.H{
		"token": token,
		"user":  user,
	})
}

// GetMe 处理 GET /api/auth/me —— 获取当前登录用户（前端用来判断"我是谁"）
func GetMe(c *gin.Context) {
	// user_id 是 JWTAuth 中间件解析 token 后塞进 Context 的
	userID := c.GetUint("user_id")

	user, err := service.GetUserByID(userID)
	if err != nil {
		utils.Fail(c, utils.CodeServerError, "获取用户信息失败")
		return
	}
	utils.OK(c, user)
}

// Logout 处理 POST /api/auth/logout
//
// 这里有个必须讲清楚的设计点：JWT 是"无状态"的 —— token 一旦签发，
// 服务端就没有它的记录，也就无法单方面作废它（除非引入 Redis 黑名单，超出本项目范围）。
// 所以"退出登录"真正发生的地方是前端：把本地保存的 token 删掉。
// 保留这个接口的意义：① 满足任务书"退出登录"的要求；② 前端有一个统一的收尾调用点，
// 将来若要换成 Redis 黑名单方案，前端代码不用改。
func Logout(c *gin.Context) {
	utils.OKMsg(c, "已退出登录（前端请删除本地保存的 token）", nil)
}
