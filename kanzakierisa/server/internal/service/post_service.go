package service

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/valid"
	"hdu-lostfound/internal/store"
)

// 帖子字段的长度与数量约束（SPEC 8.5）。全部以 **rune** 计，不是字节 ——
// 中文标题用 len() 会得到 3 倍数值，一个 22 字的中文标题会被误判超长。
const (
	maxPostTitleLen       = 64
	maxPostLocationLen    = 64
	maxPostDescriptionLen = 2000
	maxPostImages         = 3
	// uploadURLPrefix 是图片 URL 的强制前缀，防前端塞入外部链接或跳转地址。
	uploadURLPrefix = "/uploads/"
	// happenedAtFutureTolerance 允许 happened_at 略微超前。
	//
	// 为什么不是严格「不得晚于现在」：前端展示与提交通常分两步，
	// 用户点「提交」的瞬间可能比填表时晚了几分钟，加上客户端与服务端
	// 的时钟漂移，严格的 now 会把合法请求挡在门外。给 1 小时余量
	// 既能容纳这些场景，又能挡住「未来三天」这类明显错误的数据。
	happenedAtFutureTolerance = time.Hour
)

// PostService 负责帖子的创建、更新、删除、详情与权限判定。
type PostService struct {
	posts *store.PostStore
	users *store.UserStore
}

// NewPostService 创建帖子服务。
func NewPostService(posts *store.PostStore, users *store.UserStore) *PostService {
	return &PostService{posts: posts, users: users}
}

// Create 创建帖子（SPEC 03 要点 4）。
//
// 初始 status 固定为 open，**不接受前端传入** —— CreatePostReq 里
// 根本没有 status 字段，请求体带了也会在解码阶段被丢弃。
func (s *PostService) Create(ctx context.Context, userID int64, req model.CreatePostReq) (*model.PostDTO, error) {
	p := &model.Post{
		UserID: userID,
		Status: valid.StatusOpen,
	}

	if err := s.applyFields(p, req.Type, req.Title, req.Category, req.Location,
		req.HappenedAt, req.Description, req.Images, true); err != nil {
		return nil, err
	}

	id, err := s.posts.Create(ctx, p)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	return s.detailByID(ctx, id, model.PostView{ViewerID: userID})
}

// Update 更新帖子（SPEC 03 要点 5）。
//
// 权限与状态检查顺序刻意如此：
//  1. 先查帖子 → 不存在 1004
//  2. 再判作者 → 非作者 1003。**不用 can_edit 之类的前端字段做鉴权**，
//     服务端必须独立判断，否则改一个请求体就能越权。
//  3. 最后查状态 → 已结束 1007
//
// 顺序先于校验字段：让「无权的人」拿不到「你校验失败」这种可用于探测
// 帖子是否存在的信息差异 —— 越权者无论如何都是 403。
func (s *PostService) Update(ctx context.Context, postID, userID int64, req model.UpdatePostReq) (*model.PostDTO, error) {
	existing, err := s.posts.GetByID(ctx, postID, userID)
	if err != nil {
		return nil, err
	}
	if existing.UserID != userID {
		return nil, apperr.New(apperr.CodeForbidden)
	}
	// closed 是终态，不可再编辑（SPEC 03 要点 5）。
	if existing.Status == valid.StatusClosed {
		return nil, apperr.Newf(apperr.CodeInvalidStatus, "已结束的帖子不能再编辑")
	}

	// 以库中现值作为基线，只覆盖请求中真正出现的字段。
	next := *existing
	next.Title = nullOr(req.Title, existing.Title)
	next.Category = nullOr(req.Category, existing.Category)
	next.Location = nullOr(req.Location, existing.Location)
	next.Description = nullOr(req.Description, existing.Description)

	// happened_at 是字符串入参，缺省（nil）表示不修改；传了就必须能解析。
	happenedAtRaw := existing.HappenedAt.UTC().Format(time.RFC3339)
	if req.HappenedAt != nil {
		happenedAtRaw = *req.HappenedAt
	}

	// type 沿用例子的值：不允许修改，上传下效地固定住。
	if err := s.applyFields(&next, existing.Type, next.Title, next.Category, next.Location,
		happenedAtRaw, next.Description, imagesOr(req.Images, existing.Images), true); err != nil {
		return nil, err
	}

	if err := s.posts.Update(ctx, &next); err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	return s.detailByID(ctx, postID, model.PostView{ViewerID: userID})
}

