// 失物招领平台（单文件实现，Go 标准库 + SQLite 数据库）
// 功能：
//  1. 用户注册 / 登录 / 获取当前用户信息 / 退出登录
//     - 登录后签发 JWT，同时写入 HttpOnly Cookie（Cookie/Session），也支持 Authorization: Bearer <token>
//     - 服务端保存 session 表，支持退出登录后 token 立即失效
//  2. 失物 / 招领信息：创建、查看、修改自己的、删除自己的
//  3. 查看和搜索：关键词 LIKE 匹配 + 状态/类型/发布人过滤 + ORDER BY + LIMIT / OFFSET 分页
//  4. 状态管理：寻找中(searching) -> 已找到(found) -> 已关闭(closed)，可重新开启
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite" // 空白导入：驱动在 init() 里注册成名字 "sqlite"
)

const (
	StatusSearching = "searching" // 寻找中
	StatusFound     = "found"     // 已找到
	StatusClosed    = "closed"    // 已关闭
	TypeLost        = "lost"      // 失物（我丢了东西）
	TypeFound       = "found"     // 招领（我捡到东西）
	tokenCookieName = "token"
	tokenTTL        = 7 * 24 * time.Hour
)

var jwtSecret = []byte(env("JWT_SECRET", "dev-secret-change-me"))

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
func normalizeStatus(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "searching", "寻找中", "寻找", "open", "lost":
		return StatusSearching
	case "found", "已找到", "找到了", "done", "resolved":
		return StatusFound
	case "closed", "已关闭", "关闭":
		return StatusClosed
	}
	return ""
}
func normalizeType(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "lost", "失物", "寻物":
		return TypeLost
	case "found", "招领", "拾物", "拾遗":
		return TypeFound
	}
	return ""
}
func statusText(s string) string {
	switch s {
	case StatusSearching:
		return "寻找中"
	case StatusFound:
		return "已找到"
	case StatusClosed:
		return "已关闭"
	}
	return s
}

// 状态寻找中 -> 已找到 -> 已关闭，可重新开启
func canTransition(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case StatusSearching:
		return to == StatusFound || to == StatusClosed
	case StatusFound:
		return to == StatusSearching || to == StatusClosed
	case StatusClosed:
		return to == StatusSearching
	}
	return false
}

type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Nickname  string    `json:"nickname"`
	Email     string    `json:"email,omitempty"`
	Phone     string    `json:"phone,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	password  string    // salt$hash，只存哈希，绝不出现在 JSON 里
}
type Item struct {
	ID          int64     `json:"id"`
	OwnerID     int64     `json:"owner_id"`
	OwnerName   string    `json:"owner_name"`
	Type        string    `json:"type"` // lost / found
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Place       string    `json:"place"`   // 丢失/拾取地点
	Contact     string    `json:"contact"` // 联系方式
	Status      string    `json:"status"`  // searching / found / closed
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
type session struct {
	UserID    int64
	ExpiresAt time.Time
}

// SQLite数据库
type Store struct {
	db *sql.DB // 数据库连接池，内部自带并发安全，不再需要 sync.RWMutex
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// 建表语句：拆成一条一条写，避免「一次执行多条语句」在不同驱动上的兼容问题
var schemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS users (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		username   TEXT    NOT NULL COLLATE NOCASE UNIQUE,
		nickname   TEXT    NOT NULL DEFAULT '',
		email      TEXT    NOT NULL DEFAULT '',
		phone      TEXT    NOT NULL DEFAULT '',
		password   TEXT    NOT NULL,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS items (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		owner_id    INTEGER NOT NULL REFERENCES users(id),
		type        TEXT    NOT NULL,
		title       TEXT    NOT NULL,
		description TEXT    NOT NULL DEFAULT '',
		place       TEXT    NOT NULL DEFAULT '',
		contact     TEXT    NOT NULL DEFAULT '',
		status      TEXT    NOT NULL,
		created_at  INTEGER NOT NULL,
		updated_at  INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_items_owner      ON items(owner_id)`,
	`CREATE TABLE IF NOT EXISTS sessions (
		token      TEXT    PRIMARY KEY,
		user_id    INTEGER NOT NULL REFERENCES users(id),
		expires_at INTEGER NOT NULL
	)`,
}

