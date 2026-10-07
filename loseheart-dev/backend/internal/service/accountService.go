package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/common/utils"
	"lost-found/backend/global"
	"lost-found/backend/internal/config"
	"lost-found/backend/internal/model"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"

	"github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// BindWechat 将一次性微信 code 换成身份；首次绑定不撤销 JWT，换绑成功撤销全部旧 JWT。
// 返回重试秒数供控制器写 Retry-After，账号密码失败计数沿用登录 Redis 规则。
func BindWechat(
	ctx context.Context,
	actor entity.AuthUser,
	input dto.WechatBindingDTO,
) (*vo.WechatBindingResponseVO, int, error) {
	openID, err := exchangeWechatCode(ctx, input.Code)
	if err != nil {
		return nil, 0, err
	}

	var output vo.WechatBindingResponseVO
	var retry int

	err = WriteTransaction(ctx, actor, false, func(tx *gorm.DB) error {
		// WriteTransaction 已锁住操作者，此处读取绑定与密码字段仍处于同一个事务。
		var user entity.User
		if err := tx.Table("users").
			Where("id = ?", actor.ID).
			Take(&user).Error; err != nil {
			return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
		}

		appID := config.ServerConfig.WeChat.Appid
		if user.WechatAppID != nil &&
			user.WechatOpenID != nil &&
			*user.WechatAppID == appID &&
			*user.WechatOpenID == openID {
			// 同一微信身份为无变化操作，保留最初绑定时间与登录版本。
			output = vo.WechatBindingResponseVO{
				Bound:   true,
				BoundAt: *user.WechatBoundAt,
			}
			return nil
		}

		rebinding := user.WechatBoundAt != nil
		if rebinding {
			if input.CurrentPassword == nil {
				return errs.InvalidRequestError
			}

			var err error
			retry, err = passwordPause(ctx, user.AccountNo)
			if err != nil {
				return err
			}

			matches, err := utils.VerifyPassword(*input.CurrentPassword, user.PasswordHash)
			if err != nil {
				return err
			}
			if !matches {
				retry, err = passwordFailure(ctx, user.AccountNo)
				return err
			}

			if err := global.RedisClient.Del(ctx, loginKey("fail", user.AccountNo)).Err(); err != nil {
				return errs.AuthLimiterUnavailableError
			}
		}

		now := time.Now().UTC().Truncate(time.Millisecond)
		changes := map[string]any{
			"wechat_appid":    appID,
			"wechat_openid":   openID,
			"wechat_bound_at": now,
			"updated_at":      now,
		}
		if rebinding {
			changes["token_version"] = gorm.Expr("token_version + 1")
		}

		err := tx.Table("users").
			Where("id = ?", user.ID).
			Updates(changes).Error
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
			// 数据库唯一约束同时防止两个平台账号并发绑定同一微信身份。
			return errs.WechatAlreadyBoundError
		}
		if err != nil {
			return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
		}

		output = vo.WechatBindingResponseVO{
			Bound:          true,
			BoundAt:        now,
			ReauthRequired: rebinding,
		}
		return nil
	})
	if err != nil {
		return nil, retry, err
	}
	return &output, 0, nil
}

// ListAdminUsers 按明确的筛选条件分页；响应字段白名单排除凭证、OpenID 和登录版本。
func ListAdminUsers(
	ctx context.Context,
	input dto.AdminUserQueryDTO,
) (*vo.PageResultVO[vo.AdminUserVO], error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	page, size := PageValues(input.PageQueryDTO)
	query := db.Table("users")
	if input.AccountNo != "" {
		query = query.Where("account_no = ?", input.AccountNo)
	}
	if input.Nickname != "" {
		// LOCATE 保持“包含匹配”语义，用户输入的 % 与 _ 不作为通配符。
		query = query.Where("LOCATE(?, nickname) > 0", input.Nickname)
	}
	if input.Status != "" {
		query = query.Where("status = ?", input.Status)
	}
	if input.IdentityType != "" {
		query = query.Where("identity_type = ?", input.IdentityType)
	}

	output := &vo.PageResultVO[vo.AdminUserVO]{
		Page:     page,
		PageSize: size,
		Records:  make([]vo.AdminUserVO, 0),
	}
	if err := query.Count(&output.Total).Error; err != nil {
		return nil, fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}

	var users []entity.User
	if err := query.Select(adminUserColumns()).
		Order("created_at DESC, id DESC").
		Offset((page - 1) * size).
		Limit(size).
		Find(&users).Error; err != nil {
		return nil, fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}

	for _, user := range users {
		output.Records = append(output.Records, adminUserVO(user))
	}
	return output, nil
}

// GetAdminUser 读取指定用户的可管理资料；不存在的资源返回统一 404。
func GetAdminUser(ctx context.Context, id uint64) (*vo.AdminUserVO, error) {
	db, err := Database(ctx)
	if err != nil {
		return nil, err
	}

	var user entity.User
	err = db.Table("users").
		Select(adminUserColumns()).
		Where("id = ?", id).
		Take(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.ResourceNotFoundError
	}
	if err != nil {
		return nil, fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}

	output := adminUserVO(user)
	return &output, nil
}

