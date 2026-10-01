// Package password 封装 bcrypt 口令哈希。
//
// 设计要点：
//  1. cost 固定为 10（SPEC 3.1 / 10 安全基线），高于默认的 10 以下的强度，
//     又能把单次校验耗时压在人可接受的量级，避免登录接口被拖慢。
//  2. bcrypt 只接受前 72 字节，超长口令会被**静默截断**。
//     本包不负责长度校验（由 service 层限制 ≤64 位），但 MaxPlainLength
//     常量在此声明，供上层引用，避免两处各写一个魔数。
//  3. Verify 在任何失败路径都返回 false，绝不把底层错误暴露给调用方 ——
//     否则「哈希格式非法」与「口令错误」的差异会变成侧信道。
package password

import (
	"golang.org/x/crypto/bcrypt"
)

// Cost 是 bcrypt 的计算强度，SPEC 要求固定为 10。
const Cost = 10

// MaxPlainLength 是明文口令允许的最大字节数。
// bcrypt 超过 72 字节会静默截断，这里提前留出余量并统一由此收口。
const MaxPlainLength = 64

// Hash 用 bcrypt(cost=10) 生成口令哈希。
//
// 入参 plain 为明文口令；返回值为可直接入库的哈希串。
// 口令过长（> MaxPlainLength）或底层计算失败时返回错误。
func Hash(plain string) (string, error) {
	if len(plain) > MaxPlainLength {
		return "", bcrypt.ErrPasswordTooLong
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(plain), Cost)
	if err != nil {
		return "", err
	}
	return string(hashed), nil
}

// Verify 校验明文口令与哈希是否匹配。
//
// 无论哈希格式非法、口令为空还是比对不通过，一律返回 false，
// 调用方无需（也不应）区分具体失败原因。
func Verify(hash, plain string) bool {
	if hash == "" || plain == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}
