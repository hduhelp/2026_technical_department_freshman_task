package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ListNotifications 只查询当前收件人的通知；读取列表不会自动标为已读。
func ListNotifications(
	ctx context.Context,
	userID uint64,
	input dto.NotificationQueryDTO,
) (*vo.PageResultVO[vo.NotificationVO], error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	page, size := PageValues(input.PageQueryDTO)
	query := db.Table("notifications").
		Where("user_id = ?", userID)
	if input.Read == "true" {
		query = query.Where("read_at IS NOT NULL")
	} else if input.Read == "false" {
		query = query.Where("read_at IS NULL")
	}

	output := &vo.PageResultVO[vo.NotificationVO]{
		Page:     page,
		PageSize: size,
		Records:  make([]vo.NotificationVO, 0),
	}
	if err := query.Count(&output.Total).Error; err != nil {
		return nil, fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}

	var notifications []entity.Notification
	if err := query.Order("created_at DESC, id DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&notifications).Error; err != nil {
		return nil, fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}

	for _, notification := range notifications {
		output.Records = append(output.Records, vo.NotificationVO{
			ID:        strconv.FormatUint(notification.ID, 10),
			Type:      notification.Type,
			Title:     notification.Title,
			Content:   notification.Content,
			PostID:    notificationResourceID(notification.PostID),
			ReviewID:  notificationResourceID(notification.ReviewID),
			ReportID:  notificationResourceID(notification.ReportID),
			ReadAt:    notification.ReadAt,
			CreatedAt: notification.CreatedAt,
		})
	}
	return output, nil
}

// GetUnreadNotificationCount 统计当前收件人的 read_at 为 NULL 的记录。
func GetUnreadNotificationCount(
	ctx context.Context,
	userID uint64,
) (*vo.UnreadCountResponseVO, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	var count int64
	if err := db.Table("notifications").
		Where("user_id = ? AND read_at IS NULL", userID).
		Count(&count).Error; err != nil {
		return nil, fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}
	return &vo.UnreadCountResponseVO{
		Count: uint64(count),
	}, nil
}

// MarkNotificationRead 在行锁内首次写入已读时间；重复调用返回原值，无权访问返回 404。
func MarkNotificationRead(
	ctx context.Context,
	actor entity.AuthUser,
	id uint64,
) (*vo.NotificationReadStateResponseVO, error) {
	var readAt time.Time
	err := WriteTransaction(ctx, actor, false, func(tx *gorm.DB) error {
		var notification entity.Notification
		err := tx.Table("notifications").
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_id = ?", id, actor.ID).
			Take(&notification).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errs.ResourceNotFoundError
		}
		if err != nil {
			return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
		}

		if notification.ReadAt != nil {
			readAt = *notification.ReadAt
			return nil
		}

		// MySQL 列精度为毫秒，响应按同样精度返回，避免重试响应出现时间差。
		readAt = time.Now().UTC().Truncate(time.Millisecond)
		if err := tx.Table("notifications").
			Where("id = ?", id).
			Update("read_at", readAt).Error; err != nil {
			return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &vo.NotificationReadStateResponseVO{
		ID:     strconv.FormatUint(id, 10),
		ReadAt: readAt,
	}, nil
}

// notificationResourceID 保留无关联资源时的 JSON null，避免把空值转成字符串 "0"。
func notificationResourceID(id *uint64) *string {
	if id == nil {
		return nil
	}
	value := strconv.FormatUint(*id, 10)
	return &value
}