// DisableUser 仅允许管理员禁用普通用户；状态、登录版本、通知与日志一起提交。
func DisableUser(
	ctx context.Context,
	actor entity.AuthUser,
	id uint64,
	input dto.UserStatusDTO,
) (*vo.UserStatusResponseVO, error) {
	// 所有用户按 ID 升序锁定，避免不同管理员交叉处置时出现 actor→target 的锁环。
	err := WriteTransactionWithUsers(ctx, actor, true, []uint64{id}, func(tx *gorm.DB) error {
		user, err := lockManagedUser(tx, id)
		if err != nil {
			return err
		}
		if user.Status == "disabled" {
			// 重复禁用成功返回，不重复撤销 JWT、写通知或记日志。
			return nil
		}

		now := time.Now().UTC()
		err = tx.Table("users").
			Where("id = ?", id).
			Updates(map[string]any{
				"status":        "disabled",
				"token_version": gorm.Expr("token_version + 1"),
				"updated_at":    now,
			}).Error
		if err != nil {
			return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
		}

		beforeStatus := user.Status
		afterStatus := "disabled"
		beforeVersion := user.TokenVersion
		afterVersion := user.TokenVersion + 1

		log := entity.AdminOperationLog{
			OperatorID:   actor.ID,
			Action:       "disable_user",
			TargetUserID: &id,
			Reason:       input.Reason,
			StateBefore: model.OperationState{
				Status:       &beforeStatus,
				TokenVersion: &beforeVersion,
			},
			StateAfter: model.OperationState{
				Status:       &afterStatus,
				TokenVersion: &afterVersion,
			},
		}
		if err := AddOperationLog(tx, &log); err != nil {
			return err
		}

		notification := entity.Notification{
			UserID:  id,
			Type:    "account_status",
			Title:   constant.NotificationAccountTitle,
			Content: input.Reason,
		}
		return AddNotification(tx, &notification)
	})
	if err != nil {
		return nil, err
	}
	return &vo.UserStatusResponseVO{
		ID:     strconv.FormatUint(id, 10),
		Status: "disabled",
	}, nil
}

// ResetUserPassword 生成本次响应专用临时密码；仅哈希落库，通知和日志只写安全状态。
func ResetUserPassword(
	ctx context.Context,
	actor entity.AuthUser,
	id uint64,
	input dto.PasswordResetDTO,
) (*vo.PasswordResetResponseVO, error) {
	// 18 个随机字节转为 24 个 ASCII 字符，满足统一的 8–32 字符限制。
	secret := make([]byte, 18)
	if _, err := rand.Read(secret); err != nil {
		return nil, errs.InternalError
	}

	password := base64.RawURLEncoding.EncodeToString(secret)
	hash, err := utils.HashPassword(password)
	if err != nil {
		return nil, err
	}

	var logID uint64

	// 操作者与目标账号先按统一顺序取得锁，再写密码、通知和日志。
	err = WriteTransactionWithUsers(ctx, actor, true, []uint64{id}, func(tx *gorm.DB) error {
		user, err := lockManagedUser(tx, id)
		if err != nil {
			return err
		}

		now := time.Now().UTC()
		if err := tx.Table("users").
			Where("id = ?", id).
			Updates(map[string]any{
				"password_hash":        hash,
				"password_changed_at":  now,
				"must_change_password": true,
				"token_version":        gorm.Expr("token_version + 1"),
				"updated_at":           now,
			}).Error; err != nil {
			return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
		}

		beforeForced := user.MustChangePassword
		afterForced := true
		beforeVersion := user.TokenVersion
		afterVersion := user.TokenVersion + 1

		log := entity.AdminOperationLog{
			OperatorID:   actor.ID,
			Action:       "reset_password",
			TargetUserID: &id,
			Reason:       input.Reason,
			StateBefore: model.OperationState{
				MustChangePassword: &beforeForced,
				TokenVersion:       &beforeVersion,
			},
			StateAfter: model.OperationState{
				MustChangePassword: &afterForced,
				TokenVersion:       &afterVersion,
			},
		}
		if err := AddOperationLog(tx, &log); err != nil {
			return err
		}

		logID = log.ID
		notification := entity.Notification{
			UserID:  id,
			Type:    "password_reset",
			Title:   constant.NotificationPasswordResetTitle,
			Content: constant.NotificationPasswordResetContent,
		}
		return AddNotification(tx, &notification)
	})
	if err != nil {
		return nil, err
	}
	return &vo.PasswordResetResponseVO{
		UserID:             strconv.FormatUint(id, 10),
		MustChangePassword: true,
		TemporaryPassword:  password,
		OperationLogID:     strconv.FormatUint(logID, 10),
	}, nil
}

// lockManagedUser 在事务中锁定处置对象，并阻止禁用或重置任何管理员账号。
func lockManagedUser(tx *gorm.DB, id uint64) (*entity.User, error) {
	var user entity.User
	err := tx.Table("users").
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "role", "status", "token_version", "must_change_password").
		Where("id = ?", id).
		Take(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.ResourceNotFoundError
	}
	if err != nil {
		return nil, fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}
	if user.Role != "user" {
		return nil, errs.ForbiddenError
	}
	return &user, nil
}

func adminUserColumns() []string {
	return strings.Fields(
		"id account_no identity_type nickname avatar_url role is_verified must_change_password wechat_bound_at status created_at",
	)
}

// adminUserVO 只转换管理员接口允许公开的资料；不输出数据库实体的敏感字段。
func adminUserVO(user entity.User) vo.AdminUserVO {
	return vo.AdminUserVO{
		UserProfileVO: vo.UserProfileVO{
			ID:                 strconv.FormatUint(user.ID, 10),
			AccountNo:          user.AccountNo,
			IdentityType:       user.IdentityType,
			Nickname:           user.Nickname,
			AvatarURL:          user.AvatarURL,
			Role:               user.Role,
			IsVerified:         user.IsVerified,
			MustChangePassword: user.MustChangePassword,
			WechatBound:        user.WechatBoundAt != nil,
			WechatBoundAt:      user.WechatBoundAt,
		},
		Status:    user.Status,
		CreatedAt: user.CreatedAt,
	}
}
