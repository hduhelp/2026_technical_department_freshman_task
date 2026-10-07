package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"time"

	"lost-found/backend/common/constant"
	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/middleware"
	"lost-found/backend/internal/model/entity"
	result "lost-found/backend/internal/model/result"
	"lost-found/backend/internal/model/vo"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"github.com/go-playground/validator/v10"
)

// Context 将数据库及上游请求限定在 15 秒内，客户端取消请求时同步取消。
func Context(c *gin.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(c.Request.Context(), 15*time.Second)
}

// Actor 只读取认证中间件已核验的身份，不接受请求体中的用户 ID。
func Actor(c *gin.Context) (entity.AuthUser, bool) {
	actor, ok := middleware.CurrentUser(c)
	if !ok || actor.ID == 0 {
		Fail(c, errs.AuthRequiredError)
		return actor, false
	}
	return actor, true
}

// BindJSON 严格解析一个 JSON 对象：拒绝未知字段、null、多段 JSON 和过大请求。
// 基础字段规则由 DTO 标签声明；状态组合、归属和数据库校验在对应业务服务完成。
func BindJSON(c *gin.Context, target any) bool {
	c.Header("Cache-Control", "no-store")
	kind, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || kind != "application/json" {
		Fail(c, errs.InvalidRequestError)
		return false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil || len(bytes.TrimSpace(body)) == 0 || bytes.TrimSpace(body)[0] != '{' {
		Fail(c, errs.InvalidRequestError)
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		Fail(c, errs.InvalidRequestError)
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		Fail(c, errs.InvalidRequestError)
		return false
	}
	if err := binding.Validator.ValidateStruct(target); err != nil {
		validationFailure(c, target, err)
		return false
	}
	if !validDateFields(reflect.ValueOf(target)) {
		Fail(c, errs.ValidationError)
		return false
	}
	return true
}

// BindQuery 解析分页和筛选参数；所有范围规则继续复用现有 DTO 标签。
func BindQuery(c *gin.Context, target any) bool {
	if err := c.ShouldBindQuery(target); err != nil {
		validationFailure(c, target, err)
		return false
	}
	if !validDateFields(reflect.ValueOf(target)) || !validPageOffset(target) {
		Fail(c, errs.ValidationError)
		return false
	}
	return true
}

// validPageOffset 防止极大页码乘页大小后变负数，导致 GORM 将查询退回第一页。
func validPageOffset(target any) bool {
	value := reflect.ValueOf(target)
	for value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		return true
	}
	page, size := int64(1), int64(20)
	if f := value.FieldByName("Page"); f.IsValid() && !f.IsNil() {
		page = f.Elem().Int()
	}
	if f := value.FieldByName("PageSize"); f.IsValid() && !f.IsNil() {
		size = f.Elem().Int()
	}
	return page >= 1 && size >= 1 && page-1 <= int64(math.MaxInt)/size
}

// validDateFields 补充 datetime 标签的严格格式检查：MySQL DATE 支持 1000–9999 年。
// 递归处理嵌入的内容 DTO；不接触字段值日志，密码等无 datetime 标签的字段不检查。
func validDateFields(value reflect.Value) bool {
	if value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return true
		}
		return validDateFields(value.Elem())
	}
	if value.Kind() != reflect.Struct {
		return true
	}
	for i := 0; i < value.NumField(); i++ {
		field, definition := value.Field(i), value.Type().Field(i)
		if definition.Anonymous && !validDateFields(field) {
			return false
		}
		for _, tag := range strings.Split(definition.Tag.Get("binding"), ",") {
			layout, ok := strings.CutPrefix(tag, "datetime=")
			if !ok {
				continue
			}
			if field.Kind() == reflect.Pointer {
				if field.IsNil() {
					continue
				}
				field = field.Elem()
			}
			input := field.String()
			if input == "" {
				continue
			}
			parsed, err := time.Parse(layout, input)
			if err != nil || (layout == "15:04" && parsed.Format(layout) != input) || (layout == "2006-01-02" && parsed.Year() < 1000) {
				return false
			}
		}
	}
	return true
}

// PathID 严格解析正十进制 ID，拒绝溢出、负数及空值。
func PathID(c *gin.Context, name string) (uint64, bool) {
	value := c.Param(name)
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			Fail(c, errs.InvalidRequestError)
			return 0, false
		}
	}
	id, err := strconv.ParseUint(value, 10, 64)
	if err != nil || id == 0 {
		Fail(c, errs.InvalidRequestError)
		return 0, false
	}
	return id, true
}

// IfMatch 保留客户端完整强 ETag，在写事务内再次比较；缺失属于前置条件错误。
func IfMatch(c *gin.Context) (string, bool) {
	value := c.GetHeader("If-Match")
	if strings.TrimSpace(value) == "" {
		Fail(c, errs.PreconditionRequiredError)
		return "", false
	}
	return value, true
}

// Success 统一成功响应；nil 数据编码为 null，不让数据库实体意外成为响应对象。
func Success(c *gin.Context, status int, data any) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, result.Result[any]{Code: 1, Msg: constant.Success, Data: data, RequestID: c.GetString("request_id")})
}