func initSchema(db *sql.DB) error {
	for _, stmt := range schemaStatements {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("执行建表语句失败: %w", err)
		}
	}
	return nil
}

var errUserExists = errors.New("名字被占了喵")

// ErrItemNotFound 只表示「这条信息不存在」这一业务事实；
// 数据库读写故障必须原样向上传递，不能和它混用同一个返回值
var ErrItemNotFound = errors.New("信息不存在")

func (s *Store) CreateUser(username, password, nickname, email, phone string) (*User, error) {
	if nickname == "" {
		nickname = username // 默认昵称取用户名
	}
	u := &User{
		Username:  username,
		Nickname:  nickname,
		Email:     email,
		Phone:     phone,
		CreatedAt: time.Now(),
		password:  hashPassword(password),
	}
	var exists int
	if err := s.db.QueryRow(
		`SELECT COUNT(1) FROM users WHERE username = ?`, u.Username).Scan(&exists); err != nil {
		return nil, err
	}
	if exists > 0 {
		return nil, errUserExists
	}
	res, err := s.db.Exec(
		`INSERT INTO users (username, nickname, email, phone, password, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		u.Username, u.Nickname, u.Email, u.Phone, u.password, u.CreatedAt.Unix(),
	)
	if err != nil {
		return nil, err
	}
	u.ID, err = res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return u, nil
}
func (s *Store) FindUserByName(username string) (*User, bool) {
	// username 列是 COLLATE NOCASE，所以这里天然不区分大小写
	return s.scanUser(s.db.QueryRow(
		`SELECT id, username, nickname, email, phone, password, created_at
		   FROM users WHERE username = ?`, username))
}
func (s *Store) FindUserByID(id int64) (*User, bool) {
	return s.scanUser(s.db.QueryRow(
		`SELECT id, username, nickname, email, phone, password, created_at
		   FROM users WHERE id = ?`, id))
}

// scanUser 把一行查询结果填进 User；查不到或出错都返回 false
func (s *Store) scanUser(row *sql.Row) (*User, bool) {
	var u User
	var hashed string
	var created int64
	err := row.Scan(&u.ID, &u.Username, &u.Nickname, &u.Email, &u.Phone, &hashed, &created)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("查询用户失败: %v", err)
		}
		return nil, false
	}
	u.password = hashed
	u.CreatedAt = time.Unix(created, 0)
	return &u, true
}

// 会话
func (s *Store) CreateSession(token string, userID int64) {
	_, err := s.db.Exec(
		`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
		token, userID, time.Now().Add(tokenTTL).Unix())
	if err != nil {
		log.Printf("保存会话失败: %v", err)
	}
}
func (s *Store) GetSession(token string) (session, bool) {
	var sess session
	var expires int64
	err := s.db.QueryRow(
		`SELECT user_id, expires_at FROM sessions WHERE token = ? AND expires_at > ?`,
		token, time.Now().Unix()).Scan(&sess.UserID, &expires)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("查询会话失败: %v", err)
		}
		return session{}, false
	}
	sess.ExpiresAt = time.Unix(expires, 0)
	return sess, true
}
func (s *Store) DeleteSession(token string) {
	if _, err := s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token); err != nil {
		log.Printf("删除会话失败: %v", err)
	}
}

