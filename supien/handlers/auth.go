package handlers

import (
	"errors"

	"campus-lost-found/models"
	"campus-lost-found/store"
	"campus-lost-found/utils"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// registerRequest 注册接口的请求参数
type registerRequest struct {
	Username string `json:"username" binding:"required,min=3,max=20"` // 3-20 位
	Password string `json:"password" binding:"required,min=6,max=32"` // 6-32 位
	Phone    string `json:"phone"`                                    // 选填
}

// Register 用户注册
// POST /api/register
func (h *Handler) Register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Error(c, 400, "参数错误：用户名需要 3-20 位，密码需要 6-32 位")
		return
	}

	// bcrypt 加密密码：数据库里不存明文密码
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		utils.Error(c, 500, "服务器内部错误")
		return
	}

	user := &models.User{
		Username: req.Username,
		Password: string(hash),
		Phone:    req.Phone,
	}
	user, err = h.store.CreateUser(user)
	if err != nil {
		if errors.Is(err, store.ErrUserExists) {
			utils.Error(c, 409, "用户名已存在，请换一个")
			return
		}
		utils.Error(c, 500, "服务器内部错误")
		return
	}

	// 注册成功后直接签发令牌，用户无需再登录一次
	token, err := utils.GenerateToken(user.ID)
	if err != nil {
		utils.Error(c, 500, "服务器内部错误")
		return
	}

	utils.Success(c, gin.H{
		"token": token,
		"user":  userVO(user),
	})
}

// loginRequest 登录接口的请求参数
type loginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// Login 用户登录
// POST /api/login
func (h *Handler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Error(c, 400, "请输入用户名和密码")
		return
	}

	user, ok := h.store.GetUserByUsername(req.Username)
	if !ok {
		utils.Error(c, 401, "用户名或密码错误")
		return
	}

	// 把请求中的密码和存储的加密密码做比对
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		utils.Error(c, 401, "用户名或密码错误")
		return
	}

	token, err := utils.GenerateToken(user.ID)
	if err != nil {
		utils.Error(c, 500, "服务器内部错误")
		return
	}

	utils.Success(c, gin.H{
		"token": token,
		"user":  userVO(user),
	})
}

// Logout 用户退出登录
// POST /api/logout （需要登录）
func (h *Handler) Logout(c *gin.Context) {
	// 中间件已经把原始令牌放进了上下文
	token, exists := c.Get("token")
	if !exists {
		utils.Error(c, 401, "未登录")
		return
	}
	h.store.AddBlacklist(token.(string))
	utils.Success(c, gin.H{"message": "已退出登录"})
}

// Me 获取当前登录用户信息
// GET /api/user/me （需要登录）
func (h *Handler) Me(c *gin.Context) {
	userID := c.GetInt64("userID")
	user, ok := h.store.GetUserByID(userID)
	if !ok {
		utils.Error(c, 404, "用户不存在")
		return
	}
	utils.Success(c, userVO(user))
}
