// Package pagination 统一分页参数的解析、归一化，以及列表信封的组装。
//
// 规则来自 SPEC 8.1 / 8.5 与阶段文件 04：
//   - page 缺省 1；非数字或 < 1 一律归一化为 1，**不报错**
//   - pageSize 缺省 10；非数字取 10，< 1 夹取为 1，> 50 夹取为 50，**不报错**
//   - Offset 由本包统一计算，避免各 store 各写一套 (page-1)*pageSize 导致口径漂移
//
// 为什么越界要「夹取」而不是返回 1001：分页参数由前端按用户操作拼装，
// 一个 pageSize=999 不该让整个列表页变成 400 被挡在门外；而 50 的上限
// 是防「一次拉全表」的必要保护。夹取同时满足可用性与兜底，二者不冲突。
package pagination

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	// DefaultPage 是缺省页码。
	DefaultPage = 1
	// DefaultPageSize 是缺省每页条数。
	DefaultPageSize = 10
	// MinPageSize 是每页条数的下界。
	MinPageSize = 1
	// MaxPageSize 是每页条数的上界（防止一次拉全表）。
	MaxPageSize = 50
)

// Page 是一次列表查询的分页参数，字段均已归一化。
type Page struct {
	Page     int // 页码，>= 1
	PageSize int // 每页条数，取值区间 [MinPageSize, MaxPageSize]
	Offset   int // SQL OFFSET 所需偏移量，(Page-1)*PageSize
}

// Parse 把 URL 查询串里的原始分页参数解析为归一化后的 Page。
//
// 入参刻意是**字符串**而不是 int：查询参数天然以字符串到达，
// 若让每个 handler 自己 strconv.Atoi 再判错，等于把同一套归一化规则
// 在 N 个 handler 里各抄一遍，迟早出现某个接口漏了边界处理。
// 解析失败一律按「未传」处理，交由缺省值兜底 —— 不返回 error 是刻意的，
// 见包注释里对「夹取 vs 报错」的说明。
func Parse(pageStr, sizeStr string) Page {
	page := atoiOrDefault(pageStr, DefaultPage)
	if page < DefaultPage {
		page = DefaultPage
	}

	pageSize := atoiOrDefault(sizeStr, DefaultPageSize)
	switch {
	case pageSize < MinPageSize:
		pageSize = MinPageSize
	case pageSize > MaxPageSize:
		pageSize = MaxPageSize
	}

	return Page{
		Page:     page,
		PageSize: pageSize,
		Offset:   (page - 1) * pageSize,
	}
}

// Result 把当前页数据与总条数组装成 SPEC 8.1 规定的列表结构。
//
// list 为 nil 时归一化为空切片：JSON 里必须是 [] 而不是 null，
// 否则前端 v-for 会在「零结果」这个最常见的分支上直接抛错。
// 另外「OFFSET 越界」也走这条路 —— 页码超出总页数时返回空 list 与
// code=0，而不是 404。
func (p Page) Result(list any, total int64) gin.H {
	if list == nil {
		list = []any{}
	}
	return gin.H{
		"list":     list,
		"page":     p.Page,
		"pageSize": p.PageSize,
		"total":    total,
	}
}

// atoiOrDefault 解析十进制整数；空串或解析失败时返回 def。
//
// 先 TrimSpace 再解析：前端拼 URL 时可能带进空格（如 "?page= 2"），
// 直接 Atoi 会失败并静默回落成缺省值，属于难以排查的「参数没生效」类问题。
func atoiOrDefault(s string, def int) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return v
}