// 信息
func (s *Store) CreateItem(owner *User, it Item) (Item, error) {
	now := time.Now()
	it.OwnerID = owner.ID
	it.OwnerName = owner.Nickname
	it.CreatedAt, it.UpdatedAt = now, now
	res, err := s.db.Exec(
		`INSERT INTO items (owner_id, type, title, description, place, contact,
		                    status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		it.OwnerID, it.Type, it.Title, it.Description, it.Place, it.Contact,
		it.Status, it.CreatedAt.Unix(), it.UpdatedAt.Unix())
	if err != nil {
		log.Printf("创建信息失败: %v", err)
		return Item{}, err // 写库失败必须让调用方知道，否则接口会谎报 201
	}
	id, err := res.LastInsertId()
	if err != nil {
		log.Printf("读取新建信息 ID 失败: %v", err)
		return Item{}, err
	}
	it.ID = id
	return it, nil
}

// GetItem 查看信息；owner_name 用 JOIN 实时取，不冗余存储，用户改昵称后立即生效
func (s *Store) GetItem(id int64) (Item, bool) {
	var it Item
	var created, updated int64
	err := s.db.QueryRow(
		`SELECT i.id, i.owner_id, COALESCE(u.nickname, ''), i.type, i.title, i.description,
		        i.place, i.contact, i.status, i.created_at, i.updated_at
		   FROM items i LEFT JOIN users u ON u.id = i.owner_id
		  WHERE i.id = ?`, id).
		Scan(&it.ID, &it.OwnerID, &it.OwnerName, &it.Type, &it.Title, &it.Description,
			&it.Place, &it.Contact, &it.Status, &created, &updated)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("查询信息失败: %v", err)
		}
		return Item{}, false
	}
	it.CreatedAt, it.UpdatedAt = time.Unix(created, 0), time.Unix(updated, 0)
	return it, true
}

// UpdateItem 保持原来「传入修改函数」的用法，内部改成「读出来 → 改 → 写回去」
//
// 返回值从 bool 改为 error，是为了区分两种性质完全不同的失败：
//   - ErrItemNotFound：这条记录不存在（业务事实，调用方应回 404）
//   - 其他 error：     数据库读写故障（系统故障，调用方应回 500）
//
// 原来两者都返回 false，调用方只能一并当成「没找到」，写库失败就被悄悄吞掉了。
func (s *Store) UpdateItem(id int64, fn func(it *Item)) (Item, error) {
	it, ok := s.GetItem(id)
	if !ok {
		return Item{}, ErrItemNotFound
	}
	fn(&it)
	it.UpdatedAt = time.Now()
	if _, err := s.db.Exec(
		`UPDATE items SET type = ?, title = ?, description = ?, place = ?, contact = ?,
		                  status = ?, updated_at = ? WHERE id = ?`,
		it.Type, it.Title, it.Description, it.Place, it.Contact,
		it.Status, it.UpdatedAt.Unix(), it.ID); err != nil {
		log.Printf("更新信息失败: %v", err)
		return Item{}, err // 原样上报，不再降级成 false
	}
	return it, nil
}
func (s *Store) DeleteItem(id int64) bool {
	res, err := s.db.Exec(`DELETE FROM items WHERE id = ?`, id)
	if err != nil {
		log.Printf("删除信息失败: %v", err)
		return false
	}
	n, _ := res.RowsAffected() // 影响行数为 0 说明这条本来就不存在
	return n > 0
}

// 对应 SQL 的 WHERE / ORDER BY / LIMIT / OFFSET
type SearchQuery struct {
	Keyword string // 任意字段 LIKE %keyword%
	Type    string // 精确匹配
	Status  string // 精确匹配
	OwnerID int64  // 0 表示不限
	SortBy  string // id / created_at / updated_at / title
	Order   string // asc / desc
	Limit   int
	Offset  int
}

// SearchItems 返回当前页数据 + 总数（用于前端分页）
func (s *Store) SearchItems(q SearchQuery) ([]Item, int) {
	// 1) WHERE 条件：值一律用 ? 占位符，SQL 片段只来自代码里写死的部分
	where := []string{"1=1"}
	args := []any{}
	// SQLite 的 LIKE 默认对 ASCII 大小写不敏感，和原来 Go 里 ToLower 的效果一致
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		pat := "%" + escapeLike(kw) + "%"
		where = append(where, `(i.title LIKE ? ESCAPE '\' OR i.description LIKE ? ESCAPE '\'
		                    OR i.place LIKE ? ESCAPE '\' OR i.contact LIKE ? ESCAPE '\')`)
		args = append(args, pat, pat, pat, pat)
	}
	if q.Type != "" {
		where = append(where, "i.type = ?")
		args = append(args, q.Type)
	}
	if q.Status != "" {
		where = append(where, "i.status = ?")
		args = append(args, q.Status)
	}
	if q.OwnerID != 0 {
		where = append(where, "i.owner_id = ?")
		args = append(args, q.OwnerID)
	}
	// 2) ORDER BY：列名只能从这个白名单里选，绝不能把用户输入直接拼进 SQL
	sortCol := "i.created_at"
	switch q.SortBy {
	case "id":
		sortCol = "i.id"
	case "updated_at":
		sortCol = "i.updated_at"
	case "title":
		sortCol = "i.title"
	}
	dir := "DESC"
	if strings.EqualFold(q.Order, "asc") {
		dir = "ASC"
	}
	// 3) LIMIT / OFFSET：保留原来的默认值和上限 100
	offset := q.Offset
	if offset < 0 {
		offset = 0
	}
	limit := q.Limit
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	// 4) 总数
	whereSQL := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM items i WHERE "+whereSQL, args...).
		Scan(&total); err != nil {
		log.Printf("统计信息失败: %v", err)
		return []Item{}, 0
	}
	// 5) 当前页数据（并列时再用 id 排一次，保证顺序稳定）
	listSQL := `SELECT i.id, i.owner_id, COALESCE(u.nickname, ''), i.type, i.title,
	                   i.description, i.place, i.contact, i.status,
	                   i.created_at, i.updated_at
	              FROM items i LEFT JOIN users u ON u.id = i.owner_id
	             WHERE ` + whereSQL +
		" ORDER BY " + sortCol + " " + dir + ", i.id " + dir +
		" LIMIT ? OFFSET ?"

	rows, err := s.db.Query(listSQL, append(args, limit, offset)...)
	if err != nil {
		log.Printf("查询信息失败: %v", err)
		return []Item{}, total
	}
	defer rows.Close() // 防止连接泄漏
	items := []Item{}  // 不能用 var items []Item，否则空结果会输出 null 而不是 []
	for rows.Next() {
		var it Item
		var created, updated int64
		if err := rows.Scan(&it.ID, &it.OwnerID, &it.OwnerName, &it.Type, &it.Title,
			&it.Description, &it.Place, &it.Contact, &it.Status,
			&created, &updated); err != nil {
			log.Printf("读取信息失败: %v", err)
			continue
		}
		it.CreatedAt, it.UpdatedAt = time.Unix(created, 0), time.Unix(updated, 0)
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		log.Printf("遍历信息失败: %v", err)
	}
	return items, total
}

// escapeLike 把用户输入里的 LIKE 通配符转义成普通字符
// 否则搜索 "50%" 时 % 会被当成通配符，把不相关的内容全查出来
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// 密码哈希
func hashPassword(pw string) string {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		panic(err)
	}
	sum := sha256.Sum256(append(salt, []byte(pw)...))
	return base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(sum[:])
}
func checkPassword(pw, stored string) bool {
	parts := strings.SplitN(stored, "$", 2)
	if len(parts) != 2 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	sum := sha256.Sum256(append(salt, []byte(pw)...))
	return hmac.Equal(sum[:], want)
}