// Delete 删除帖子（SPEC 03 要点 6）。
//
// 级联删除 claims 由数据库外键完成，这里不写第二份逻辑。
func (s *PostService) Delete(ctx context.Context, postID, userID int64) error {
	existing, err := s.posts.GetByID(ctx, postID, userID)
	if err != nil {
		return err
	}
	if existing.UserID != userID {
		return apperr.New(apperr.CodeForbidden)
	}
	if err := s.posts.Delete(ctx, postID); err != nil {
		return apperr.Wrap(apperr.CodeInternal, err)
	}
	return nil
}

// Detail 返回帖子详情。
//
// view 由 handler 依据当前请求者（可能为游客，ViewerID=0）构造。
// 这里刻意**不做**存在性之外的业务拦截：详情接口对所有人开放，
// 敏感信息由 ToPostDTO 按可见性规则裁剪，而不是靠拒绝请求。
func (s *PostService) Detail(ctx context.Context, postID int64, view model.PostView) (*model.PostDTO, error) {
	return s.detailByID(ctx, postID, view)
}

// detailByID 是详情与写操作共用的「查库 → 组装 DTO」内部方法。
//
// 抽出来的价值：创建/更新成功后都要返回与数据库完全一致的 DTO，
// 若各自手写组装，容易漏掉 updated_at 的刷新或 author 字段的填充。
//
// 注意把 view.ViewerID 一路传给 store：联系方式是否可见是在 SQL 层
// 决定的（SPEC 7.2），store 需要知道「这次是替谁查的」。
func (s *PostService) detailByID(ctx context.Context, postID int64, view model.PostView) (*model.PostDTO, error) {
	p, err := s.posts.GetByID(ctx, postID, view.ViewerID)
	if err != nil {
		return nil, err
	}
	return model.ToPostDTO(p, view), nil
}

// applyFields 校验并写入帖子的可编辑字段。
//
// 同一个方法服务创建与更新两条路径，保证两侧的校验规则**不可能不一致** ——
// 这是 SPEC 03「校验规则同创建」的落地方式（复制粘贴两份校验迟早会漂移）。
// 校验失败一律返回 1001，并带上具体是哪个字段、为什么。
func (s *PostService) applyFields(
	p *model.Post,
	postType, title, category, location, happenedAt, description string,
	images []string,
	withAuthor bool,
) error {
	// type：必填且必须在白名单内。
	if !valid.Contains(valid.ValidTypes, postType) {
		return apperr.Newf(apperr.CodeInvalidParam, "type 必须是 lost 或 found")
	}

	// title：1–64 rune。
	trimmedTitle := strings.TrimSpace(title)
	if trimmedTitle == "" {
		return apperr.Newf(apperr.CodeInvalidParam, "标题不能为空")
	}
	if utf8.RuneCountInString(trimmedTitle) > maxPostTitleLen {
		return apperr.Newf(apperr.CodeInvalidParam, "标题长度不能超过 64 个字符")
	}

	// category：可选，缺省 other，给了就必须合法。
	normalizedCategory := strings.TrimSpace(category)
	if normalizedCategory == "" {
		normalizedCategory = valid.CategoryOther
	}
	if !valid.Contains(valid.ValidCategories, normalizedCategory) {
		return apperr.Newf(apperr.CodeInvalidParam, "category 不是合法的分类")
	}

	// location：可选，≤64 rune。
	trimmedLocation := strings.TrimSpace(location)
	if utf8.RuneCountInString(trimmedLocation) > maxPostLocationLen {
		return apperr.Newf(apperr.CodeInvalidParam, "地点长度不能超过 64 个字符")
	}

	// description：可选，≤2000 rune。
	if utf8.RuneCountInString(description) > maxPostDescriptionLen {
		return apperr.Newf(apperr.CodeInvalidParam, "描述长度不能超过 2000 个字符")
	}

	// happened_at：必填、可解析、且不晚于 now + 1h。
	parsedAt, err := parseHappenedAt(happenedAt)
	if err != nil {
		return err
	}
	if parsedAt.After(time.Now().UTC().Add(happenedAtFutureTolerance)) {
		return apperr.Newf(apperr.CodeInvalidParam, "发生时间不能晚于当前时间")
	}

	// images：≤3 项，每项必须以 /uploads/ 开头且不含 ".."。
	normalizedImages, err := validateImages(images)
	if err != nil {
		return err
	}

	p.Type = postType
	p.Title = trimmedTitle
	p.Category = normalizedCategory
	p.Location = trimmedLocation
	p.HappenedAt = parsedAt
	p.Description = description
	p.Images = normalizedImages
	return nil
}

