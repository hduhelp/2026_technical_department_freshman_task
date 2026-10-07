package dao

import "lostfound/models"

// CreateUser 新增用户（GORM 会把结构体转成 INSERT 语句，并回填自增 ID）
func CreateUser(user *models.User) error {
	return DB.Create(user).Error
}

// GetUserByUsername 按用户名查询
// 注意 SQL 里用 ? 占位符传参，不要用字符串拼接 —— 那是 SQL 注入的源头
func GetUserByUsername(username string) (*models.User, error) {
	var user models.User
	if err := DB.Where("username = ?", username).First(&user).Error; err != nil {
		return nil, translate(err)
	}
	return &user, nil
}

// GetUserByID 按主键查询
func GetUserByID(id uint) (*models.User, error) {
	var user models.User
	if err := DB.First(&user, id).Error; err != nil {
		return nil, translate(err)
	}
	return &user, nil
}