// ---------------- JWT（HS256，标准库手写） ----------------
type Claims struct {
	UserID    int64  `json:"uid"`
	Username  string `json:"username"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

var errInvalidToken = errors.New("token 无效或已过期")

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
func signBody(body string) []byte {
	m := hmac.New(sha256.New, jwtSecret)
	m.Write([]byte(body))
	return m.Sum(nil)
}
func signToken(c Claims) string {
	payload, _ := json.Marshal(c)
	body := b64([]byte(`{"alg":"HS256","typ":"JWT"}`)) + "." + b64(payload)
	return body + "." + b64(signBody(body))
}
func parseToken(token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errInvalidToken
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, signBody(parts[0]+"."+parts[1])) {
		return nil, errInvalidToken
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errInvalidToken
	}
	var c Claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, errInvalidToken
	}
	if c.ExpiresAt < time.Now().Unix() {
		return nil, errors.New("token 已过期，请重新登录")
	}
	return &c, nil
}

// HTTP 层
type API struct {
	store *Store
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}
func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
func decode(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dst)
}

// writeStoreErr 把存储层的错误翻译成 HTTP 响应。

// 注意：对外只输出固定文案，原始错误已经在存储层写进服务端日志。
// 绝不把 err.Error() 拼进响应体——那会把表名、SQL 片段和数据库文件路径泄露给客户端。
func writeStoreErr(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrItemNotFound) {
		writeErr(w, http.StatusNotFound, "信息不存在")
		return
	}
	writeErr(w, http.StatusInternalServerError, "服务器内部错误，请稍后重试")
}

// currentUser 依次从 Cookie / Authorization: Bearer 中取 token，并校验会话
func (a *API) currentUser(r *http.Request) (*User, string, error) {
	token := ""
	if c, err := r.Cookie(tokenCookieName); err == nil {
		token = c.Value
	}
	if token == "" {
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			token = strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		}
	}
	if token == "" {
		return nil, "", errors.New("未登录")
	}
	claims, err := parseToken(token)
	if err != nil {
		return nil, "", err
	}
	// 服务端会话校验：退出登录后 token 立即失效
	if _, ok := a.store.GetSession(token); !ok {
		return nil, "", errors.New("会话已失效，请重新登录")
	}
	u, ok := a.store.FindUserByID(claims.UserID)
	if !ok {
		return nil, "", errors.New("用户不存在")
	}
	return u, token, nil
}
func (a *API) requireAuth(next func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, _, err := a.currentUser(r)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, err.Error())
			return
		}
		next(w, r, u)
	}
}

// 用户注册
func (a *API) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "请使用 POST")
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Nickname string `json:"nickname"`
		Email    string `json:"email"`
		Phone    string `json:"phone"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if len(req.Username) < 3 || len(req.Username) > 32 {
		writeErr(w, http.StatusBadRequest, "用户名长度需为 3~32 个字符")
		return
	}
	if len(req.Password) < 6 {
		writeErr(w, http.StatusBadRequest, "密码至少 6 位")
		return
	}
	u, err := a.store.CreateUser(req.Username, req.Password, req.Nickname, req.Email, req.Phone)
	if err != nil {
		// 只有「用户名已被占用」是对客户端有意义的业务信息，可以明说；
		// 其余（建表/写库/哈希等）失败一律收敛成固定文案的 500，原始错误只留在日志里。
		if errors.Is(err, errUserExists) {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		log.Printf("注册失败: %v", err)
		writeErr(w, http.StatusInternalServerError, "服务器内部错误，请稍后重试")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": u})
}

// 用户登录（返回 JWT + 写入 Cookie）
func (a *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "请使用 POST")
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}
	u, ok := a.store.FindUserByName(strings.TrimSpace(req.Username))
	if !ok || !checkPassword(req.Password, u.password) {
		writeErr(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	now := time.Now()
	token := signToken(Claims{
		UserID:    u.ID,
		Username:  u.Username,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(tokenTTL).Unix(),
	})
	a.store.CreateSession(token, u.ID) // Session：服务端可撤销
	http.SetCookie(w, &http.Cookie{
		Name:     tokenCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  now.Add(tokenTTL),
		MaxAge:   int(tokenTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"token_type": "Bearer",
		"expires_in": int(tokenTTL.Seconds()),
		"user":       u,
	})
}

// 退出登录
func (a *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "请使用 POST")
		return
	}
	if _, token, err := a.currentUser(r); err == nil {
		a.store.DeleteSession(token)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     tokenCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
	writeJSON(w, http.StatusOK, map[string]string{"message": "已退出登录"})
}

// 获取当前用户信息
func (a *API) handleMe(w http.ResponseWriter, r *http.Request, u *User) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "请使用 GET")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

// /api/items  ->  GET 列表/搜索，POST 创建
func (a *API) handleItems(w http.ResponseWriter, r *http.Request, u *User) {
	switch r.Method {
	case http.MethodGet:
		a.listItems(w, r, u)
	case http.MethodPost:
		a.createItem(w, r, u)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "请使用 GET 或 POST")
	}
}

