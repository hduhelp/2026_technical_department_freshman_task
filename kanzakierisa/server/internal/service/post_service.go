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
	existing, err := s.posts.GetByID(ctx, postID)
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
	existing, err := s.posts.GetByID(ctx, postID)
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
func (s *PostService) detailByID(ctx context.Context, postID int64, view model.PostView) (*model.PostDTO, error) {
	p, err := s.posts.GetByID(ctx, postID)
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
