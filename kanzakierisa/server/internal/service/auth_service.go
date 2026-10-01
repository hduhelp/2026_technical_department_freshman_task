package service

import (
	"context"
	"log/slog"
	"strings"

	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/jwtutil"
	"hdu-lostfound/internal/pkg/password"
	"hdu-lostfound/internal/store"
)

// dummyHash 是一个固定的合法 bcrypt 哈希，对应明文 "123456"。
//
// 用途见 Login：当用户名不存在时，我们仍然拿它跑一次 bcrypt 比对，
// 让「用户不存在」与「密码错误」两条路径的**耗时接近**。
// 否则前者因为跳过哈希计算会快得多，攻击者能靠响应时间差枚举出
// 哪些用户名真实存在（时序侧信道）。
//
// 这是 bcrypt cost=10 对 "123456" 的结果，仅用于消耗等量 CPU，不参与任何判定。
const dummyHash = "$2a$10$acYg/tMzmjGl3bbUn677JOPb4V0fvcBFeCu28agVjlTWaJwNXJNum"

// AuthService 负责注册与登录。
type AuthService struct {
	users  *store.UserStore // 用户仓储
	tokens *jwtutil.Manager // JWT 签发与解析
}

// NewAuthService 创建认证服务。
func NewAuthService(users *store.UserStore, tokens *jwtutil.Manager) *AuthService {
	return &AuthService{users: users, tokens: tokens}
}

// Register 注册新用户。
//
// 流程（SPEC 02 第 5 节）：校验用户名与口令 → 生成 bcrypt 哈希 → 插入。
// 注册成功**不签发 token**（不自动登录），前端收到 user 后引导用户主动登录。
//
// 重名判定不靠「先查再插」——那在并发下有 TOCTOU 竞态；
// 而是直接 INSERT 并捕获 uk_username 的 1062，由数据库唯一索引做最终裁决。
func (s *AuthService) Register(ctx context.Context, req model.RegisterReq) (*model.UserDTO, error) {
	username := strings.TrimSpace(req.Username)
	if err := validateUsername(username); err != nil {
		return nil, err
	}
	if err := validatePassword(req.Password); err != nil {
		return nil, err
	}

	// 昵称留空时回落为用户名，保证展示层永远有内容可渲染。
	nickname := strings.TrimSpace(req.Nickname)
	if nickname == "" {
		nickname = username
	}
	if len([]rune(nickname)) > maxNicknameLen {
		return nil, apperr.Newf(apperr.CodeInvalidParam, "昵称长度不能超过 32 个字符")
	}

	hashed, err := password.Hash(req.Password)
	if err != nil {
		// 哈希失败属于服务端问题（cost 非法等），不对前端暴露细节。
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	u := &model.User{
		Username:     username,
		PasswordHash: hashed,
		Nickname:     nickname,
		Role:         model.RoleUser, // 角色由服务端决定，绝不接受客户端传入
	}

	id, err := s.users.Create(ctx, u)
	if err != nil {
		// store 已把 1062 翻译成 1005，此处原样透出。
		if appErr, ok := apperr.As(err); ok {
			return nil, appErr
		}
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	// 回填主键与时间戳后回读一次，让响应里的 created_at 与库内真实值一致
	// （而不是本地 time.Now() 猜出来的时间）。
	created, err := s.users.GetByID(ctx, id)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}
	return model.ToUserDTO(created), nil
}

// Login 校验凭据并签发 token。
//
// 安全要点：**不区分「用户不存在」与「密码错误」**，两种情况一律返回 1006。
// 并且当用户不存在时，仍然执行一次 bcrypt 比对来抹平响应时间差（防用户名枚举）。
func (s *AuthService) Login(ctx context.Context, req model.LoginReq) (*model.AuthResult, error) {
	username := strings.TrimSpace(req.Username)

	u, err := s.users.GetByUsername(ctx, username)
	if err != nil {
		if appErr, ok := apperr.As(err); ok && appErr.Code == apperr.CodeNotFound {
			// 关键：走一次与真实校验等价的哈希计算，再返回统一的 1006。
			password.Verify(dummyHash, req.Password)
			return nil, apperr.New(apperr.CodeBadCredentials)
		}
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	if !password.Verify(u.PasswordHash, req.Password) {
		return nil, apperr.New(apperr.CodeBadCredentials)
	}

	token, err := s.tokens.Generate(u.ID)
	if err != nil {
		return nil, apperr.Wrap(apperr.CodeInternal, err)
	}

	return &model.AuthResult{Token: token, User: model.ToUserDTO(u)}, nil
}

// Authenticate 按用户 id 取回完整用户，供鉴权中间件在验签之后调用。
//
// 为什么中间件要回查数据库：token 里的 uid 只证明「签发时该用户存在」，
// 无法反映「此刻是否已被删除」。只信 token 会让已注销用户继续通行。
//
// 用户不存在时返回 1002（凭证失效）而非 1004 ——
// 从请求者视角这不是「资源找不到」，而是「你的登录状态已无效」，
// 前端据此清 token 并跳登录页。
func (s *AuthService) Authenticate(ctx context.Context, userID int64) (*model.User, error) {
	u, err := s.users.GetByID(ctx, userID)
	if err != nil {
		if appErr, ok := apperr.As(err); ok && appErr.Code == apperr.CodeNotFound {
			return nil, apperr.Wrap(apperr.CodeUnauthorized, err)
		}
		slog.Error("鉴权回查用户失败", "userId", userID, "error", err)
		return nil, apperr.Wrap(apperr.CodeUnauthorized, err)
	}
	return u, nil
}
