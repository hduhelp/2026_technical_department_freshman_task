package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/global"
	"lost-found/backend/internal/model"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"
)

// Database 取得本请求使用的数据库连接；连接尚未初始化时返回可识别的依赖错误。
func Database(ctx context.Context) (*gorm.DB, error) {
	if global.Db == nil {
		return nil, errs.AuthDatabaseError
	}
	return global.Db.WithContext(ctx), nil
}

// WriteTransaction 在用户行锁内重新验证操作者后执行业务写入。
// 这样在中间件验证之后发生的禁用、改密和令牌撤销也不能绕过业务权限。
func WriteTransaction(ctx context.Context, actor entity.AuthUser, admin bool, action func(*gorm.DB) error) error {
	return WriteTransactionWithUsers(ctx, actor, admin, nil, action)
}

// WriteTransactionWithUsers 按用户 ID 顺序锁定操作者和本次涉及的用户，再锁业务记录。
// 审核、举报处理和账号管理统一此顺序，防止通知外键与作者编辑形成循环等待。
// targetIDs 只用于锁顺序，权限与资源状态仍必须在 action 的事务内重新检查。
func WriteTransactionWithUsers(ctx context.Context, actor entity.AuthUser, admin bool, targetIDs []uint64, action func(*gorm.DB) error) error {
	db, err := Database(ctx)
	if err != nil {
		return err
	}
	var actionErr error
	err = db.Transaction(func(tx *gorm.DB) error {
		ids := append(append([]uint64{}, targetIDs...), actor.ID)
		slices.Sort(ids)
		for _, id := range slices.Compact(ids) {
			if id == 0 {
				continue
			}
			var user entity.AuthUser
			lockErr := tx.Table("users").Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").Where("id = ?", id).Take(&user).Error
			// 资源不存在交由业务层返回 404；操作者不存在由 CheckActor 返回 401。
			if lockErr != nil && !errors.Is(lockErr, gorm.ErrRecordNotFound) {
				actionErr = fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, lockErr)
				return actionErr
			}
		}
		actionErr = CheckActor(tx, actor, admin)
		if actionErr != nil {
			return actionErr
		}
		actionErr = action(tx)
		return actionErr
	})
	if err != nil && actionErr == nil {
		return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}
	return err
}

// CheckActor 用于业务写事务；锁定操作者行，禁止强制改密身份访问业务写接口。
func CheckActor(tx *gorm.DB, actor entity.AuthUser, admin bool) error {
	return checkActor(tx, actor, admin, false)
}

// CheckActorForRecovery 仅供退出、修改密码等恢复流程使用，允许强制改密用户退出。
func CheckActorForRecovery(tx *gorm.DB, actor entity.AuthUser) error {
	return checkActor(tx, actor, false, true)
}

func checkActor(tx *gorm.DB, actor entity.AuthUser, admin, recovery bool) error {
	if actor.ID == 0 {
		return errs.AuthRequiredError
	}
	var user entity.AuthUser
	err := tx.Table("users").Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "token_version", "role", "status", "is_verified", "must_change_password").Where("id = ?", actor.ID).Take(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errs.AuthRequiredError
	}
	if err != nil {
		return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}
	if user.TokenVersion != actor.TokenVersion {
		return errs.TokenRevokedError
	}
	if user.Status != "active" {
		return errs.AccountDisabledError
	}
	if !user.IsVerified {
		return errs.IdentityUnverifiedError
	}
	if admin && user.Role != "admin" {
		return errs.ForbiddenError
	}
	if !recovery && user.MustChangePassword {
		return errs.PasswordChangeRequiredError
	}
	return nil
}

// PageValues 返回已通过 DTO 校验的分页参数，缺失时采用 1/20。
func PageValues(input dto.PageQueryDTO) (int, int) {
	page, size := 1, 20
	if input.Page != nil {
		page = *input.Page
	}
	if input.PageSize != nil {
		size = *input.PageSize
	}
	return page, size
}

// PostETag 由持久化的状态版本生成强 ETag，内容编辑和状态修改都能检测并发变化。
func PostETag(post entity.Post) string {
	return fmt.Sprintf("\"post-%d-v%d\"", post.ID, post.StateVersion)
}

// PostState 返回帖子状态修改响应，数据库实体不会直接序列化到客户端。
func PostState(post entity.Post) vo.PostStateResponseVO {
	return vo.PostStateResponseVO{ID: strconv.FormatUint(post.ID, 10), ReviewStatus: post.ReviewStatus, ResolutionStatus: post.ResolutionStatus, Revision: post.Revision, StateVersion: post.StateVersion, ETag: PostETag(post)}
}

// PostSnapshot 复制提交内容并将 MySQL TIME 转换为契约要求的 HH:mm。
func PostSnapshot(post entity.Post) model.PostContent {
	compact := func(value *string) *string {
		if value == nil {
			return nil
		}
		v := *value
		if len(v) > 5 {
			v = v[:5]
		}
		return &v
	}
	images := append([]string{}, post.Images...)
	contacts := append([]model.ContactMethod{}, post.ContactMethods...)
	return model.PostContent{PostType: post.PostType, ItemName: post.ItemName, Campus: post.Campus, Location: post.Location, EventDate: post.EventDate.Format("2006-01-02"), TimePrecision: post.TimePrecision, EventTimeStart: compact(post.EventTimeStart), EventTimeEnd: compact(post.EventTimeEnd), Description: post.Description, Images: images, ContactMethods: contacts}
}

// UserSummary 只查询公开昵称和 ID，不读取账号密码或微信标识。
func UserSummary(tx *gorm.DB, id uint64) (vo.UserSummaryVO, error) {
	var user entity.User
	err := tx.Table("users").Select("id", "nickname").Where("id = ?", id).Take(&user).Error
	if err != nil {
		return vo.UserSummaryVO{}, fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}
	return vo.UserSummaryVO{ID: strconv.FormatUint(id, 10), Nickname: strings.TrimSpace(user.Nickname)}, nil
}
