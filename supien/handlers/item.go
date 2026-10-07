package handlers

import (
	"errors"
	"strconv"

	"campus-lost-found/models"
	"campus-lost-found/store"
	"campus-lost-found/utils"

	"github.com/gin-gonic/gin"
)

// createItemRequest 发布信息的请求参数
type createItemRequest struct {
	Type        string `json:"type" binding:"required,oneof=lost found"` // lost=寻物 found=招领
	Title       string `json:"title" binding:"required,min=1,max=50"`
	Description string `json:"description" binding:"required"`
	Location    string `json:"location"` // 选填
	Contact     string `json:"contact"`  // 选填，不填则默认使用注册时的手机号
}

// CreateItem 发布一条失物 / 招领信息
// POST /api/items （需要登录）
func (h *Handler) CreateItem(c *gin.Context) {
	var req createItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Error(c, 400, "参数错误：type 只能是 lost 或 found，标题和描述不能为空")
		return
	}

	userID := c.GetInt64("userID")
	contact := req.Contact
	if contact == "" {
		// 没填联系方式时，默认使用用户注册时填写的手机号
		if u, ok := h.store.GetUserByID(userID); ok {
			contact = u.Phone
		}
	}

	item := &models.Item{
		UserID:      userID,
		Type:        models.ItemType(req.Type),
		Title:       req.Title,
		Description: req.Description,
		Location:    req.Location,
		Contact:     contact,
		Status:      models.StatusSearching, // 新发布的信息默认“寻找中”
	}
	item = h.store.CreateItem(item)

	publisher, _ := h.store.GetUserByID(userID)
	utils.Success(c, itemVO(item, publisher, true))
}

// ListItems 查看 / 搜索信息列表
// GET /api/items?keyword=耳机&type=lost&status=searching&page=1&page_size=10 （需要登录）
func (h *Handler) ListItems(c *gin.Context) {
	keyword := c.Query("keyword")
	itemType := c.Query("type")
	status := c.Query("status")

	// 分页参数，默认第 1 页、每页 10 条
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 50 {
		pageSize = 10
	}

	items := h.store.ListItems(keyword, itemType, status)
	total := len(items)

	// 计算当前页的数据范围
	start := (page - 1) * pageSize
	end := start + pageSize
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}

	currentUserID := c.GetInt64("userID")
	list := make([]gin.H, 0, end-start)
	for _, it := range items[start:end] {
		publisher, _ := h.store.GetUserByID(it.UserID)
		list = append(list, itemVO(it, publisher, it.UserID == currentUserID))
	}

	utils.Success(c, gin.H{
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"list":      list,
	})
}

// GetItem 查看某条信息的详情
// GET /api/items/:id （需要登录）
func (h *Handler) GetItem(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.Error(c, 400, "信息编号不正确")
		return
	}

	item, ok := h.store.GetItem(id)
	if !ok {
		utils.Error(c, 404, "信息不存在")
		return
	}

	publisher, _ := h.store.GetUserByID(item.UserID)
	currentUserID := c.GetInt64("userID")
	utils.Success(c, itemVO(item, publisher, item.UserID == currentUserID))
}

// updateItemRequest 修改信息的请求参数，指针类型 + omitempty 表示字段可以不传
type updateItemRequest struct {
	Type        *string `json:"type" binding:"omitempty,oneof=lost found"`
	Title       *string `json:"title" binding:"omitempty,max=50"`
	Description *string `json:"description"`
	Location    *string `json:"location"`
	Contact     *string `json:"contact"`
}

// UpdateItem 修改自己发布的信息
// PUT /api/items/:id （需要登录）
func (h *Handler) UpdateItem(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.Error(c, 400, "信息编号不正确")
		return
	}

	var req updateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Error(c, 400, "参数错误：type 只能是 lost 或 found")
		return
	}

	upd := store.ItemUpdate{
		Title:       req.Title,
		Description: req.Description,
		Location:    req.Location,
		Contact:     req.Contact,
	}
	if req.Type != nil {
		t := models.ItemType(*req.Type)
		upd.Type = &t
	}

	item, err := h.store.UpdateItem(id, c.GetInt64("userID"), upd)
	if err != nil {
		handleItemError(c, err)
		return
	}

	publisher, _ := h.store.GetUserByID(item.UserID)
	utils.Success(c, itemVO(item, publisher, true))
}

// statusRequest 修改状态的请求参数
type statusRequest struct {
	Status string `json:"status" binding:"required,oneof=searching found closed"`
}

// UpdateItemStatus 修改信息状态（例如找到后标记为“已找到”）
// PATCH /api/items/:id/status （需要登录）
func (h *Handler) UpdateItemStatus(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.Error(c, 400, "信息编号不正确")
		return
	}

	var req statusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.Error(c, 400, "状态只能是 searching（寻找中）、found（已找到）、closed（已结束）")
		return
	}

	newStatus := models.ItemStatus(req.Status)
	item, err := h.store.UpdateItem(id, c.GetInt64("userID"), store.ItemUpdate{Status: &newStatus})
	if err != nil {
		handleItemError(c, err)
		return
	}

	publisher, _ := h.store.GetUserByID(item.UserID)
	utils.Success(c, itemVO(item, publisher, true))
}

// DeleteItem 删除自己发布的信息
// DELETE /api/items/:id （需要登录）
func (h *Handler) DeleteItem(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.Error(c, 400, "信息编号不正确")
		return
	}

	if err := h.store.DeleteItem(id, c.GetInt64("userID")); err != nil {
		handleItemError(c, err)
		return
	}

	utils.Success(c, gin.H{"message": "删除成功"})
}

// handleItemError 统一处理信息操作时的错误
func handleItemError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		utils.Error(c, 404, "信息不存在")
	case errors.Is(err, store.ErrForbidden):
		utils.Error(c, 403, "只能操作自己发布的信息")
	default:
		utils.Error(c, 500, "服务器内部错误")
	}
}
