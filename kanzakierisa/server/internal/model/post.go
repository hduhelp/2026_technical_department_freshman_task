package model

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"hdu-lostfound/internal/pkg/valid"
)

// Images 是 posts.images 这一 MySQL JSON 列在 Go 侧的表示。
//
// 为什么不直接用 []string：sqlx / database/sql 只认识实现
// sql.Scanner 与 driver.Valuer 的类型。[]string 二者都不实现，
// 直接扫会报 "unsupported Scan, storing driver.Value type []uint8 into type *[]string"。
// 因此必须自定义类型并实现这两个接口，把它翻译成 JSON 文本进出数据库。
type Images []string

// Scan 实现 sql.Scanner，把数据库里的 JSON 文本读成 Images。
//
// 三种输入：
//   - nil（列为 NULL）：置为空切片而非 nil —— 保证调用方拿到的永远可直接
//     range / len，不必到处判空。
//   - []byte（驱动对 JSON/TEXT 列的默认返回）：反序列化。
//   - string（部分驱动/测试桩会给字符串）：同样反序列化。
//
// 反序列化失败**不 panic**，返回 error 交调用方处理 —— 数据损坏属可恢复
// 的服务端错误，应由中间件翻译成 5000，而不是让整个进程崩掉。
func (i *Images) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*i = Images{}
		return nil
	case []byte:
		// JSON 列在 MySQL 里可能是 NULL 字面量（历史数据或外部导入），一并兜底。
		if len(v) == 0 {
			*i = Images{}
			return nil
		}
		var out Images
		if err := json.Unmarshal(v, &out); err != nil {
			return fmt.Errorf("解析 posts.images 失败: %w", err)
		}
		if out == nil {
			out = Images{}
		}
		*i = out
		return nil
	case string:
		if v == "" {
			*i = Images{}
			return nil
		}
		var out Images
		if err := json.Unmarshal([]byte(v), &out); err != nil {
			return fmt.Errorf("解析 posts.images 失败: %w", err)
		}
		if out == nil {
			out = Images{}
		}
		*i = out
		return nil
	default:
		return fmt.Errorf("posts.images 类型不支持: %T", src)
	}
}

// Value 实现 driver.Valuer，把 Images 序列化为写入数据库的 JSON 文本。
//
// ⚠️ 关键点（SPEC 03 常见坑 1）：空切片必须序列化成 "[]" 而**不是 NULL**。
// 如果返回 nil，数据库里会写入 NULL，前端随后拿到 `"images": null`，
// `v-for` 直接抛错。这里统一交给 json.Marshal —— 它对空切片输出 "[]"，
// 对 nil 切片也输出 "null"，所以下方额外把 nil 归一化为空切片。
func (i Images) Value() (driver.Value, error) {
	if i == nil {
		i = Images{}
	}
	b, err := json.Marshal(i)
	if err != nil {
		return nil, fmt.Errorf("序列化 posts.images 失败: %w", err)
	}
	return string(b), nil
}

// Post 对应 posts 表的一行，并额外承载联表带出的 author 扁平字段。
//
// 为什么把 author 拍平成 AuthorID / AuthorNickname 等字段而不是嵌套结构：
// sqlx 的 StructScan 只认列名到字段的一一映射，嵌套结构需要额外的
// 递归扫描支持。拍平后用 `u.nickname AS author_nickname` 就能直接扫进来，
// 简单且无隐藏行为。组装成 SPEC 8.3 的嵌套 JSON 由 ToPostDTO 负责。
type Post struct {
	ID          int64     `db:"id"`
	UserID      int64     `db:"user_id"`
	Type        string    `db:"type"`
	Title       string    `db:"title"`
	Category    string    `db:"category"`
	Location    string    `db:"location"`
	HappenedAt  time.Time `db:"happened_at"`
	Description string    `db:"description"`
	Images      Images    `db:"images"`
	Status      string    `db:"status"`
	CreatedAt   time.Time `db:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"`

	// 以下为 JOIN users 带出的作者信息（列表/详情查询均填充）。
	AuthorID            int64  `db:"author_id"`
	AuthorNickname      string `db:"author_nickname"`
	AuthorContact       string `db:"author_contact"`
	AuthorContactPublic bool   `db:"author_contact_public"`
}

