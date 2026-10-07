package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"

	"lost-and-found/internal/auth"
	"lost-and-found/internal/model"
	"lost-and-found/internal/store"
)

type Server struct {
	store  *store.Store
	static fs.FS
}

func New(st *store.Store, static fs.FS) *Server {
	return &Server{store: st, static: static}
}

// Routes 组装所有路由，并套上 CORS 与日志中间件。
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	// 认证
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/auth/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("POST /api/auth/logout", s.requireAuth(s.handleLogout))

	// 遗失物
	mux.HandleFunc("POST /api/items", s.requireAuth(s.handleCreateItem))
	mux.HandleFunc("GET /api/items", s.handleListItems)
	mux.HandleFunc("GET /api/items/{id}", s.handleGetItem)
	mux.HandleFunc("PUT /api/items/{id}", s.requireAuth(s.handleUpdateItem))
	mux.HandleFunc("DELETE /api/items/{id}", s.requireAuth(s.handleDeleteItem))
	mux.HandleFunc("PATCH /api/items/{id}/status", s.requireAuth(s.handleUpdateStatus))

	// 静态前端（主界面）
	mux.Handle("/", http.FileServer(http.FS(s.static)))

	return withLogging(withCORS(mux))
}

// ---------- 认证处理器 ----------

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var cred credentials
	if err := decode(r, &cred); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误: "+err.Error())
		return
	}
	if err := validateCredentials(cred); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(cred.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	user, err := s.store.CreateUser(cred.Username, hash)
	if err != nil {
		if errors.Is(err, store.ErrUserExists) {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	s.issueSession(w, http.StatusCreated, user)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var cred credentials
	if err := decode(r, &cred); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	user, ok := s.store.GetUserByUsername(cred.Username)
	if !ok || !auth.VerifyPassword(cred.Password, user.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	s.issueSession(w, http.StatusOK, user)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, _ := currentUser(r)
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.store.DeleteSession(bearerToken(r))
	writeJSON(w, http.StatusOK, map[string]string{"message": "已退出登录"})
}

// issueSession 生成会话令牌并返回统一登录响应。
func (s *Server) issueSession(w http.ResponseWriter, status int, user model.User) {
	token, err := auth.NewToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	s.store.CreateSession(token, user.ID)
	writeJSON(w, status, map[string]any{"token": token, "user": user})
}

// ---------- 遗失物处理器 ----------

type itemInput struct {
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Category    string        `json:"category"`
	Location    string        `json:"location"`
	LostAt      string        `json:"lost_at"` // RFC3339 或 YYYY-MM-DD
	Contact     model.Contact `json:"contact"`
	Status      string        `json:"status"`
}

type statusInput struct {
	Status string `json:"status"`
}

func (s *Server) handleCreateItem(w http.ResponseWriter, r *http.Request) {
	u, _ := currentUser(r)
	var in itemInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	item, err := buildItem(in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	item.PublisherID = u.ID
	created, err := s.store.CreateItem(item)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleListItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	category := q.Get("category")
	status := q.Get("status")
	keyword := strings.ToLower(strings.TrimSpace(q.Get("keyword")))

	items := s.store.ListItems()
	out := make([]model.Item, 0, len(items))
	for _, it := range items {
		if category != "" && it.Category != category {
			continue
		}
		if status != "" && it.Status != status {
			continue
		}
		if keyword != "" {
			hay := strings.ToLower(it.Title + " " + it.Description + " " + it.Location)
			if !strings.Contains(hay, keyword) {
				continue
			}
		}
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out, "count": len(out)})
}

func (s *Server) handleGetItem(w http.ResponseWriter, r *http.Request) {
	it, ok := s.store.GetItem(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "遗失物不存在")
		return
	}
	writeJSON(w, http.StatusOK, it)
}

func (s *Server) handleUpdateItem(w http.ResponseWriter, r *http.Request) {
	u, _ := currentUser(r)
	id := r.PathValue("id")

	cur, ok := s.store.GetItem(id)
	if !ok {
		writeError(w, http.StatusNotFound, "遗失物不存在")
		return
	}
	if cur.PublisherID != u.ID {
		writeError(w, http.StatusForbidden, "只有发布者可以修改该遗失物")
		return
	}

	var in itemInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	item, err := buildItem(in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	item.ID = cur.ID
	updated, err := s.store.UpdateItem(item)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteItem(w http.ResponseWriter, r *http.Request) {
	u, _ := currentUser(r)
	id := r.PathValue("id")

	cur, ok := s.store.GetItem(id)
	if !ok {
		writeError(w, http.StatusNotFound, "遗失物不存在")
		return
	}
	if cur.PublisherID != u.ID {
		writeError(w, http.StatusForbidden, "只有发布者可以删除该遗失物")
		return
	}
	if err := s.store.DeleteItem(id); err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "已删除"})
}

func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	u, _ := currentUser(r)
	id := r.PathValue("id")

	cur, ok := s.store.GetItem(id)
	if !ok {
		writeError(w, http.StatusNotFound, "遗失物不存在")
		return
	}
	if cur.PublisherID != u.ID {
		writeError(w, http.StatusForbidden, "只有发布者可以修改该遗失物的状态")
		return
	}

	var in statusInput
	if err := decode(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if in.Status != model.StatusUnclaimed && in.Status != model.StatusClaimed {
		writeError(w, http.StatusBadRequest, "status 必须是 unclaimed（未领取）或 claimed（已领取）")
		return
	}
	cur.Status = in.Status
	updated, err := s.store.UpdateItem(cur)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// buildItem 校验输入并构造 Item。
func buildItem(in itemInput) (model.Item, error) {
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		return model.Item{}, errors.New("标题不能为空")
	}
	if len(in.Title) > 120 {
		return model.Item{}, errors.New("标题过长（最多 120 字符）")
	}
	if in.Category != model.CategoryLost && in.Category != model.CategoryFound {
		return model.Item{}, errors.New("category 必须是 lost（寻找）或 found（发现/招领）")
	}
	if in.Status != "" && in.Status != model.StatusUnclaimed && in.Status != model.StatusClaimed {
		return model.Item{}, errors.New("status 必须是 unclaimed（未领取）或 claimed（已领取）")
	}
	if strings.TrimSpace(in.Contact.Name) == "" {
		return model.Item{}, errors.New("请填写联系人姓名")
	}
	if strings.TrimSpace(in.Contact.Phone) == "" &&
		strings.TrimSpace(in.Contact.WeChat) == "" &&
		strings.TrimSpace(in.Contact.Email) == "" {
		return model.Item{}, errors.New("请至少填写一种联系方式（电话/微信/邮箱）")
	}

	var lostAt time.Time
	switch {
	case in.LostAt == "":
		lostAt = time.Now().UTC()
	default:
		if t, err := time.Parse(time.RFC3339, in.LostAt); err == nil {
			lostAt = t
		} else if t, err := time.Parse("2006-01-02", in.LostAt); err == nil {
			lostAt = t
		} else {
			return model.Item{}, errors.New("lost_at 时间格式无效，请使用 RFC3339 或 YYYY-MM-DD")
		}
	}

	status := in.Status
	if status == "" {
		status = model.StatusUnclaimed
	}

	return model.Item{
		Title:       in.Title,
		Description: strings.TrimSpace(in.Description),
		Category:    in.Category,
		Location:    strings.TrimSpace(in.Location),
		LostAt:      lostAt,
		Contact:     in.Contact,
		Status:      status,
	}, nil
}

func validateCredentials(c credentials) error {
	c.Username = strings.TrimSpace(c.Username)
	if len(c.Username) < 3 || len(c.Username) > 32 {
		return errors.New("用户名长度需在 3~32 个字符之间")
	}
	if len(c.Password) < 6 || len(c.Password) > 72 {
		return errors.New("密码长度需在 6~72 个字符之间")
	}
	return nil
}

// ---------- 中间件与工具 ----------

type ctxKey string

const userCtxKey ctxKey = "user"

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "未登录，请先登录")
			return
		}
		userID, ok := s.store.GetSession(token)
		if !ok {
			writeError(w, http.StatusUnauthorized, "登录已过期，请重新登录")
			return
		}
		user, ok := s.store.GetUserByID(userID)
		if !ok {
			writeError(w, http.StatusUnauthorized, "用户不存在")
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, user)
		next(w, r.WithContext(ctx))
	}
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func currentUser(r *http.Request) (model.User, bool) {
	u, ok := r.Context().Value(userCtxKey).(model.User)
	return u, ok
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

// ---------- JSON 编解码 ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := dec.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return errors.New("请求体只能包含一个 JSON 对象")
	}
	return nil
}
