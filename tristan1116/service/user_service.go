package service

import (
	"errors"
	"strings"

	"lostfound/dao"
	"lostfound/models"
	"lostfound/utils"
)

// Register 注册：查重 → 密码加密 → 入库
func Register(req models.RegisterRequest) (*models.User, error) {
	// 1. 先查用户名有没有被占用（主动查一次，比等数据库报唯一索引冲突再翻译更友好）
	_, err := dao.GetUserByUsername(req.Username)
	if err == nil {
		return nil, ErrUsernameTaken // 查到了 → 用户名已存在
	}
	if !errors.Is(err, dao.ErrNotFound) {
		return nil, err // 不是"没找到"，而是数据库真出错了
	}

	// 2. 密码加密（绝不能明文存库；bcrypt 自带随机盐）
	hash, err := utils.HashPassword(req.Password)
	if err != nil {
		return nil, err
	}

	// 3. 组装成 User 并入库（TrimSpace 去掉首尾空格，防止" admin"这种绕过查重）
	user := &models.User{
		Username:  strings.TrimSpace(req.Username),
		Password:  hash,
		Nickname:  strings.TrimSpace(req.Nickname),
		StudentID: strings.TrimSpace(req.StudentID),
	}
	if err := dao.CreateUser(user); err != nil {
		return nil, err
	}
	return user, nil
}

// Login 登录：查用户 → 验密码 → 签发 token
func Login(req models.LoginRequest) (*models.User, string, error) {
	user, err := dao.GetUserByUsername(strings.TrimSpace(req.Username))
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			// 故意不区分"用户不存在"和"密码错误"：防止别人拿这个接口探测哪些用户名已注册
			return nil, "", ErrWrongCredentials
		}
		return nil, "", err
	}

	if !utils.CheckPassword(req.Password, user.Password) {
		return nil, "", ErrWrongCredentials
	}

	token, err := utils.GenToken(user.ID, user.Username)
	if err != nil {
		return nil, "", err
	}
	return user, token, nil
}

// GetUserByID 获取当前用户信息（供 /api/auth/me 用）
func GetUserByID(id uint) (*models.User, error) {
	return dao.GetUserByID(id)
}
