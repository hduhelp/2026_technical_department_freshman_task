package entity

import (
	"time"
)

// PostDailyQuota 对应 post_daily_quotas，联合主键日期采用北京时间语义。
type PostDailyQuota struct {
	UserID         uint64    `gorm:"column:user_id;primaryKey;autoIncrement:false" json:"-"`
	QuotaDate      time.Time `gorm:"column:quota_date;primaryKey;type:date" json:"-"`
	SubmittedCount uint8     `gorm:"column:submitted_count" json:"-"`
	UpdatedAt      time.Time `gorm:"column:updated_at;autoUpdateTime" json:"-"`
}