// Fail 仅输出契约定义的错误码和文案，底层 SQL、OSS URL 和凭证不会进入响应。
func Fail(c *gin.Context, err error) {
	status, code, message := http.StatusInternalServerError, constant.InternalErrorCode, constant.InternalError
	switch {
	case errors.Is(err, errs.AuthRequiredError):
		status, code, message = 401, constant.AuthRequiredCode, constant.AuthRequired
	case errors.Is(err, errs.TokenRevokedError):
		status, code, message = 401, constant.TokenRevokedCode, constant.TokenRevoked
	case errors.Is(err, errs.InvalidCredentialsError):
		status, code, message = 401, constant.InvalidCredentialsCode, constant.InvalidCredentials
	case errors.Is(err, errs.AccountDisabledError):
		status, code, message = 403, constant.AccountDisabledCode, constant.AccountDisabled
	case errors.Is(err, errs.IdentityUnverifiedError):
		status, code, message = 403, constant.IdentityUnverifiedCode, constant.IdentityUnverified
	case errors.Is(err, errs.PasswordChangeRequiredError):
		status, code, message = 403, constant.PasswordChangeRequiredCode, constant.PasswordChangeRequired
	case errors.Is(err, errs.ForbiddenError):
		status, code, message = 403, constant.ForbiddenCode, constant.Forbidden
	case errors.Is(err, errs.ResourceNotFoundError):
		status, code, message = 404, constant.ResourceNotFoundCode, constant.ResourceNotFound
	case errors.Is(err, errs.PreconditionRequiredError):
		status, code, message = 400, constant.PreconditionRequiredCode, constant.PreconditionRequired
	case errors.Is(err, errs.ResourceChangedError):
		status, code, message = 412, constant.ResourceChangedCode, constant.ResourceChanged
	case errors.Is(err, errs.StateConflictError):
		status, code, message = 409, constant.StateConflictCode, constant.StateConflict
	case errors.Is(err, errs.IdempotencyConflictError):
		status, code, message = 409, constant.IdempotencyConflictCode, constant.IdempotencyConflict
	case errors.Is(err, errs.PostQuotaExceededError):
		status, code, message = 429, constant.PostQuotaExceededCode, constant.PostQuotaExceeded
		now := time.Now().In(time.FixedZone("Asia/Shanghai", 8*3600))
		next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location())
		c.Header("Retry-After", strconv.Itoa(int(next.Sub(now).Seconds())+1))
	case errors.Is(err, errs.WechatAlreadyBoundError):
		status, code, message = 409, constant.WechatAlreadyBoundCode, constant.WechatAlreadyBound
	case errors.Is(err, errs.WechatNotBoundError):
		status, code, message = 409, constant.WechatNotBoundCode, constant.WechatNotBound
	case errors.Is(err, errs.WechatUpstreamError):
		status, code, message = 502, constant.WechatUpstreamErrorCode, constant.WechatUpstreamError
	case errors.Is(err, errs.LoginRateLimitedError):
		status, code, message = 429, constant.LoginRateLimitedCode, constant.LoginRateLimited
	case errors.Is(err, errs.AuthLimiterUnavailableError):
		status, code, message = 503, constant.AuthLimiterUnavailableCode, constant.AuthLimiterUnavailable
	case errors.Is(err, errs.OSSUnavailableError):
		status, code, message = 503, constant.OSSUnavailableCode, constant.OSSUnavailable
	case errors.Is(err, errs.AuthDatabaseError):
		status, code, message = 503, constant.ServiceUnavailableCode, constant.ServiceUnavailable
	case errors.Is(err, errs.FileTooLargeError):
		status, code, message = 413, constant.FileTooLargeCode, constant.FileTooLarge
	case errors.Is(err, errs.UnsupportedMediaTypeError):
		status, code, message = 415, constant.UnsupportedMediaTypeCode, constant.UnsupportedMediaType
	case errors.Is(err, errs.ValidationError):
		status, code, message = 400, constant.ValidationErrorCode, constant.InvalidRequest
	case errors.Is(err, errs.InvalidRequestError), errors.Is(err, errs.InvalidPasswordError):
		status, code, message = 400, constant.InvalidRequestCode, constant.InvalidRequest
	}
	c.Header("Cache-Control", "no-store")
	c.AbortWithStatusJSON(status, vo.ErrorResponseVO{Code: code, Msg: message, Data: nil, RequestID: c.GetString("request_id")})
}

// validationFailure 将字段校验失败定位到 JSON/form 字段名，避免返回结构体或密码内容。
func validationFailure(c *gin.Context, target any, err error) {
	var failures validator.ValidationErrors
	if !errors.As(err, &failures) {
		Fail(c, errs.InvalidRequestError)
		return
	}
	fields := make([]vo.FieldErrorVO, 0, len(failures))
	typ := reflect.TypeOf(target)
	for typ.Kind() == reflect.Pointer {
		typ = typ.Elem()
	}
	for _, failure := range failures {
		name := failure.Field()
		if typ.Kind() == reflect.Struct {
			if f, ok := typ.FieldByName(failure.StructField()); ok {
				tag := f.Tag.Get("json")
				if tag == "" {
					tag = f.Tag.Get("form")
				}
				if tag != "" {
					name = strings.Split(tag, ",")[0]
				}
			}
		}
		fields = append(fields, vo.FieldErrorVO{Field: name, Message: fmt.Sprintf(constant.FieldValidationMessage, name, failure.Tag())})
	}
	c.Header("Cache-Control", "no-store")
	c.AbortWithStatusJSON(400, vo.ErrorResponseVO{Code: constant.ValidationErrorCode, Msg: constant.InvalidRequest, Data: nil, RequestID: c.GetString("request_id"), Errors: fields})
}