// parseHappenedAt 解析 RFC3339 时间串。
//
// 先试 time.RFC3339，失败再试 time.RFC3339Nano —— 前端 JS 的
// toISOString() 会带毫秒（如 2026-09-26T14:30:00.000Z），
// 而 time.RFC3339 的布局不接受小数秒，不放宽会误判为格式错误。
//
// 解析结果统一转 UTC：库里存 UTC，响应也按 UTC 输出，
// 整条链路只有一个时区，前端永远只需做一次「UTC → 本地」的展示转换。
func parseHappenedAt(raw string) (time.Time, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return time.Time{}, apperr.Newf(apperr.CodeInvalidParam, "happened_at 必填")
	}

	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t, err = time.Parse(time.RFC3339Nano, s)
		if err != nil {
			return time.Time{}, apperr.Newf(apperr.CodeInvalidParam,
				"happened_at 格式不合法，需为 RFC3339（如 2026-09-26T14:30:00Z）")
		}
	}
	return t.UTC(), nil
}

// validateImages 校验图片 URL 列表并归一化。
//
// 两条约束缺一不可：
//   - 必须 /uploads/ 开头：防止前端塞入任意外链（外链可用于追踪访客 IP，
//     也可能在展示层触发不可控的混合内容警告）。
//   - 不含 ".."：防止 /uploads/../../etc/passwd 之类的路径穿越被存进库，
//     虽然本项目用 r.Static 提供服务、不会真的按这个路径去读文件，
//     但脏数据一旦入库就会在别处（比如导出、备份脚本）变成真实风险。
func validateImages(images []string) (model.Images, error) {
	if len(images) > maxPostImages {
		return nil, apperr.Newf(apperr.CodeInvalidParam, "图片最多 3 张")
	}

	out := make(model.Images, 0, len(images))
	for _, raw := range images {
		url := strings.TrimSpace(raw)
		if url == "" {
			return nil, apperr.Newf(apperr.CodeInvalidParam, "图片地址不能为空")
		}
		if !strings.HasPrefix(url, uploadURLPrefix) {
			return nil, apperr.Newf(apperr.CodeInvalidParam, "图片地址必须以 /uploads/ 开头")
		}
		if strings.Contains(url, "..") {
			return nil, apperr.Newf(apperr.CodeInvalidParam, "图片地址不合法")
		}
		out = append(out, url)
	}
	return out, nil
}

// nullOr 在指针为 nil 时返回 fallback，否则返回去空白后的值。
func nullOr(v *string, fallback string) string {
	if v == nil {
		return fallback
	}
	return strings.TrimSpace(*v)
}

// imagesOr 在指针为 nil 时返回 fallback，否则返回值本身。
func imagesOr(v *[]string, fallback model.Images) []string {
	if v == nil {
		return fallback
	}
	return *v
}

// ==================== P3：列表查询与状态流转 ====================

// ListFilter 是列表筛选条件。
//
// 用**类型别名**指向 store.ListFilter，而不是在 service 里再定义一份字段
// 一模一样的结构体：条件是在 store 里被翻译成 SQL 的，真相在那一侧；
// 这里重定义一份，将来加字段时必然出现「service 加了、store 没加」的漂移。
//
// 之所以要在 service 再导出一次，是为了让 handler 只依赖 service 一层 ——
// handler 里出现 store 包，本项目的分层（handler → service → store）
// 就不再是一条直线了。
type ListFilter = store.ListFilter

// allowedTransitions 是 SPEC 7.1 的合法跳转白名单。
//
//	open ──▶ matched ──▶ closed
//	  └──────────────────▶ closed
//
// closed 是终态（对应空切片 = 没有任何出边），不可逆。
// 放在 service 层而不是数据库约束里：状态机是业务规则，
// 而这里同时要在「认领审核/核销」的自动流转中复用同一份定义。
var allowedTransitions = map[string][]string{
	valid.StatusOpen:    {valid.StatusMatched, valid.StatusClosed},
	valid.StatusMatched: {valid.StatusClosed},
	valid.StatusClosed:  {},
}

