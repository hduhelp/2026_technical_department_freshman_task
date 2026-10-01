package handler

import (
	"github.com/gin-gonic/gin"

	"hdu-lostfound/internal/pkg/response"
	"hdu-lostfound/internal/service"
)

// MatchHandler 处理「可能匹配」的 HTTP 编解码。
type MatchHandler struct {
	matches *service.MatchService
}

// NewMatchHandler 创建匹配 handler。
func NewMatchHandler(matches *service.MatchService) *MatchHandler {
	return &MatchHandler{matches: matches}
}

// List 处理 GET /api/posts/:id/matches（鉴权：**软鉴权**）。
//
// 游客也能看：匹配结果里不含联系方式（由 service 以列表口径组装 DTO），
// 因此公开它不会带来任何泄露面，却能让「分享链接」这个场景完整可用
// （SPEC 用户故事 3：路人打开链接也能看到「这条可能是同一件东西」）。
//
// 响应形状照 07 第二部分 §3 的规定，只有 list、没有分页字段 ——
// 结果集上限恒为 5 条，分页参数没有意义。
func (h *MatchHandler) List(c *gin.Context) {
	postID, ok := parseIDParam(c, "id")
	if !ok {
		return
	}

	// 与帖子详情同一套视角构造：软鉴权下 CurrentUser 可能为 nil，
	// viewOf 会把它处理成 ViewerID = 0（游客）。
	view := viewOf(c, true)

	list, err := h.matches.FindMatches(c.Request.Context(), postID, view)
	if err != nil {
		response.Fail(c, err)
		return
	}

	// 显式包一层 list：SPEC 8.1 的 data 形状约定里，列表类接口的 data
	// 永远是一个对象而不是裸数组，这样将来要加字段（比如 total）也不必
	// 破坏形状。
	response.OK(c, gin.H{"list": list})
}