// GET /api/items?keyword=钥匙&type=lost&status=searching&sort=created_at&order=desc&page=1&size=10
func (a *API) listItems(w http.ResponseWriter, r *http.Request, u *User) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(q.Get("size"))
	if size <= 0 || size > 100 {
		size = 10
	}
	sq := SearchQuery{
		Keyword: strings.TrimSpace(q.Get("keyword")),
		Type:    normalizeType(q.Get("type")),
		Status:  normalizeStatus(q.Get("status")),
		SortBy:  strings.ToLower(q.Get("sort")),
		Order:   strings.ToLower(q.Get("order")),
		Limit:   size,
		Offset:  (page - 1) * size,
	}
	if sq.SortBy == "" {
		sq.SortBy = "created_at"
	}
	if sq.Order == "" {
		sq.Order = "desc"
	}
	if v := q.Get("owner_id"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			sq.OwnerID = id
		}
	}
	if q.Get("mine") == "true" {
		if u == nil {
			writeErr(w, http.StatusUnauthorized, "请先登录")
			return
		}
		sq.OwnerID = u.ID
	}
	items, total := a.store.SearchItems(sq)
	writeJSON(w, http.StatusOK, map[string]any{
		"total": total,
		"page":  page,
		"size":  size,
		"items": items,
	})
}