// ValidateTransition 校验状态流转是否命中 SPEC 7.1 的白名单。
//
// 导出（首字母大写）是**刻意**的：P6 的认领流程在「审核通过」「核销」
// 时需要触发帖子的自动流转，必须复用这一个函数。若在 claim_service 里
// 再写一份规则表，两份定义迟早分叉 —— 那正是状态机最典型的失效方式：
// 手动流转拦得住的非法跳转，自动流转却放过去了。
func ValidateTransition(from, to string) error {
	allowed, ok := allowedTransitions[from]
	if !ok {
		// 库里出现了白名单之外的状态值，属于数据异常而非用户输入问题。
		return apperr.Newf(apperr.CodeInvalidStatus, "帖子当前状态不合法")
	}
	if !valid.Contains(allowed, to) {
		return apperr.Newf(apperr.CodeInvalidStatus, "帖子状态不能从 %s 变更为 %s", from, to)
	}
	return nil
}

// List 分页查询帖子列表（GET /api/posts，游客可访问）。
//
// 返回 (当前页 DTO 列表, 满足条件的总数, error)。
// limit / offset 由 handler 用 pagination.Page 算好后传入 ——
// service 只认两个整数，不需要知道「页码」「每页条数」这些分页概念，
// 也就不会反向依赖 HTTP 语义。
func (s *PostService) List(ctx context.Context, f ListFilter, view model.PostView, limit, offset int) ([]*model.PostDTO, int64, error) {
	f = normalizeListFilter(f)

	// 强制 InList：列表接口一律不返回 author.contact（SPEC 8.3 / 04 §4）。
	// 放在 service 里而不是指望 handler 记得设，是因为「忘记设」的后果是
	// 整站用户的联系方式在一次列表请求里被批量带走。
	view.InList = true

	total, err := s.posts.Count(ctx, f)
	if err != nil {
		return nil, 0, apperr.Wrap(apperr.CodeInternal, err)
	}

	rows, err := s.posts.List(ctx, f, limit, offset)
	if err != nil {
		return nil, 0, apperr.Wrap(apperr.CodeInternal, err)
	}

	return toPostDTOs(rows, view), total, nil
}

// ListMine 分页查询「我的帖子」（GET /api/users/me/posts）。
//
// 只支持 status 筛选（用于「我的」页面的状态 Tab），其余同 List。
// userID 由 handler 取自当前登录用户，**不接受任何查询参数** ——
// 否则改一个 ?user_id= 就能翻别人的帖子。
func (s *PostService) ListMine(ctx context.Context, userID int64, status string, view model.PostView, limit, offset int) ([]*model.PostDTO, int64, error) {
	f := normalizeListFilter(ListFilter{UserID: userID, Status: status})

	view.InList = true

	// 计数与取数用同一份条件（UserID + Status），total 才与 list 对得上。
	total, err := s.posts.Count(ctx, f)
	if err != nil {
		return nil, 0, apperr.Wrap(apperr.CodeInternal, err)
	}

	rows, err := s.posts.ListByUser(ctx, userID, f.Status, limit, offset)
	if err != nil {
		return nil, 0, apperr.Wrap(apperr.CodeInternal, err)
	}

	return toPostDTOs(rows, view), total, nil
}

// ChangeStatus 由**作者本人**手动流转帖子状态（PATCH /api/posts/:id/status）。
//
// 校验顺序刻意如此，每一步对应一个明确的错误码：
//  1. to 是否在状态枚举内        → 1001
//  2. 帖子是否存在               → 1004
//  3. 请求者是否为作者           → 1003
//  4. 白名单是否允许该跳转       → 1007
//  5. 乐观锁 UPDATE 是否命中     → 1007
//
// 第 3 步排在第 4 步之前：越权者应当稳定地拿到 403，而不是因为
// 「恰好当前状态也不允许」而拿到 1007 —— 后者等于把帖子当前的状态
// 泄露给了无权操作它的人。
func (s *PostService) ChangeStatus(ctx context.Context, postID, userID int64, to string) (*model.PostDTO, error) {
	if !valid.Contains(valid.ValidStatuses, to) {
		return nil, apperr.Newf(apperr.CodeInvalidParam, "status 必须是 open、matched 或 closed")
	}

	// viewerID 传 0：本流程只关心作者与状态，不需要带出联系方式。
	existing, err := s.posts.GetByID(ctx, postID, 0)
	if err != nil {
		return nil, err
	}
	if existing.UserID != userID {
		return nil, apperr.New(apperr.CodeForbidden)
	}
	if err := s.applyStatusChange(ctx, existing, to); err != nil {
		return nil, err
	}

	// 重新查库再组装 DTO，保证响应里的 status / updated_at 是落库后的真实值，
	// 而不是「我以为写进去了」的入参回显。
	return s.detailByID(ctx, postID, model.PostView{ViewerID: userID})
}

