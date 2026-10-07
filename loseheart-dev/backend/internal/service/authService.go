package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/common/utils"
	"lost-found/backend/global"
	"lost-found/backend/internal/config"
	authModel "lost-found/backend/internal/model/auth"
	"lost-found/backend/internal/model/dto"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/model/vo"

	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Redis 脚本把计数与首次到期设置合为原子操作，后续尝试不刷新窗口。
var sourceLimitScript = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end
if n > 30 then return math.max(1, redis.call('TTL', KEYS[1])) end
return 0`)

var accountPauseScript = redis.NewScript(`
return math.max(0, math.ceil(redis.call('PTTL', KEYS[1]) / 1000))`)

var accountFailureScript = redis.NewScript(`
local ttl = redis.call('PTTL', KEYS[2])
if ttl > 0 then return math.ceil(ttl / 1000) end
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 600) end
if n >= 5 then
  redis.call('SET', KEYS[2], '1', 'EX', 600)
  redis.call('DEL', KEYS[1])
  return 600
end
return 0`)

// LoginSourceLimit 限制来源每分钟最多 30 次；Redis 故障不绕过限制。
func LoginSourceLimit(ctx context.Context, ip string) (int, error) {
	if global.RedisClient == nil {
		return 0, errs.AuthLimiterUnavailableError
	}

	n, err := sourceLimitScript.Run(
		ctx,
		global.RedisClient,
		[]string{loginKey("ip", ip)},
	).Int()
	if err != nil {
		return 0, errs.AuthLimiterUnavailableError
	}
	if n > 0 {
		return n, errs.LoginRateLimitedError
	}
	return 0, nil
}

func loginKey(kind, value string) string {
	digest := sha256.Sum256([]byte(value))
	return "lost_found:login:" + kind + ":" + hex.EncodeToString(digest[:])
}

func passwordPause(ctx context.Context, account string) (int, error) {
	if global.RedisClient == nil {
		return 0, errs.AuthLimiterUnavailableError
	}

	n, err := accountPauseScript.Run(
		ctx,
		global.RedisClient,
		[]string{loginKey("pause", account)},
	).Int()
	if err != nil {
		return 0, errs.AuthLimiterUnavailableError
	}
	if n > 0 {
		return n, errs.LoginRateLimitedError
	}
	return 0, nil
}

func passwordFailure(ctx context.Context, account string) (int, error) {
	n, err := accountFailureScript.Run(
		ctx,
		global.RedisClient,
		[]string{
			loginKey("fail", account),
			loginKey("pause", account),
		},
	).Int()
	if err != nil {
		return 0, errs.AuthLimiterUnavailableError
	}
	if n > 0 {
		return n, errs.LoginRateLimitedError
	}
	return 0, errs.InvalidCredentialsError
}

// Login 验证密码或已绑定微信身份，在用户行锁内读取状态和版本并签发 JWT。
// 返回重试秒数供 controller 设置 Retry-After；来源限速由 controller 在解析前执行。
func Login(
	ctx context.Context,
	input dto.LoginRequestDTO,
) (*authModel.LoginResult, int, error) {
	if global.Db == nil {
		return nil, 0, errs.AuthDatabaseError
	}
	if global.RedisClient == nil {
		return nil, 0, errs.AuthLimiterUnavailableError
	}

	var openID string
	var retry int
	var err error

	switch input.GrantType {
	case "password":
		retry, err = passwordPause(ctx, input.AccountNo)
	case "wechat_code":
		if input.ClientType != "miniapp" {
			return nil, 0, errs.WechatCodeRequestError
		}
		openID, err = exchangeWechatCode(ctx, input.Code)
	default:
		return nil, 0, errs.InvalidGrantTypeError
	}
	if err != nil {
		return nil, retry, err
	}

	var output authModel.LoginResult
	err = global.Db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user entity.User
		query := tx.Table("users").
			Clauses(clause.Locking{Strength: "UPDATE"})
		if input.GrantType == "password" {
			query = query.Where("account_no = ?", input.AccountNo)
		} else {
			query = query.Where(
				"wechat_appid = ? AND wechat_openid = ?",
				config.ServerConfig.WeChat.Appid,
				openID,
			)
		}
		lookupErr := query.Take(&user).Error
		if lookupErr != nil && !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return errs.AuthDatabaseError
		}

		if input.GrantType == "password" {
			retry, err = passwordPause(ctx, input.AccountNo)
			if err != nil {
				return err
			}

			// 不存在的账号执行等成本哈希验证，不区分账号不存在和密码错误。
			encoded := user.PasswordHash
			if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
				encoded = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
			}

			matches, verifyErr := utils.VerifyPassword(input.Password, encoded)
			if verifyErr != nil {
				return verifyErr
			}
			if !matches || errors.Is(lookupErr, gorm.ErrRecordNotFound) {
				retry, err = passwordFailure(ctx, input.AccountNo)
				return err
			}

			if err := global.RedisClient.Del(ctx, loginKey("fail", input.AccountNo)).Err(); err != nil {
				return errs.AuthLimiterUnavailableError
			}
		} else if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return errs.WechatNotBoundError
		}

		if user.Status != "active" {
			return errs.AccountDisabledError
		}
		if !user.IsVerified {
			return errs.IdentityUnverifiedError
		}
		if input.ClientType == "admin_web" && user.Role != "admin" {
			return errs.ForbiddenError
		}

		token, claims, err := utils.GenerateJWT(
			config.ServerConfig.Jwt,
			user.ID,
			user.TokenVersion,
		)
		if err != nil {
			return err
		}

		// 不把密码哈希与微信标识传给 controller。
		output = authModel.LoginResult{
			User: entity.User{
				ID:                 user.ID,
				Nickname:           user.Nickname,
				Role:               user.Role,
				MustChangePassword: user.MustChangePassword,
			},
			Token:  token,
			Claims: claims,
		}
		return nil
	})
	if err != nil {
		return nil, retry, err
	}
	return &output, 0, nil
}

// NewLoginUser 将数据库实体转换为公开登录信息，不携带密码或微信标识。
func NewLoginUser(user entity.User) vo.LoginUserVO {
	return vo.LoginUserVO{
		ID:                 strconv.FormatUint(user.ID, 10),
		Nickname:           user.Nickname,
		Role:               user.Role,
		MustChangePassword: user.MustChangePassword,
	}
}

// Logout 在行锁内递增当前账号的登录版本；任一端退出都会撤销全部端旧 JWT。
// 强制改密用户也允许退出，因此不套用限制普通业务操作的事务检查。
func Logout(ctx context.Context, identity entity.AuthUser) error {
	if identity.ID == 0 {
		return errs.AuthRequiredError
	}

	db, err := Database(ctx)
	if err != nil {
		return err
	}

	var businessErr error
	err = db.Transaction(func(tx *gorm.DB) error {
		businessErr = CheckActorForRecovery(tx, identity)
		if businessErr != nil {
			return businessErr
		}

		// 同版本的并发退出只有第一个成功；后续请求在上面的版本检查中被拒绝。
		queryErr := tx.Table("users").
			Where("id = ? AND token_version = ?", identity.ID, identity.TokenVersion).
			Updates(map[string]any{
				"token_version": gorm.Expr("token_version + 1"),
				"updated_at":    time.Now().UTC(),
			}).Error
		if queryErr != nil {
			businessErr = fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, queryErr)
		}
		return businessErr
	})
	if err != nil && businessErr == nil {
		return fmt.Errorf(constant.ErrorWrapFormat, errs.AuthDatabaseError, err)
	}
	return err
}
