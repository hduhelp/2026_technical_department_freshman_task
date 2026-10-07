package service

import (
	"context"
	"strings"

	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/store"
)

// UserService 负责当前用户资料的读取与修改。
type UserService struct {
	users *store.UserStore
}

// NewUserService 创建用户服务。
func NewUserService(users *store.UserStore) *UserService {
	return &UserService{users: users}
}

// Me 返回当前登录用户的资料。
//
// 入参 u 由鉴权中间件从数据库查出并注入，此处不再回查 ——
// 一次请求内重复查同一行没有意义。
func (s *UserService) Me(u *model.User) *model.UserDTO {
	return model.ToUserDTO(u)
}

// UpdateMe 局部更新当前用户资料，只覆盖请求中真正出现的字段。
//
// 三个字段都是指针：nil 表示「本次不修改」，因此前端可以只传 nickname
// 而不必把 contact 一并带上，也不会因为漏传而被写成空串。
//
// ⚠️ role / username / password_hash 不可通过本接口修改：
// UpdateMeReq 结构体里根本没有这些字段，JSON 解码时会被直接丢弃，
// 即使请求体带了 "role":"admin" 也不会生效（SPEC 10 安全基线）。
func (s *UserService) UpdateMe(ctx context.Context, u *model.User, req model.UpdateMeReq) (*model.UserDTO, error) {
	// 以现有值作为基线，只被请求覆盖的字段才会变化。
	nickname := u.Nickname
	contact := u.Contact
	contactPublic := u.ContactPublic

	if req.Nickname != nil {
		next := strings.TrimSpace(*req.Nickname)
		if next == "" {
			return nil, apperr.Newf(apperr.CodeInvalidParam, "昵称不能为空")
		}
		if len([]rune(next)) > maxNicknameLen {
			return nil, apperr.Newf(apperr.CodeInvalidParam, "昵称长度不能超过 32 个字符")
		}
		nickname = next
	}

	if req.Contact != nil {
		next := strings.TrimSpace(*req.Contact)
		if len([]rune(next)) > maxContactLen {
			return nil, apperr.Newf(apperr.CodeInvalidParam, "联系方式长度不能超过 64 个字符")
		}
		// 联系方式允许清空（用户可能想撤下已公开的联系方式），故不做非空校验。
		contact = next
	}

	if req.ContactPublic != nil {
		contactPublic = *req.ContactPublic
	}

	if err := s.users.UpdateProfile(ctx, u.ID, nickname, contact, contactPublic); err != nil {
		if appErr, ok := apperr.As(err); ok {
			return nil, appErr
		}
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	// 回读确认落库结果，保证响应与数据库完全一致
	// （updated_at 由 MySQL 的 ON UPDATE CURRENT_TIMESTAMP 维护，本地推算不可靠）。
	updated, err := s.users.GetByID(ctx, u.ID)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	return model.ToUserDTO(updated), nil
}
