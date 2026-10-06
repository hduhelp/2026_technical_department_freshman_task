package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const (
	saltLen    = 16
	pbkdf2Iter = 120000
	keyLen     = 32
)

// HashPassword 使用 PBKDF2-SHA256（加盐）生成密码哈希，返回 "salt$hash" 的十六进制字符串。
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := pbkdf2([]byte(password), salt, pbkdf2Iter, keyLen)
	return hex.EncodeToString(salt) + "$" + hex.EncodeToString(key), nil
}

// VerifyPassword 校验密码与哈希是否匹配。
func VerifyPassword(password, encoded string) bool {
	saltHex, keyHex, ok := strings.Cut(encoded, "$")
	if !ok {
		return false
	}
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(keyHex)
	if err != nil {
		return false
	}
	key := pbkdf2([]byte(password), salt, pbkdf2Iter, len(expected))
	return hmac.Equal(key, expected)
}

// NewToken 生成一个随机会话令牌（十六进制字符串）。
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// pbkdf2 使用标准库 hmac+sha256 实现 PBKDF2，避免引入外部依赖。
func pbkdf2(password, salt []byte, iter, keyLen int) []byte {
	hashLen := sha256.Size
	numBlocks := (keyLen + hashLen - 1) / hashLen

	var dk []byte
	for block := 1; block <= numBlocks; block++ {
		prf := hmac.New(sha256.New, password)
		prf.Write(salt)
		var idx [4]byte
		idx[0] = byte(block >> 24)
		idx[1] = byte(block >> 16)
		idx[2] = byte(block >> 8)
		idx[3] = byte(block)
		prf.Write(idx[:])

		u := prf.Sum(nil)
		t := make([]byte, len(u))
		copy(t, u)

		for i := 1; i < iter; i++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}
