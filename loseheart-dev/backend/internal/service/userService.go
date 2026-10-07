package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/common/utils"
	"lost-found/backend/global"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GetUserProfile 查询当前用户的个人信息。
func GetUserProfile(ctx context.Context, userID uint64) (*vo.UserProfileVO, error) {
	if userID == 0 {
		return nil, errs.AuthRequiredError
	}
	if global.Db == nil {
		return nil, errs.AuthDatabaseError
	}

	var user entity.User

	// 只查询响应需要的字段，避免读取密码哈希等敏感信息。
	err := global.Db.WithContext(ctx).
		Table("users").
		Select(
			"id",
			"account_no",
			"identity_type",
			"nickname",
			"avatar_url",
			"role",
			"is_verified",
			"must_change_password",
			"wechat_bound_at",
		).
		Where("id = ?", userID).
		Take(&user).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errs.AuthRequiredError
	}
	if err != nil {
		return nil, errs.AuthDatabaseError
	}

	// 将数据库实体转换为接口响应对象。
	profile := &vo.UserProfileVO{
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
	}
	return profile, nil
}

// ChangePassword 在用户行锁内校验原密码并更新登录版本，使所有旧令牌失效。
func ChangePassword(
	ctx context.Context,
	identity entity.AuthUser,
	input dto.ChangePasswordRequestDTO,
) error {
	if identity.ID == 0 {
		return errs.AuthRequiredError
	}
	if global.Db == nil {
		return errs.AuthDatabaseError
	}

	var businessErr error
	err := global.Db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 业务错误与事务/提交错误分开处理，数据库错误保留错误链。
		businessErr = changePasswordInTransaction(tx, identity, input)
		return businessErr
	})
	if err != nil && businessErr == nil {
		return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}
	return err
}

// changePasswordInTransaction 与登录共用 users 行锁，防止并发改密覆盖及旧身份继续改密。
func changePasswordInTransaction(
	tx *gorm.DB,
	identity entity.AuthUser,
	input dto.ChangePasswordRequestDTO,
) error {
	var user entity.User
	err := tx.Table("users").
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Select(
			"id",
			"password_hash",
			"token_version",
			"status",
			"is_verified",
		).
		Where("id = ?", identity.ID).
		Take(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errs.AuthRequiredError
	}
	if err != nil {
		return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}

	if user.TokenVersion != identity.TokenVersion {
		return errs.TokenRevokedError
	}
	if user.Status != "active" {
		return errs.AccountDisabledError
	}
	if !user.IsVerified {
		return errs.IdentityUnverifiedError
	}

	matches, err := utils.VerifyPassword(input.CurrentPassword, user.PasswordHash)
	if err != nil {
		return err
	}
	if !matches {
		return errs.InvalidCredentialsError
	}
	if input.CurrentPassword == input.NewPassword {
		return errs.PasswordUnchangedError
	}

	hash, err := utils.HashPassword(input.NewPassword)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	err = tx.Table("users").
		Where("id = ?", user.ID).
		Updates(map[string]any{
			"password_hash":        hash,
			"password_changed_at":  now,
			"must_change_password": false,
			"token_version":        gorm.Expr("token_version + 1"),
			"updated_at":           now,
		}).Error
	if err != nil {
		return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}
	return nil
}
