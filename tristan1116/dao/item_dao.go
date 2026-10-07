package dao

import (
	"lostfound/models"

	"gorm.io/gorm"
)

// CreateItem 新增帖子
func CreateItem(item *models.Item) error {
	return DB.Create(item).Error
}

// GetItemByID 按主键查询帖子
func GetItemByID(id uint) (*models.Item, error) {
	var item models.Item
	if err := DB.First(&item, id).Error; err != nil {
		return nil, translate(err)
	}
	return &item, nil
}

// ListItems 按条件分页查询，返回（当页数据, 总数, 错误）
func ListItems(q models.ItemListQuery) ([]models.Item, int64, error) {
	// build 是一个闭包（能"记住"外部变量的函数），每次调用都重新拼一遍查询条件。
	// 为什么要建两次？因为查总数和查数据是两条独立的 SQL，
	// 复用同一个 *gorm.DB 链条容易被前面的 Limit/Offset 污染
	// （初学者最经典的 bug：先 Limit 再 Count，total 永远等于 page_size）
	build := func() *gorm.DB {
		tx := DB.Model(&models.Item{})

		if q.Keyword != "" {
			// LIKE 模糊匹配：两端加 % 表示"包含"，物品名称或描述命中都算
			like := "%" + q.Keyword + "%"
			tx = tx.Where("title LIKE ? OR description LIKE ?", like, like)
		}
		if q.Type != "" {
			tx = tx.Where("type = ?", q.Type)
		}
		if q.Category != "" {
			tx = tx.Where("category = ?", q.Category)
		}
		if q.Campus != "" {
			tx = tx.Where("campus = ?", q.Campus)
		}
		if q.Place != "" {
			tx = tx.Where("place LIKE ?", "%"+q.Place+"%")
		}
		if q.Status != "" {
			tx = tx.Where("status = ?", q.Status)
		}
		if q.UserID != 0 {
			tx = tx.Where("user_id = ?", q.UserID)
		}
		return tx
	}

	// 1. 先数总数（前端靠它判断"还有没有下一页"）
	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 2. 再取当页数据：ORDER BY created_at DESC + LIMIT + OFFSET
	// ★ items 用 make(..., 0) 初始化而不是 var 声明：
	//   查不到数据时，前者序列化成 []，后者是 null —— 前端拿到 null 调 .map() 会直接崩
	items := make([]models.Item, 0)
	err := build().
		Order("created_at DESC").
		Limit(q.PageSize).
		Offset((q.Page - 1) * q.PageSize).
		Find(&items).Error
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// UpdateItemFields 按字段 map 更新帖子
// 用 map 而不是结构体：GORM 的 Updates 传结构体会**忽略零值字段**（空字符串、0），
// 传 map 才能把某个字段改成空
func UpdateItemFields(id uint, fields map[string]any) error {
	return DB.Model(&models.Item{}).Where("id = ?", id).Updates(fields).Error
}

// DeleteItem 删除帖子
func DeleteItem(id uint) error {
	return DB.Delete(&models.Item{}, id).Error
}
