package controller

import (
	"errors"
	"strconv"

	"lostfound/models"
	"lostfound/service"
	"lostfound/utils"

	"github.com/gin-gonic/gin"
)

// parseID 从 URL 里取出 :id 并转成 uint
// 必须校验：/api/items/abc 会落到 :id 路由上，不校验的话会把脏字符串传给数据库
func parseID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		utils.Fail(c, utils.CodeInvalidParam, "id 不合法")
		return 0, false
	}
	return uint(id), true
}

// parsePagination 解析分页参数，带默认值和上限保护（防止有人传 page_size=999999）
func parsePagination(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 10
	}
	return page, pageSize
}

// handleItemError 把 service 层的业务错误统一翻译成响应
// （集中在一处，避免每个接口都写一遍 if-else）
func handleItemError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrItemNotFound):
		utils.Fail(c, utils.CodeNotFound, err.Error())
	case errors.Is(err, service.ErrNotOwner):
		utils.Fail(c, utils.CodeForbidden, err.Error())
	case errors.Is(err, service.ErrStatusBackward):
		utils.Fail(c, utils.CodeStatusBackward, err.Error())
	case errors.Is(err, service.ErrBadTime):
		utils.Fail(c, utils.CodeInvalidParam, err.Error())
	default:
		utils.Fail(c, utils.CodeServerError, "服务器开小差了")
	}
}

// ListItems 处理 GET /api/items —— 公开列表（搜索 / 筛选 / 分页）
func ListItems(c *gin.Context) {
	page, pageSize := parsePagination(c)

	// 状态默认只看"寻找中"（PRD 4.3：首页默认展示寻找中的信息）
	// 传 status=all 或 status=（空）表示不限状态
	status := c.DefaultQuery("status", string(models.StatusSearching))
	if status == "all" {
		status = ""
	}

	items, total, err := service.ListItems(models.ItemListQuery{
		Keyword:  c.Query("keyword"),  // 关键词模糊搜索
		Type:     c.Query("type"),     // lost / found
		Category: c.Query("category"), // card / electronics / ...
		Campus:   c.Query("campus"),
		Place:    c.Query("place"),
		Status:   status,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		utils.Fail(c, utils.CodeServerError, "查询失败")
		return
	}

	// 返回 total 供前端判断"还有没有下一页"（上拉加载更多）
	utils.OK(c, gin.H{
		"list":      items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// MyItems 处理 GET /api/items/my —— 我的发布（含全部状态，需登录）
func MyItems(c *gin.Context) {
	page, pageSize := parsePagination(c)
	userID := c.GetUint("user_id")

	items, total, err := service.ListItems(models.ItemListQuery{
		UserID:   userID,
		Status:   "", // 我的发布：所有状态都列出来，方便管理
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		utils.Fail(c, utils.CodeServerError, "查询失败")
		return
	}

	utils.OK(c, gin.H{
		"list":      items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetItem 处理 GET /api/items/:id —— 详情（公开，但不含联系方式）
func GetItem(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}

	detail, err := service.GetItemDetail(id)
	if err != nil {
		handleItemError(c, err)
		return
	}
	utils.OK(c, detail)
}

// GetContact 处理 GET /api/items/:id/contact —— 查看联系方式（需登录）
func GetContact(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}

	contact, err := service.GetContact(id)
	if err != nil {
		handleItemError(c, err)
		return
	}
	utils.OK(c, gin.H{"contact": contact})
}

// CreateItem 处理 POST /api/items —— 发布（需登录）
func CreateItem(c *gin.Context) {
	var req models.CreateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Fail(c, utils.CodeInvalidParam, "参数错误："+err.Error())
		return
	}

	userID := c.GetUint("user_id")
	item, err := service.CreateItem(userID, req)
	if err != nil {
		handleItemError(c, err)
		return
	}
	utils.OKMsg(c, "发布成功", item)
}

// UpdateItem 处理 PUT /api/items/:id —— 编辑（仅本人）
func UpdateItem(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}

	var req models.UpdateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Fail(c, utils.CodeInvalidParam, "参数错误："+err.Error())
		return
	}

	userID := c.GetUint("user_id")
	item, err := service.UpdateItem(userID, id, req)
	if err != nil {
		handleItemError(c, err)
		return
	}
	utils.OKMsg(c, "修改成功", item)
}

// UpdateStatus 处理 PATCH /api/items/:id/status —— 改状态（仅本人，只能前进）
func UpdateStatus(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}

	var req models.UpdateStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Fail(c, utils.CodeInvalidParam, "参数错误："+err.Error())
		return
	}

	userID := c.GetUint("user_id")
	if err := service.UpdateStatus(userID, id, req.Status); err != nil {
		handleItemError(c, err)
		return
	}
	utils.OKMsg(c, "状态已更新", nil)
}

// DeleteItem 处理 DELETE /api/items/:id —— 删除（仅本人）
func DeleteItem(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}

	userID := c.GetUint("user_id")
	if err := service.DeleteItem(userID, id); err != nil {
		handleItemError(c, err)
		return
	}
	utils.OKMsg(c, "删除成功", nil)
}
