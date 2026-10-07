package utils

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

const (
	passwordMemory      uint32 = 19 * 1024
	passwordIterations  uint32 = 2
	passwordParallelism uint8  = 1
	passwordSaltLength         = 16
	passwordKeyLength   uint32 = 32
)

// HashPassword 使用独立随机盐生成 Argon2id PHC 记录；密码不 trim 或截断。
func HashPassword(password string) (string, error) {
	n := utf8.RuneCountInString(password)
	if !utf8.ValidString(password) || n < constant.PasswordMinLength || n > constant.PasswordMaxLength {
		return "", errs.InvalidPasswordError
	}
	salt := make([]byte, passwordSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, passwordIterations, passwordMemory, passwordParallelism, passwordKeyLength)
	return fmt.Sprintf("$argon2id$v=19$m=19456,t=2,p=1$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

// VerifyPassword 验证项目约定的 PHC 格式；限制参数，避免损坏记录触发异常内存分配。
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=19456,t=2,p=1" {
		return false, errs.PasswordHashError
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil || len(salt) != passwordSaltLength {
		return false, errs.PasswordHashError
	}
	expected, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil || len(expected) != int(passwordKeyLength) {
		return false, errs.PasswordHashError
	}
	actual := argon2.IDKey([]byte(password), salt, passwordIterations, passwordMemory, passwordParallelism, passwordKeyLength)
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}
