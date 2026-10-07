package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"

	errs "lost-found/backend/common/errors"
	"lost-found/backend/internal/config"
	authModel "lost-found/backend/internal/model/auth"
)

// exchangeWechatCode 在后端交换一次性 code，不向日志或客户端传递上游凭证。
func exchangeWechatCode(ctx context.Context, code string) (string, error) {
	// 1. 检查小程序配置。
	cfg := config.ServerConfig.WeChat
	if cfg.Appid == "" || cfg.Secret == "" {
		return "", errs.WechatUpstreamError
	}

	// 2. 构造授权码交换请求。
	query := url.Values{
		"appid":      {cfg.Appid},
		"secret":     {cfg.Secret},
		"js_code":    {code},
		"grant_type": {"authorization_code"},
	}
	requestURL := "https://api.weixin.qq.com/sns/jscode2session?" + query.Encode()
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		requestURL,
		nil,
	)
	if err != nil {
		return "", errs.WechatUpstreamError
	}

	// 3. 调用微信接口；拒绝重定向，避免向其他主机发送凭证。
	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	response, err := client.Do(req)
	if err != nil {
		return "", errs.WechatUpstreamError
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", errs.WechatUpstreamError
	}

	// 4. 限制响应读取大小，解析微信返回的身份信息。
	var data authModel.WechatSessionResponse
	responseBody := io.LimitReader(response.Body, 64*1024)
	decoder := json.NewDecoder(responseBody)
	if err := decoder.Decode(&data); err != nil {
		return "", errs.WechatUpstreamError
	}

	// 5. 校验响应，只向登录业务返回 OpenID。
	if data.ErrorCode != 0 || data.OpenID == "" || data.SessionKey == "" {
		return "", errs.WechatUpstreamError
	}

	return data.OpenID, nil
}
