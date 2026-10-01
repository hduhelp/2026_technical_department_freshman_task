// Package similar 提供面向中文短文本的 2-gram 相似度工具。
//
// 为什么是 2-gram 而不是分词：中文没有天然的词边界，引入分词器要么
// 依赖外部词典（体积大、领域词覆盖差），要么需要模型。而失物招领的
// 文本很短（标题 ≤64 字、地点 ≤64 字），2-gram 恰好能在「无需词典」
// 与「能识别『图书馆』与『图书馆三楼』同源」之间取得平衡：
// 二者共享 gram「图书」「书馆」，交集非空即判定为相关。
//
// 代价是会有假阳性（「图书馆」与「图书室」共享「图书」），
// 但这个功能的产品定位是「给可能匹配，供人自己判断」，
// 而不是自动合并，假阳性只是多看一眼的成本；
// 反过来漏掉真匹配（假阴性）才是真正伤人的 —— 那会让失主错过自己的东西。
package similar

import (
	"strings"
	"unicode"
)

// normalize 预处理文本：去空白、去标点符号、统一小写。
//
// 保留的字符：Unicode 字母（含汉字）与数字。
// 丢弃的字符：空白、标点（中英文）、符号、emoji 等一切其余字符。
//
// 为什么要做这一步：用户写「图书馆 3 楼」与「图书馆3楼」、
// 「AirPods」与「airpods」，在语义上是同一件事。
// 不做归一化，2-gram 会因为一个空格或大小写差异而完全错开 ——
// 这不是「不精确」，而是把一个本该命中的匹配直接漏掉。
//
// 用 unicode 包的分类函数而不是正则：正则的 \p{L} 在 Go 里同样可用，
// 但逐个 rune 判断更直白，也省掉一次正则编译与匹配的开销
// （本函数会在「候选数 × 字段数」的量级上被调用）。
func normalize(s string) string {
	var b strings.Builder
	b.Grow(len(s))

	for _, r := range s {
		switch {
		case unicode.IsSpace(r):
			continue
		case unicode.IsLetter(r), unicode.IsDigit(r):
			b.WriteRune(unicode.ToLower(r))
		default:
			// 标点与符号：直接丢弃。
			// 不替换成空格 —— 那会在「图书馆,三楼」里插进一个 gram
			// 边界，让「馆三」这个真实相邻的 gram 消失。
		}
	}
	return b.String()
}

// Bigrams 返回字符串的连续 2-gram 集合（按 rune 切分，已做归一化）。
//
//	"图书馆三楼" → {"图书", "书馆", "馆三", "三楼"}
//
// 边界约定（07 §1）：
//   - 归一化后为空 → 返回空集合（调用方用 len()==0 表示「无有效文本」）；
//   - 长度不足 2（如单个汉字）→ 返回只含自身的集合，
//     这样「钥匙」与「钥匙」这种单字文本仍然能通过 Overlap 命中，
//     而不是因为凑不出 gram 被静默判为「不相似」。
//
// 用 map 而不是切片：Overlap 要做的是集合归属判断，
// 切片实现会让每次查询都退化成线性扫描（O(n·m)）。
func Bigrams(s string) map[string]struct{} {
	runes := []rune(normalize(s))

	switch len(runes) {
	case 0:
		return map[string]struct{}{}
	case 1:
		return map[string]struct{}{string(runes): {}}
	}

	out := make(map[string]struct{}, len(runes)-1)
	for i := 0; i+2 <= len(runes); i++ {
		out[string(runes[i:i+2])] = struct{}{}
	}
	return out
}

// Overlap 返回两个 gram 集合是否存在交集。
//
// 只回答「有没有」，不回答「有多少」：SPEC 7.4 的打分表里，
// 地点与标题两个维度都是「非空即得分」的二元判断。
// 若改成按重合度加权，短文本（书名、地点）会因为 gram 总数少
// 而天然拿到更高的重合比例，长文本反而吃亏 —— 那是另一种偏差。
//
// 遍历较小的集合：复杂度从 O(|a|+|b|) 降到 O(min(|a|,|b|))，
// 在两个字段的规模上收益有限，但这是免费的。
func Overlap(a, b map[string]struct{}) bool {
	if len(a) == 0 || len(b) == 0 {
		return false
	}
	if len(a) > len(b) {
		a, b = b, a
	}
	for gram := range a {
		if _, ok := b[gram]; ok {
			return true
		}
	}
	return false
}
