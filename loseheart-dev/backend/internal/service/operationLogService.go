package service

import (
	"context"
	"strconv"
	"time"

	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"

	"gorm.io/gorm"
)

// ListOperationLogs 按时间和 ID 倒序查询只读操作记录，时间筛选采用 UTC 左闭右开区间。
func ListOperationLogs(
	ctx context.Context,
	input dto.OperationLogQueryDTO,
) (*vo.PageResultVO[vo.OperationLogVO], error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	query := db.Table("admin_operation_logs")
	if input.OperatorID != "" {
		query = query.Where("operator_id = ?", input.OperatorID)
	}
	if input.Action != "" {
		query = query.Where("action = ?", input.Action)
	}
	if input.TargetPostID != "" {
		query = query.Where("target_post_id = ?", input.TargetPostID)
	}
	if input.TargetUserID != "" {
		query = query.Where("target_user_id = ?", input.TargetUserID)
	}

	var from, to time.Time
	if input.CreatedFrom != "" {
		from, err = time.Parse(time.RFC3339, input.CreatedFrom)
		if err != nil {
			return nil, errs.ValidationError
		}

		query = query.Where("created_at >= ?", from.UTC())
	}
	if input.CreatedTo != "" {
		to, err = time.Parse(time.RFC3339, input.CreatedTo)
		if err != nil || !from.IsZero() && to.Before(from) {
			return nil, errs.ValidationError
		}

		query = query.Where("created_at < ?", to.UTC())
	}

	page, pageSize := PageValues(input.PageQueryDTO)
	result := &vo.PageResultVO[vo.OperationLogVO]{
		Page:     page,
		PageSize: pageSize,
		Records:  make([]vo.OperationLogVO, 0),
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return nil, moderationDatabaseError(err)
	}

	var records []entity.AdminOperationLog
	if err := query.Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&records).Error; err != nil {
		return nil, moderationDatabaseError(err)
	}

	for _, record := range records {
		item, err := operationLogVO(db, record)
		if err != nil {
			return nil, err
		}

		result.Records = append(result.Records, item)
	}

	return result, nil
}

// GetOperationLog 查询单条操作记录，返回操作者摘要和状态白名单，不开放修改或删除。
func GetOperationLog(ctx context.Context, logID uint64) (*vo.OperationLogVO, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	var record entity.AdminOperationLog
	if err := db.Table("admin_operation_logs").
		Where("id = ?", logID).
		Take(&record).Error; err != nil {
		return nil, moderationRecordError(err)
	}

	result, err := operationLogVO(db, record)
	return &result, err
}

func operationLogVO(db *gorm.DB, record entity.AdminOperationLog) (vo.OperationLogVO, error) {
	operator, err := UserSummary(db, record.OperatorID)
	if err != nil {
		return vo.OperationLogVO{}, err
	}

	return vo.OperationLogVO{
		ID:             strconv.FormatUint(record.ID, 10),
		Operator:       operator,
		Action:         record.Action,
		TargetUserID:   operationTargetID(record.TargetUserID),
		TargetPostID:   operationTargetID(record.TargetPostID),
		TargetReportID: operationTargetID(record.TargetReportID),
		Reason:         &record.Reason,
		StateBefore:    record.StateBefore,
		StateAfter:     record.StateAfter,
		CreatedAt:      record.CreatedAt,
	}, nil
}

func operationTargetID(id *uint64) *string {
	if id == nil {
		return nil
	}

	value := strconv.FormatUint(*id, 10)
	return &value
}