// 创建失物招领信息
func (a *API) createItem(w http.ResponseWriter, r *http.Request, u *User) {
	var req struct {
		Type        string `json:"type"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Place       string `json:"place"`
		Contact     string `json:"contact"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}
	t := normalizeType(req.Type)
	if t == "" {
		writeErr(w, http.StatusBadRequest, "type 只能为 lost(失物) 或 found(招领)")
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeErr(w, http.StatusBadRequest, "title 不能为空")
		return
	}
	it, err := a.store.CreateItem(u, Item{
		Type:        t,
		Title:       strings.TrimSpace(req.Title),
		Description: req.Description,
		Place:       req.Place,
		Contact:     req.Contact,
		Status:      StatusSearching, // 新建默认“寻找中”
	})
	if err != nil {
		writeStoreErr(w, err) // 写库失败绝不能回 201
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": it})
}

// /api/items/{id}         -> GET 查看 / PUT 修改自己的 / DELETE 删除自己的
// /api/items/{id}/status  -> PATCH 修改状态（寻找中 -> 已找到）
func (a *API) handleItemByID(w http.ResponseWriter, r *http.Request, u *User) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/items/"), "/")
	if rest == "" {
		writeErr(w, http.StatusNotFound, "路径不存在")
		return
	}
	parts := strings.Split(rest, "/")
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "id 必须是数字")
		return
	}
	if len(parts) == 2 && parts[1] == "status" {
		if r.Method != http.MethodPatch && r.Method != http.MethodPut {
			writeErr(w, http.StatusMethodNotAllowed, "请使用 PATCH")
			return
		}
		a.updateItemStatus(w, r, u, id)
		return
	}
	if len(parts) != 1 {
		writeErr(w, http.StatusNotFound, "路径不存在")
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.getItem(w, id)
	case http.MethodPut, http.MethodPatch:
		a.updateItem(w, r, u, id)
	case http.MethodDelete:
		a.deleteItem(w, u, id)
	default:
		writeErr(w, http.StatusMethodNotAllowed, "请使用 GET / PUT / DELETE")
	}
}

// 查看信息
func (a *API) getItem(w http.ResponseWriter, id int64) {
	it, ok := a.store.GetItem(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "信息不存在")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": it})
}