// changeStatusAsSystem 由**系统**触发状态流转（不做作者校验）。
//
// P6 的认领流程要用它：审核通过 → 帖子 open 自动变 matched；
// 核销 → 帖子自动变 closed。这类流转的发起者是业务规则而非某个人的点击，
// 所以不能走 ChangeStatus 的作者校验，但**必须复用 ValidateTransition**，
// 不允许在认领服务里再写一份状态规则。
//
// P3 阶段尚无调用方，按阶段文件 04 §7 的接口约定先落地，P6 直接接入。
func (s *PostService) changeStatusAsSystem(ctx context.Context, postID int64, to string) error {
	existing, err := s.posts.GetByID(ctx, postID, 0)
	if err != nil {
		return err
	}
	return s.applyStatusChange(ctx, existing, to)
}

// applyStatusChange 是「作者手动流转」与「系统自动流转」共用的核心：
// 白名单校验 + 乐观锁更新。两条路径共用它，状态规则就只可能有一份。
func (s *PostService) applyStatusChange(ctx context.Context, p *model.Post, to string) error {
	if err := ValidateTransition(p.Status, to); err != nil {
		return err
	}

	// 时间取 Go 侧的 UTC，而不是 SQL 里的 NOW()：MySQL 的 NOW() 返回会话
	// 时区（本机默认 SYSTEM，即 +08:00）下的本地时间，写进 DATETIME 列后
	// 会被 Go 按 DSN 里的 loc=UTC 解析，凭空差出 8 小时。
	// 截断到秒与列精度（DATETIME 无小数位）对齐，避免数据库四舍五入
	// 出一个比当前时间还晚的 updated_at。
	now := time.Now().UTC().Truncate(time.Second)

	n, err := s.posts.UpdateStatus(ctx, p.ID, p.Status, to, now)
	if err != nil {
		return apperr.Wrap(apperr.CodeInternal, err)
	}
	if n == 0 {
		// 白名单已通过却一行都没更新到，唯一的解释是：帖子状态在
		// 「查出来」与「写回去」之间被另一个请求改掉了。
		// 这正是乐观锁要拦住的场景，对用户表现为「请刷新后重试」。
		return apperr.Newf(apperr.CodeInvalidStatus, "帖子状态已被其他操作修改，请刷新后重试")
	}
	return nil
}

// normalizeListFilter 归一化列表筛选条件。
//
// 两条规则（策略选择见 docs/api.md）：
//   - keyword 前后去空白，为空则视为未传；
//   - 枚举参数（type / status / category）取到非法值时**静默忽略该条件**，
//     不返回 1001。
//
// 为什么选「忽略」而不是「报错」：筛选条件与分页参数同源，都由前端按
// 用户点击拼 URL。既然 pageSize 越界走的是「夹取不报错」，枚举非法也应当
// 走同一条「容错优先」的路子，否则同一类问题会出现两套处理方式。
// 代价是 ?type=lostt 这种笔误会静默返回全部结果（看起来像筛选没生效），
// 因此已在 docs/api.md 里显式写明，不靠使用者猜。
func normalizeListFilter(f ListFilter) ListFilter {
	f.Type = strings.TrimSpace(f.Type)
	f.Status = strings.TrimSpace(f.Status)
	f.Category = strings.TrimSpace(f.Category)
	f.Keyword = strings.TrimSpace(f.Keyword)

	if f.Type != "" && !valid.Contains(valid.ValidTypes, f.Type) {
		f.Type = ""
	}
	if f.Status != "" && !valid.Contains(valid.ValidStatuses, f.Status) {
		f.Status = ""
	}
	if f.Category != "" && !valid.Contains(valid.ValidCategories, f.Category) {
		f.Category = ""
	}
	return f
}

// toPostDTOs 把实体切片按同一视角批量组装成 DTO。
//
// 取 &rows[i] 而不是 range 出来的副本：一是少一次整结构体拷贝，
// 二是避免「循环变量复用同一个地址」这类陷阱 —— 若误把循环变量的地址
// 存进切片，所有元素最终会指向同一份被覆盖的数据。
func toPostDTOs(rows []model.Post, view model.PostView) []*model.PostDTO {
	out := make([]*model.PostDTO, 0, len(rows))
	for i := range rows {
		out = append(out, model.ToPostDTO(&rows[i], view))
	}
	return out
}