// AuthorBrief 是 PostDTO 内的作者摘要，对应 SPEC 8.3 的 author 对象。
//
// 刻意**只有** id / nickname / contact / contact_visible 四个字段：
// 没有 username、没有 role、更没有 password_hash。
// 「帖子的 author 对象里不可能泄出哈希」不靠调用方自觉，
// 而靠这里根本没有那个字段来保证（SPEC 03 收尾要求）。
type AuthorBrief struct {
	ID             int64  `json:"id"`
	Nickname       string `json:"nickname"`
	Contact        string `json:"contact"`
	ContactVisible bool   `json:"contact_visible"`
}

// PostDTO 是帖子的对外 JSON 形状，对应 SPEC 8.3 的 Post。
//
// 所有时间字段都用 string（RFC3339 UTC），不用 time.Time —— 后者交给
// encoding/json 序列化时会带上连接时区，导致前端差 8 小时。
type PostDTO struct {
	ID          int64       `json:"id"`
	UserID      int64       `json:"user_id"`
	Type        string      `json:"type"`
	Title       string      `json:"title"`
	Category    string      `json:"category"`
	Location    string      `json:"location"`
	HappenedAt  string      `json:"happened_at"`
	Description string      `json:"description"`
	Images      Images      `json:"images"`
	Status      string      `json:"status"`
	CreatedAt   string      `json:"created_at"`
	UpdatedAt   string      `json:"updated_at"`
	Author      AuthorBrief `json:"author"`
	CanEdit     bool        `json:"can_edit"`
	CanClaim    bool        `json:"can_claim"`
}

// PostView 是一次查询的「视角」参数，决定 DTO 里与请求者相关的字段。
//
// 把视角收敛成一个结构体而不是给 ToPostDTO 传一串布尔参数：
// 参数一多就分不清谁是谁，而 View 的字段名自带语义。
type PostView struct {
	// ViewerID 为当前请求者 id；0 表示游客。
	ViewerID int64
	// ViewerIsAdmin 表示请求者是否管理员（影响 can_edit 之外的运维视角，本期仅备位）。
	ViewerIsAdmin bool
	// HasApprovedClaim 表示「请求者在本帖下有 approved/redeemed 认领记录」，
	// 由 SPEC 7.2 的可见性规则使用。P2 阶段恒为 false，P6 接入真实查询。
	HasApprovedClaim bool
	// InList 表示本次 DTO 用于列表接口。
	//
	// 列表接口**一律**不返回 author.contact（哪怕规则判定可见），
	// 用来减少一次批量查询里的联系方式泄露面（SPEC 03 要点 4：
	// 「列表里 author.contact 一律为空串」），但 contact_visible 仍按规则计算，
	// 前端据此在列表卡片上显示「登录后可见」之类的提示。
	InList bool
}

// contactVisible 实现 SPEC 7.2 的联系方式三级可见性规则。
//
// 判定顺序即优先级，任一条命中即返回：
//
//  1. 游客                 → false
//  2. 请求者就是作者本人   → true
//  3. 作者主动公开         → true
//  4. 双方存在已通过的认领 → true
//  5. 其余                 → false
func contactVisible(viewerID int64, authorID int64, authorContactPublic bool, hasApprovedClaim bool) bool {
	if viewerID == 0 {
		return false
	}
	if viewerID == authorID {
		return true
	}
	if authorContactPublic {
		return true
	}
	if hasApprovedClaim {
		return true
	}
	return false
}

