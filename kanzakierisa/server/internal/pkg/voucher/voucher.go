// Package voucher 生成并规范化「认领交接凭证码」。
//
// 凭证码是 SPEC 7.3 规则 6 的产物：帖主审核通过一条认领时生成，
// 线下交接时由申请人出示、帖主核销，是整条认领链路的最后一道闸门。
package voucher

import (
	"crypto/rand"
	"fmt"
	"strings"
)

// alphabet 是凭证码的字符表。
//
// ⚠️ 刻意剔除 `0 O 1 I L` 五个字符（SPEC 7.3 规则 6）：
// 凭证码是在线下口头念、手抄、截图转发之间传递的，
// `0`/`O` 与 `1`/`I`/`L` 这三组在大写字母与数字混排时几乎无法靠肉眼区分。
// 用户抄错一个字符就核销失败，而这个失败对用户完全不可解释
// （他手里的码「看起来」是对的），所以从字符表层面消灭混淆源，
// 比事后在 UI 上提示「请注意区分 0 和 O」有效得多。
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// Length 是凭证码的位数（SPEC 7.3 规则 6 规定的 6 位）。
const Length = 6

// codeSpace 是字符表长度，必须恰好是 2 的幂。
//
// 32 = 2^5，因此 Generate 里「随机字节 & 31」是**无模偏差**的均匀采样：
// 256 能被 32 整除，取低 5 位不会让任何字符比别的字符更容易出现。
// 若字符表长度不是 2 的幂，就必须改用拒绝采样，否则凭证码的熵会低于名义值。
const codeSpace = len(alphabet)

// Generate 生成一个 6 位凭证码。
//
// 用 crypto/rand 而不是 math/rand：凭证码是核销的唯一凭据，
// 可预测的伪随机序列意味着攻击者能算出别人帖子的码去冒领物品。
// 32^6 ≈ 10.7 亿种组合，配合「一帖最多一条通过记录」，
// 暴力枚举在 5 次失败即被限流前不可能命中。
func Generate() (string, error) {
	buf := make([]byte, Length)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("读取随机源失败: %w", err)
	}

	out := make([]byte, Length)
	for i, b := range buf {
		// b 是均匀分布的字节，b&31 因此是均匀分布的 [0,31]，直接当索引用。
		out[i] = alphabet[int(b)&(codeSpace-1)]
	}
	return string(out), nil
}

// Normalize 规范化用户输入的凭证码。
//
// 只做两件与「手抄/复制」有关的清洁工作，不做任何纠错猜测：
//   - 去掉首尾空白：从聊天窗口复制时极易带上空格或换行；
//   - 统一转大写：字符表本身全是大写，用户手打时不会去按 Shift。
//
// ⚠️ 刻意**不做** `O→0`、`l→1` 之类的「形近字符纠正」：
// 字符表里根本不存在这些字符，一旦发生纠正就等于把两个不同的输入
// 映射成同一个码，等于人为降低了码的区分度，得不偿失。
func Normalize(raw string) string {
	return strings.ToUpper(strings.TrimSpace(raw))
}

// LooksValid 判断字符串形状是否像一个凭证码（长度与字符集）。
//
// 仅用于「明显错的东西早点拒绝」，不替代核销时的真正比对 ——
// 真正比对必须走 subtle.ConstantTimeCompare（见 claim_service）。
func LooksValid(code string) bool {
	if len(code) != Length {
		return false
	}
	for i := 0; i < len(code); i++ {
		if !strings.ContainsRune(alphabet, rune(code[i])) {
			return false
		}
	}
	return true
}