// 修改信息
func (a *API) updateItem(w http.ResponseWriter, r *http.Request, u *User, id int64) {
	cur, ok := a.store.GetItem(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "信息不存在")
		return
	}
	if cur.OwnerID != u.ID {
		writeErr(w, http.StatusForbidden, "只能修改自己发布的信息")
		return
	}
	var req struct {
		Type        *string `json:"type"`
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Place       *string `json:"place"`
		Contact     *string `json:"contact"`
		Status      *string `json:"status"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}
	var badStatus string
	updated, err := a.store.UpdateItem(id, func(it *Item) {
		if req.Type != nil {
			if t := normalizeType(*req.Type); t != "" {
				it.Type = t
			}
		}
		if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
			it.Title = strings.TrimSpace(*req.Title)
		}
		if req.Description != nil {
			it.Description = *req.Description
		}
		if req.Place != nil {
			it.Place = *req.Place
		}
		if req.Contact != nil {
			it.Contact = *req.Contact
		}
		if req.Status != nil {
			s := normalizeStatus(*req.Status)
			if s == "" || !canTransition(it.Status, s) {
				badStatus = fmt.Sprintf("状态不能从 %s 变更为 %s", statusText(it.Status), statusText(*req.Status))
				return
			}
			it.Status = s
		}
	})
	if badStatus != "" {
		writeErr(w, http.StatusBadRequest, badStatus)
		return
	}
	if err != nil {
		writeStoreErr(w, err) // 写库失败回 500，而不是拿着零值 item 谎报 200
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": updated})
}

// 删除信息
func (a *API) deleteItem(w http.ResponseWriter, u *User, id int64) {
	it, ok := a.store.GetItem(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "信息不存在")
		return
	}
	if it.OwnerID != u.ID {
		writeErr(w, http.StatusForbidden, "只能删除自己发布的信息")
		return
	}
	a.store.DeleteItem(id)
	writeJSON(w, http.StatusOK, map[string]string{"message": "已删除"})
}

// 标记为“已找到”等
func (a *API) updateItemStatus(w http.ResponseWriter, r *http.Request, u *User, id int64) {
	cur, ok := a.store.GetItem(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "信息不存在")
		return
	}
	if cur.OwnerID != u.ID {
		writeErr(w, http.StatusForbidden, "只能修改自己发布的信息")
		return
	}

	var req struct {
		Status string `json:"status"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}
	to := normalizeStatus(req.Status)
	if to == "" {
		writeErr(w, http.StatusBadRequest, "status 只能为 searching(寻找中) / found(已找到) / closed(已关闭)")
		return
	}
	if !canTransition(cur.Status, to) {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("状态不能从 %s 变更为 %s", statusText(cur.Status), statusText(to)))
		return
	}

	updated, err := a.store.UpdateItem(id, func(it *Item) { it.Status = to })
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": updated})
}

// 路由
func (a *API) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/register", a.handleRegister)
	mux.HandleFunc("/api/login", a.handleLogin)
	mux.HandleFunc("/api/logout", a.handleLogout)
	mux.HandleFunc("/api/me", a.requireAuth(a.handleMe))
	mux.HandleFunc("/api/items", a.requireAuth(a.handleItems))
	mux.HandleFunc("/api/items/", a.requireAuth(a.handleItemByID))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			writeErr(w, http.StatusNotFound, "路径不存在")
			return
		}
		fmt.Fprintln(w, "失物招领平台 API：POST /api/register /api/login /api/logout，GET /api/me，GET|POST /api/items，GET|PUT|DELETE /api/items/{id}，PATCH /api/items/{id}/status")
	})
	return mux
}
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.RequestURI(), time.Since(start))
	})
}

// 数据库文件默认放在「运行命令时所在的目录」，可用 DB_PATH 环境变量指定别的位置
func dbPath() string {
	return env("DB_PATH", "lostfound.db")
}
func main() {
	// 打开数据库
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", dbPath())
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	// sql.Open 只是解析参数、并不会真的连接，Ping 一次才能早点发现配置问题
	if err := db.Ping(); err != nil {
		log.Fatal("连不上数据库: ", err)
	}
	// 建表（已存在则跳过）
	if err := initSchema(db); err != nil {
		log.Fatal("初始化表结构失败: ", err)
	}
	api := &API{store: NewStore(db)}
	addr := env("ADDR", ":8080")
	srv := &http.Server{
		Addr:              addr,
		Handler:           logging(api.routes()),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("数据库文件：%s", dbPath())
	log.Printf("服务已启动：http://localhost%s", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
