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

	// ViewerHasApprovedClaim 表示「当前请求者在本帖下有 approved/redeemed 的
	// 认领记录」，由 post_store 的相关子查询在 SQL 层算出（SPEC 7.2 规则 4）。
	//
	// ⚠️ 这个字段与 author_contact 出自**同一条 SQL**，这不是巧合而是必需的：
	// 二者一个决定「联系方式有没有真实带出」，一个决定「contacts_visible 这个
	// 对外布尔该不该为真」。若分别从两次查询得到，并发下就可能出现
	// 「contact_visible=true 但 contact 是空串」这种自相矛盾的响应，
	// 前端两种 CTA 都渲染不出来。
	ViewerHasApprovedClaim bool `db:"viewer_has_approved_claim"`
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

	// MyClaim 是「当前请求者在这张帖子上自己提交的那条认领」，只在详情接口
	// 且请求者已登录时可能非空（07 §5）。为 null 表示没申请过，
	// 或者本次响应来自列表接口。
	//
	// 前端靠它渲染四种互斥的 CTA：待审核 / 已通过（凭证码卡片）/
	// 已拒绝（带理由）/ 可以认领。若只给 can_claim，前端无法区分
	// 「还没申请」与「申请了还在审」——那正是用户最容易困惑的状态。
	//
	// 刻意不加 omitempty：SPEC 8.1 的取向是「没有值时显式给 null」，
	// 字段时有时无会让前端的类型判断多一个分支。
	MyClaim *MyClaimDTO `json:"my_claim"`
}

// PostView 是一次查询的「视角」参数，决定 DTO 里与请求者相关的字段。
//
// 把视角收敛成一个结构体而不是给 ToPostDTO 传一串布尔参数：
// 参数一多就分不清谁是谁，而 View 的字段名自带语义。
//
// ⚠️ 这里**刻意没有** HasApprovedClaim 字段（P2 阶段曾有一个占位）。
// 认领关系是否成立由 post_store 的 SQL 直接算进实体的
// ViewerHasApprovedClaim，若 View 上再留一个同义字段，就会出现两个来源 ——
// 一旦有人只设置了其中一个，contact_visible 与 contact 就会打架。
// 单一来源优于「两个字段我保证它们一致」。
type PostView struct {
	// ViewerID 为当前请求者 id；0 表示游客。
	ViewerID int64
	// ViewerIsAdmin 表示请求者是否管理员（影响 can_edit 之外的运维视角，本期仅备位）。
	ViewerIsAdmin bool
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
//
// ⚠️ 本函数必须与 post_store.contactCaseSQL 的 CASE 分支逐条对应：
// 前者算出对外暴露的 contact_visible，后者决定 contact 是否真的被 SELECT。
// 两者一旦不一致，就会出现「contact_visible=true 但 contact=""」
// （前端渲染出一个空的联系方式框）或反过来的矛盾响应。
// 修改任一处的分支集合时，另一处必须同步 —— 这也是 P6 把
// hasApprovedClaim 从「恒为 false 的占位」换成真实值时必须一起动的原因。
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
// 联系方式是否对外暴露**已在 SQL 层决定**（SPEC 7.2 + post_store.go 的
// contactCaseSQL）：不可见的行，数据库直接返回空串，真实联系方式根本没
// 进入过应用内存。P2 阶段那种「全查出来再在内存里删」的写法已按 SPEC
// 要求下推掉，这是 P3 的一处刻意重构。
//
// 本函数里对 contact 的再次收窄不是重复劳动，而是**纵深防御**：
// 列表接口（view.InList）即便 store 传回了值也一律输出空串，
// 这样「列表不泄露联系方式」这条规则不会因为将来谁改了 store 的
// SELECT 清单而失守。
//
// hasApprovedClaim 取自实体而非 View：它和 author_contact 出自同一条 SQL
// （见 Post.ViewerHasApprovedClaim 的说明），从实体读才能保证两者一致。
func ToPostDTO(p *Post, view PostView) *PostDTO {
	if p == nil {
		return nil
	}

	visible := contactVisible(view.ViewerID, p.UserID, p.AuthorContactPublic, p.ViewerHasApprovedClaim)

	// 列表接口即使规则判定可见，也不填联系方式（减少批量泄露面）。
	contact := ""
	if visible && !view.InList {
		contact = p.AuthorContact
	}

	// can_edit：请求者是否为作者。管理员不通过本字段获得编辑权 ——
	// 编辑是「作者的创作权」，与「管理员的治理权」是两件事，
	// 混在一起会让审计日志说不清「谁改了内容」。
	canEdit := view.ViewerID != 0 && view.ViewerID == p.UserID

	// can_claim：按 SPEC 7.3 规则 1–3 的**静态条件**预判。游客恒为 false。
	//
	// ⚠️ P6 明确决定**不**在这里查询「我是否已提交过认领」（规则 4）：
	//   - 若查，列表接口就要为每一条帖子各跑一次 claims 查询（N+1），
	//     而这个字段在列表上只是「按钮该不该亮」的粗判，不值得那个代价；
	//   - 而且「已申请」需要表达的远不止一个布尔 —— 待审核、已通过（含凭证码）、
	//     已拒绝（含理由）是三种完全不同、需要不同 CTA 的状态，
	//     前端只拿到 can_claim=false 是无法区分的。
	//
	// 因此把「已申请」这件事交给详情接口的 my_claim 字段承载（07 §5），
	// can_claim 保持为一个在列表与详情上语义完全一致的静态判断。
	// 真正的准入始终由 POST /api/posts/:id/claims 把关：
	// 重复提交拿 1008，帖子已有通过认领拿 1010 —— 这两条是数据库唯一索引
	// 保证的硬约束，不依赖前端是否正确地隐藏了按钮。
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
