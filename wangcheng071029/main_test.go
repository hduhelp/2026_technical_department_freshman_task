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

func loginToken(t *testing.T, handler http.Handler, username string) string {
	t.Helper()
	request(t, handler, http.MethodPost, "/api/auth/register", map[string]string{
		"username": username,
		"password": "123456",
	}, "")
	login := request(t, handler, http.MethodPost, "/api/auth/login", map[string]string{
		"username": username,
		"password": "123456",
	}, "")
	if login.Code != http.StatusOK {
		t.Fatalf("%s 登录失败：%d", username, login.Code)
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(login.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body.Token
}

func Test信息创建查询权限和状态流转(t *testing.T) {
	handler := newTestRouter(t)
	ownerToken := loginToken(t, handler, "xiaoming")
	otherToken := loginToken(t, handler, "xiaohong")

	create := request(t, handler, http.MethodPost, "/api/posts", map[string]string{
		"type":        "lost",
		"item_name":   "校园卡",
		"location":    "下沙校区图书馆",
		"happened_at": "2026-09-26T14:30:00+08:00",
		"description": "黑色卡套，里面有校园卡",
		"contact":     "QQ：10001",
	}, ownerToken)
	if create.Code != http.StatusCreated {
		t.Fatalf("创建信息状态码 = %d，期望 %d", create.Code, http.StatusCreated)
	}
	var post struct {
		ID uint `json:"id"`
	}
	if err := json.NewDecoder(create.Body).Decode(&post); err != nil {
		t.Fatal(err)
	}

	list := request(t, handler, http.MethodGet, "/api/posts?q=校园卡&type=lost&status=searching&page=1&page_size=1", nil, "")
	if list.Code != http.StatusOK || !bytes.Contains(list.Body.Bytes(), []byte("下沙校区图书馆")) {
		t.Fatalf("筛选搜索失败：状态码 %d，响应 %s", list.Code, list.Body.String())
	}

	forbidden := request(t, handler, http.MethodPut, "/api/posts/1", map[string]string{
		"item_name": "他人的校园卡",
	}, otherToken)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("他人修改状态码 = %d，期望 %d", forbidden.Code, http.StatusForbidden)
	}

	found := request(t, handler, http.MethodPatch, "/api/posts/1/status", map[string]string{"status": "found"}, ownerToken)
	if found.Code != http.StatusOK {
		t.Fatalf("标记已找到状态码 = %d，期望 %d", found.Code, http.StatusOK)
	}
	closed := request(t, handler, http.MethodPatch, "/api/posts/1/status", map[string]string{"status": "closed"}, ownerToken)
	if closed.Code != http.StatusOK {
		t.Fatalf("标记已结束状态码 = %d，期望 %d", closed.Code, http.StatusOK)
	}
	illegal := request(t, handler, http.MethodPatch, "/api/posts/1/status", map[string]string{"status": "found"}, ownerToken)
	if illegal.Code != http.StatusBadRequest {
		t.Fatalf("已结束后变更状态码 = %d，期望 %d", illegal.Code, http.StatusBadRequest)
	}

	deleted := request(t, handler, http.MethodDelete, "/api/posts/1", nil, ownerToken)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("删除状态码 = %d，期望 %d", deleted.Code, http.StatusNoContent)
	}
}
