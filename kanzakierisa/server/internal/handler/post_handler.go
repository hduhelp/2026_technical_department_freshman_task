package handler

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"hdu-lostfound/internal/middleware"
	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/response"
	"hdu-lostfound/internal/service"
)

// PostHandler 处理帖子的 HTTP 编解码。
//
// 分层铁律：本层只做「取参数 → 调 service → 写响应」，
// 不含任何 SQL，也不含业务规则判断（如「closed 不可编辑」属 service）。
type PostHandler struct {
	posts *service.PostService
}

// NewPostHandler 创建帖子 handler。
func NewPostHandler(posts *service.PostService) *PostHandler {
	return &PostHandler{posts: posts}
}

// Create 处理 POST /api/posts。
//
// 鉴权：强制。作者固定取当前登录用户，**不接受请求体里的 user_id**
// —— CreatePostReq 里没有这个字段，带了也会被丢弃。
func (h *PostHandler) Create(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	var req model.CreatePostReq
	if err := c.ShouldBindJSON(&req); err != nil {
		// binding 失败（缺必填字段、JSON 结构错）统一归 1001。
		response.Fail(c, apperr.Newf(apperr.CodeInvalidParam, "请求参数不合法"))
		return
	}

	dto, err := h.posts.Create(c.Request.Context(), u.ID, req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, dto)
}

// Detail 处理 GET /api/posts/:id。
//
// 鉴权：**软鉴权**。游客也能看，但联系方式按 SPEC 7.2 的三级规则裁剪；
// 登录用户还能拿到本人视角的 can_edit / can_claim。
func (h *PostHandler) Detail(c *gin.Context) {
	postID, ok := parseIDParam(c, "id")
	if !ok {
		return
	}

	view := viewOf(c, false)

	dto, err := h.posts.Detail(c.Request.Context(), postID, view)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, dto)
}

// Update 处理 PUT /api/posts/:id。
//
// 鉴权：强制。非作者由 service 返回 1003。
func (h *PostHandler) Update(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	postID, ok := parseIDParam(c, "id")
	if !ok {
		return
	}

	var req model.UpdatePostReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidParam, "请求参数不合法"))
		return
	}

	dto, err := h.posts.Update(c.Request.Context(), postID, u.ID, req)
	if err != nil {
		response.Fail(c, err)
		return
	}
	response.OK(c, dto)
}

// Delete 处理 DELETE /api/posts/:id。
//
// 鉴权：强制。成功返回 data: null。
func (h *PostHandler) Delete(c *gin.Context) {
	u := middleware.CurrentUser(c)
	if u == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	postID, ok := parseIDParam(c, "id")
	if !ok {
		return
	}

	if err := h.posts.Delete(c.Request.Context(), postID, u.ID); err != nil {
		response.Fail(c, err)
		return
	}
	response.OKEmpty(c)
}

// parseIDParam 解析路径参数中的正整数 id。
//
// 集中收口的原因：P3/P6 还会新增若干带 :id 的路由，每个 handler
// 各写一段 strconv.ParseInt + 错误分支既啰嗦又容易漏掉「0 与负数」
// 这种能通过 ParseInt 却毫无意义的值。解析失败一律 1001。
func parseIDParam(c *gin.Context, name string) (int64, bool) {
	raw := strings.TrimSpace(c.Param(name))
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidParam, "路径参数 %s 不合法", name))
		return 0, false
	}
	return id, true
}

// viewOf 依据当前请求者构造查询视角。
//
// inList 由调用方指定：列表接口需要把 author.contact 一律留空。
//
// HasApprovedClaim 在 P2 阶段恒为 false —— 它依赖 claims 表的查询，
// 属于 P6 的职责。此处显式写明而不是隐去，是为了让后续接入时
// 能一眼看到「这里有个待补的口子」，而不是以为规则已经完整。
func viewOf(c *gin.Context, inList bool) model.PostView {
	view := model.PostView{InList: inList}
	if u := middleware.CurrentUser(c); u != nil {
		view.ViewerID = u.ID
		view.ViewerIsAdmin = u.Role == model.RoleAdmin
	}
	return view
}
