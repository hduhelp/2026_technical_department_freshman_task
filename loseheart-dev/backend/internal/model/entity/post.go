package entity

import (
	"lost-found/backend/internal/model"
	"time"
)

// Post 对应 posts；查询显式 Table("posts")，TIME 存储为 HH:mm:ss，JSON 数组不可为 nil。
type Post struct {
	ID                  uint64                `gorm:"column:id;primaryKey;autoIncrement" json:"-"`
	AuthorID            uint64                `gorm:"column:author_id" json:"-"`
	PostType            string                `gorm:"column:post_type" json:"-"`
	ItemName            string                `gorm:"column:item_name" json:"-"`
	Campus              string                `gorm:"column:campus" json:"-"`
	Location            string                `gorm:"column:location" json:"-"`
	EventDate           time.Time             `gorm:"column:event_date;type:date" json:"-"`
	TimePrecision       string                `gorm:"column:time_precision;default:date" json:"-"`
	EventTimeStart      *string               `gorm:"column:event_time_start;type:time" json:"-"`
	EventTimeEnd        *string               `gorm:"column:event_time_end;type:time" json:"-"`
	Description         string                `gorm:"column:description" json:"-"`
	Images              []string              `gorm:"column:images;serializer:json;type:json" json:"-"`
	ContactMethods      []model.ContactMethod `gorm:"column:contact_methods;serializer:json;type:json" json:"-"`
	ReviewStatus        string                `gorm:"column:review_status;default:pending" json:"-"`
	ResolutionStatus    string                `gorm:"column:resolution_status;default:active" json:"-"`
	Revision            uint32                `gorm:"column:revision;default:1" json:"-"`
	StateVersion        uint32                `gorm:"column:state_version;default:1" json:"-"`
	ReviewReason        *string               `gorm:"column:review_reason" json:"-"`
	ReviewedBy          *uint64               `gorm:"column:reviewed_by" json:"-"`
	ReviewedAt          *time.Time            `gorm:"column:reviewed_at" json:"-"`
	SubmittedAt         time.Time             `gorm:"column:submitted_at;autoCreateTime" json:"-"`
	FirstPublishedAt    *time.Time            `gorm:"column:first_published_at" json:"-"`
	CompletedAt         *time.Time            `gorm:"column:completed_at" json:"-"`
	WithdrawnAt         *time.Time            `gorm:"column:withdrawn_at" json:"-"`
	CreationKey         string                `gorm:"column:creation_key" json:"-"`
	CreationPayloadHash []byte                `gorm:"column:creation_payload_hash;type:binary(32)" json:"-"`
	CreatedAt           time.Time             `gorm:"column:created_at;autoCreateTime" json:"-"`
	UpdatedAt           time.Time             `gorm:"column:updated_at;autoUpdateTime" json:"-"`
}
