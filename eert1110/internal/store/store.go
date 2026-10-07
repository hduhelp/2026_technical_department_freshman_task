package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"sync"
	"time"

	"lost-and-found/internal/model"
)

var (
	ErrUserExists   = errors.New("用户名已存在")
	ErrItemNotFound = errors.New("遗失物不存在")
)

// persisted 数据文件的顶层结构
type persisted struct {
	Users []model.User `json:"users"`
	Items []model.Item `json:"items"`
}

// Store 基于 JSON 文件的内存数据存储，带读写锁保证并发安全。
// 所有修改会立即持久化到磁盘，可通过实现相同接口替换为数据库。
type Store struct {
	mu       sync.RWMutex
	path     string
	users    map[string]model.User // userID -> user
	items    map[string]model.Item // itemID -> item
	username map[string]string     // username -> userID
	sessions map[string]string     // token -> userID（会话存内存，重启后需重新登录）
}

func New(path string) (*Store, error) {
	s := &Store{
		path:     path,
		users:    make(map[string]model.User),
		items:    make(map[string]model.Item),
		username: make(map[string]string),
		sessions: make(map[string]string),
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 首次启动，数据文件尚不存在
		}
		return err
	}
	var p persisted
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	for _, u := range p.Users {
		s.users[u.ID] = u
		s.username[u.Username] = u.ID
	}
	for _, it := range p.Items {
		s.items[it.ID] = it
	}
	return nil
}

// save 将当前数据写入磁盘（调用方需持有锁）。
func (s *Store) save() error {
	p := persisted{
		Users: make([]model.User, 0, len(s.users)),
		Items: make([]model.Item, 0, len(s.items)),
	}
	for _, u := range s.users {
		p.Users = append(p.Users, u)
	}
	for _, it := range s.items {
		p.Items = append(p.Items, it)
	}
	// 按创建时间排序，保证文件内容稳定
	sort.Slice(p.Users, func(i, j int) bool { return p.Users[i].CreatedAt.Before(p.Users[j].CreatedAt) })
	sort.Slice(p.Items, func(i, j int) bool { return p.Items[i].CreatedAt.Before(p.Items[j].CreatedAt) })

	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}

// ---------- 用户 ----------

func (s *Store) CreateUser(username, passwordHash string) (model.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.username[username]; ok {
		return model.User{}, ErrUserExists
	}
	u := model.User{
		ID:           newID(),
		Username:     username,
		PasswordHash: passwordHash,
		CreatedAt:    time.Now().UTC(),
	}
	s.users[u.ID] = u
	s.username[u.Username] = u.ID
	if err := s.save(); err != nil {
		return model.User{}, err
	}
	return u, nil
}

func (s *Store) GetUserByUsername(username string) (model.User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.username[username]
	if !ok {
		return model.User{}, false
	}
	u, ok := s.users[id]
	return u, ok
}

func (s *Store) GetUserByID(id string) (model.User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[id]
	return u, ok
}

// ---------- 遗失物 ----------

func (s *Store) CreateItem(item model.Item) (model.Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	item.ID = newID()
	item.CreatedAt = now
	item.UpdatedAt = now
	if item.Status == "" {
		item.Status = model.StatusUnclaimed
	}
	if u, ok := s.users[item.PublisherID]; ok {
		item.PublisherName = u.Username
	}
	s.items[item.ID] = item
	if err := s.save(); err != nil {
		return model.Item{}, err
	}
	return item, nil
}

func (s *Store) ListItems() []model.Item {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]model.Item, 0, len(s.items))
	for _, it := range s.items {
		items = append(items, it)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt.After(items[j].CreatedAt) // 最新发布在前
	})
	return items
}

func (s *Store) GetItem(id string) (model.Item, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	it, ok := s.items[id]
	return it, ok
}

// UpdateItem 更新已存在的遗失物，保留发布者与创建时间，刷新更新时间。
func (s *Store) UpdateItem(item model.Item) (model.Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cur, ok := s.items[item.ID]
	if !ok {
		return model.Item{}, ErrItemNotFound
	}
	item.CreatedAt = cur.CreatedAt
	item.PublisherID = cur.PublisherID
	item.PublisherName = cur.PublisherName
	item.UpdatedAt = time.Now().UTC()
	s.items[item.ID] = item
	if err := s.save(); err != nil {
		return model.Item{}, err
	}
	return item, nil
}

func (s *Store) DeleteItem(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.items[id]; !ok {
		return ErrItemNotFound
	}
	delete(s.items, id)
	return s.save()
}

// ---------- 会话 ----------

func (s *Store) CreateSession(token, userID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[token] = userID
}

func (s *Store) GetSession(token string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.sessions[token]
	return id, ok
}

func (s *Store) DeleteSession(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
}

// newID 生成 16 字节随机 ID（32 位十六进制字符串）。
func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
