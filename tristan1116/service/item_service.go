package service

import (
	"errors"

	"lostfound/dao"
	"lostfound/models"
	"lostfound/utils"
)

// statusOrder 状态顺序表：数字越大越靠后，用来判断"是不是在前进"
// 把状态机的规则集中在这一张表里，改规则只改这里
var statusOrder = map[models.ItemStatus]int{
	models.StatusSearching: 0,
	models.StatusResolved:  1,
	models.StatusClosed:    2,
}

// CreateItem 发布：解析时间 → 组装 → 入库
func CreateItem(userID uint, req models.CreateItemRequest) (*models.Item, error) {
	happenedAt, err := utils.ParseTime(req.HappenedAt)
	if err != nil {
		return nil, ErrBadTime
	}

	item := &models.Item{
		Type:        req.Type,
		Title:       req.Title,
		Category:    models.ItemCategory(req.Category),
		Campus:      req.Campus,
		Place:       req.Place,
		HappenedAt:  happenedAt,
		Description: req.Description,
		Contact:     req.Contact,
		Status:      models.StatusSearching, // 新帖一律从"寻找中"开始
		UserID:      userID,
	}
	if err := dao.CreateItem(item); err != nil {
		return nil, err
	}
	return item, nil
}

// GetItemDetail 详情：帖子 + 发布者昵称/学号（PRD 5.2 详情页要显示）
func GetItemDetail(id uint) (*models.ItemDetailResponse, error) {
	item, err := dao.GetItemByID(id)
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			return nil, ErrItemNotFound
		}
		return nil, err
	}

	// 再查一次发布者（只在详情接口查，列表接口不查 —— 避免"每行都查一次用户"的 N+1 问题）
	publisher, err := dao.GetUserByID(item.UserID)
	if err != nil {
		return nil, err
	}

	return &models.ItemDetailResponse{
		Item:               *item,
		PublisherNickname:  publisher.Nickname,
		PublisherStudentID: publisher.StudentID,
	}, nil
}

// GetContact 查看联系方式（登录由路由中间件把关，service 只管取数据）
func GetContact(itemID uint) (string, error) {
	item, err := dao.GetItemByID(itemID)
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			return "", ErrItemNotFound
		}
		return "", err
	}
	return item.Contact, nil
}

// ListItems 列表查询（条件筛选、分页都在 dao 里实现）
func ListItems(q models.ItemListQuery) ([]models.Item, int64, error) {
	return dao.ListItems(q)
}

// UpdateItem 编辑：先确认帖子存在、且是本人发的
func UpdateItem(userID, itemID uint, req models.UpdateItemRequest) (*models.Item, error) {
	item, err := dao.GetItemByID(itemID)
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			return nil, ErrItemNotFound
		}
		return nil, err
	}
	if item.UserID != userID {
		return nil, ErrNotOwner // 存在但不是你的 → 403（区别于"不存在"的 404）
	}

	// 只更新"传了的"字段（空字符串视为不修改）
	fields := map[string]any{}
	if req.Title != "" {
		fields["title"] = req.Title
	}
	if req.Category != "" {
		fields["category"] = req.Category
	}
	if req.Campus != "" {
		fields["campus"] = req.Campus
	}
	if req.Place != "" {
		fields["place"] = req.Place
	}
	if req.HappenedAt != "" {
		t, err := utils.ParseTime(req.HappenedAt)
		if err != nil {
			return nil, ErrBadTime
		}
		fields["happened_at"] = t
	}
	if req.Description != "" {
		fields["description"] = req.Description
	}
	if req.Contact != "" {
		fields["contact"] = req.Contact
	}

	if len(fields) > 0 {
		if err := dao.UpdateItemFields(itemID, fields); err != nil {
			return nil, err
		}
	}

	// 返回更新后的最新数据
	return dao.GetItemByID(itemID)
}

// UpdateStatus 改状态：仅本人 + 只能前进（寻找中 → 已找到 → 已结束）
// 注意：编辑接口（UpdateItem）故意不开放 status 字段，否则状态机形同虚设
func UpdateStatus(userID, itemID uint, newStatus models.ItemStatus) error {
	item, err := dao.GetItemByID(itemID)
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			return ErrItemNotFound
		}
		return err
	}
	if item.UserID != userID {
		return ErrNotOwner
	}

	// 只能前进：新状态的序号必须严格大于当前状态（相等=原地不动，小于=回退，都不允许）
	if statusOrder[newStatus] <= statusOrder[item.Status] {
		return ErrStatusBackward
	}

	return dao.UpdateItemFields(itemID, map[string]any{"status": newStatus})
}

// DeleteItem 删除：仅本人
func DeleteItem(userID, itemID uint) error {
	item, err := dao.GetItemByID(itemID)
	if err != nil {
		if errors.Is(err, dao.ErrNotFound) {
			return ErrItemNotFound
		}
		return err
	}
	if item.UserID != userID {
		return ErrNotOwner
	}
	return dao.DeleteItem(itemID)
}
