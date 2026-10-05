package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newTestRouter(t *testing.T) http.Handler {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	return newRouter(db, []byte("测试密钥"))
}

func request(t *testing.T, handler http.Handler, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var payload *bytes.Reader
	if body == nil {
		payload = bytes.NewReader(nil)
	} else {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		payload = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, payload)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

func Test注册登录并获取当前用户(t *testing.T) {
	handler := newTestRouter(t)

	register := request(t, handler, http.MethodPost, "/api/auth/register", map[string]string{
		"username": "xiaoming",
		"password": "123456",
	}, "")
	if register.Code != http.StatusCreated {
		t.Fatalf("注册状态码 = %d，期望 %d", register.Code, http.StatusCreated)
	}

	wrongPassword := request(t, handler, http.MethodPost, "/api/auth/login", map[string]string{
		"username": "xiaoming",
		"password": "wrong",
	}, "")
	if wrongPassword.Code != http.StatusUnauthorized {
		t.Fatalf("错误密码状态码 = %d，期望 %d", wrongPassword.Code, http.StatusUnauthorized)
	}

	login := request(t, handler, http.MethodPost, "/api/auth/login", map[string]string{
		"username": "xiaoming",
		"password": "123456",
	}, "")
	if login.Code != http.StatusOK {
		t.Fatalf("登录状态码 = %d，期望 %d", login.Code, http.StatusOK)
	}
	var loginBody struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(login.Body).Decode(&loginBody); err != nil {
		t.Fatal(err)
	}
	if loginBody.Token == "" {
		t.Fatal("登录响应未返回令牌")
	}

	unauthorized := request(t, handler, http.MethodGet, "/api/auth/me", nil, "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("未登录状态码 = %d，期望 %d", unauthorized.Code, http.StatusUnauthorized)
	}

	me := request(t, handler, http.MethodGet, "/api/auth/me", nil, loginBody.Token)
	if me.Code != http.StatusOK {
		t.Fatalf("当前用户状态码 = %d，期望 %d", me.Code, http.StatusOK)
	}
	var meBody struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(me.Body).Decode(&meBody); err != nil {
		t.Fatal(err)
	}
	if meBody.Username != "xiaoming" {
		t.Fatalf("当前用户 = %q，期望 xiaoming", meBody.Username)
	}
}
