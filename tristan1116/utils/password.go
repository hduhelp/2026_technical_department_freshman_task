package utils

import "golang.org/x/crypto/bcrypt"

// HashPassword 把明文密码加密成哈希值
// bcrypt 的特点：自带随机盐 —— 同一个密码每次加密结果都不同，所以数据库泄露了也难被"查表"破解
func HashPassword(plain string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(bytes), err
}

// CheckPassword 校验"明文密码"和"数据库里的哈希"是否匹配
// bcrypt 自己会从哈希里取出盐来重新计算，所以不需要我们单独存盐
func CheckPassword(plain, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}