// ToPostDTO 把实体按给定视角组装成对外 DTO。
//
// 联系方式在这里**被决定是否对外暴露**：P2 阶段总是从数据库把
// author_contact 查出来，再按规则决定填 "" 还是真实值（SPEC 03 要点 3）。
// P3 会把这个判断下推到 SQL 层（不可见时干脆不 SELECT），
// 但对外行为不变 —— 这是纯粹的优化，不是语义变更。
func ToPostDTO(p *Post, view PostView) *PostDTO {
	if p == nil {
		return nil
	}

	visible := contactVisible(view.ViewerID, p.UserID, p.AuthorContactPublic, view.HasApprovedClaim)

	// 列表接口即使规则判定可见，也不填联系方式（减少批量泄露面）。
	contact := ""
	if visible && !view.InList {
		contact = p.AuthorContact
	}

	// can_edit：请求者是否为作者。管理员不通过本字段获得编辑权 ——
	// 编辑是「作者的创作权」，与「管理员的治理权」是两件事，
	// 混在一起会让审计日志说不清「谁改了内容」。
	canEdit := view.ViewerID != 0 && view.ViewerID == p.UserID

	// can_claim：按 SPEC 7.3 的前三条静态条件预判。游客恒为 false。
	// 第 4 条「是否已提交过认领」需要查 claims 表，属于 P6 的职责，
	// 这里只提供「按钮是否该出现」的粗判，真正的准入由服务端提交接口把关。
	canClaim := view.ViewerID != 0 &&
		view.ViewerID != p.UserID &&
		p.Type == valid.TypeFound &&
		p.Status != valid.StatusClosed

	images := p.Images
	if images == nil {
		images = Images{}
	}

	return &PostDTO{
		ID:          p.ID,
		UserID:      p.UserID,
		Type:        p.Type,
		Title:       p.Title,
		Category:    p.Category,
		Location:    p.Location,
		HappenedAt:  p.HappenedAt.UTC().Format(time.RFC3339),
		Description: p.Description,
		Images:      images,
		Status:      p.Status,
		CreatedAt:   p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   p.UpdatedAt.UTC().Format(time.RFC3339),
		Author: AuthorBrief{
			ID:             p.UserID,
			Nickname:       p.AuthorNickname,
			Contact:        contact,
			ContactVisible: visible,
		},
		CanEdit:  canEdit,
		CanClaim: canClaim,
	}
}

// CreatePostReq 是 POST /api/posts 的请求体。
//
// 用指针表达「可选项」：Title / Type / HappenedAt 是非指针，因为它们必填，
// 缺字段时零值恰好能被后续校验判为非法；其余可选项用指针，
// 以便区分「未传」与「传了空值」。
type CreatePostReq struct {
	Type        string   `json:"type" binding:"required"`
	Title       string   `json:"title" binding:"required"`
	Category    string   `json:"category"`
	Location    string   `json:"location"`
	HappenedAt  string   `json:"happened_at" binding:"required"`
	Description string   `json:"description"`
	Images      []string `json:"images"`
}

// UpdatePostReq 是 PUT /api/posts/:id 的请求体。
//
// ⚠️ 结构体**刻意不包含** type / status / user_id：
// 即使请求体带了这些键，JSON 解码阶段就会因找不到目标字段而丢弃，
// 「不允许修改 type 与 status」因此是解码层保证的，不依赖业务代码记得忽略。
// 这是 SPEC 03 要点 5 的落地方式。
//
// 全部字段为指针：PUT 的语义是「用请求体替换可编辑字段」，
// 但为了让前端可以只送变动的字段，这里仍按局部更新处理 ——
// 语义等同 PATCH，已在 docs/api.md 中写明。
type UpdatePostReq struct {
	Title       *string   `json:"title"`
	Category    *string   `json:"category"`
	Location    *string   `json:"location"`
	HappenedAt  *string   `json:"happened_at"`
	Description *string   `json:"description"`
	Images      *[]string `json:"images"`
}

// PatchStatusReq 是 PATCH /api/posts/:id/status 的请求体。
type PatchStatusReq struct {
	Status string `json:"status" binding:"required"`
}

// UploadResult 是 POST /api/upload 成功时的 data 形状。
type UploadResult struct {
	URL string `json:"url"`
}
