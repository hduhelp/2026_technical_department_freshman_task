// Package store 是数据存储层：用内存 map 保存数据，
// 每次有修改就同步写入 data.json，所以重启程序后数据不会丢失，
// 对于新手来说不需要安装任何数据库。
package store

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"campus-lost-found/models"
)

// 自定义的错误，handler 层可以根据错误类型返回不同的提示
var (
	ErrNotFound   = errors.New("记录不存在")
	ErrForbidden  = errors.New("无权操作他人发布的信息")
	ErrUserExists = errors.New("用户名已存在")
)

// storedUser 是写入 data.json 时使用的用户结构。
// 注意：models.User 的 Password 字段标记了 json:"-"（接口永远不返回密码），
// 但持久化时必须保存密码哈希，所以存储层单独定义这个结构。
type storedUser struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Password  string    `json:"password"` // bcrypt 哈希，只存在数据文件里，不会通过接口返回
	Phone     string    `json:"phone"`
	CreatedAt time.Time `json:"created_at"`
}

// snapshot 是 data.json 文件里保存的内容格式
type snapshot struct {
	Users      []storedUser   `json:"users"`
	Items      []*models.Item `json:"items"`
	NextUserID int64          `json:"next_user_id"`
	NextItemID int64          `json:"next_item_id"`
}

// Store 存储对象，所有方法都加了锁，多个请求同时访问也安全
type Store struct {
	mu         sync.RWMutex
	users      map[int64]*models.User
	items      map[int64]*models.Item
	nextUserID int64
	nextItemID int64
	blacklist  map[string]struct{} // 已退出登录的 token 黑名单（仅保存在内存中）
	filePath   string
}

// NewStore 创建存储并从文件加载历史数据
func NewStore(filePath string) (*Store, error) {
	s := &Store{
		users:      make(map[int64]*models.User),
		items:      make(map[int64]*models.Item),
		blacklist:  make(map[string]struct{}),
		nextUserID: 1,
		nextItemID: 1,
		filePath:   filePath,
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// load 从 JSON 文件读取数据
func (s *Store) load() error {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 文件不存在说明是第一次运行，直接用空数据
		}
		return err
	}

	var snap snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, su := range snap.Users {
		// 把存储结构转换成内存中的 models.User
		s.users[su.ID] = &models.User{
			ID:        su.ID,
			Username:  su.Username,
			Password:  su.Password,
			Phone:     su.Phone,
			CreatedAt: su.CreatedAt,
		}
	}
	for _, it := range snap.Items {
		s.items[it.ID] = it
	}
	s.nextUserID = snap.NextUserID
	s.nextItemID = snap.NextItemID
	if s.nextUserID <= 0 {
		s.nextUserID = 1
	}
	if s.nextItemID <= 0 {
		s.nextItemID = 1
	}
	return nil
}

// persist 把当前数据写入 JSON 文件（调用时必须已经持有锁）
func (s *Store) persist() {
	snap := snapshot{NextUserID: s.nextUserID, NextItemID: s.nextItemID}
	for _, u := range s.users {
		// 把内存中的 models.User 转换成存储结构（包含密码哈希）
		snap.Users = append(snap.Users, storedUser{
			ID:        u.ID,
			Username:  u.Username,
			Password:  u.Password,
			Phone:     u.Phone,
			CreatedAt: u.CreatedAt,
		})
	}
	for _, it := range s.items {
		snap.Items = append(snap.Items, it)
	}

	data, err := json.MarshalIndent(&snap, "", "  ")
	if err != nil {
		log.Printf("数据序列化失败: %v", err)
		return
	}
	if err := os.WriteFile(s.filePath, data, 0644); err != nil {
		log.Printf("写入数据文件失败: %v", err)
	}
}

// ---------------- 用户相关 ----------------

// CreateUser 创建用户，用户名重复时返回 ErrUserExists
func (s *Store) CreateUser(u *models.User) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, ex := range s.users {
		if ex.Username == u.Username {
			return nil, ErrUserExists
		}
	}

	u.ID = s.nextUserID
	s.nextUserID++
	u.CreatedAt = time.Now()
	s.users[u.ID] = u
	s.persist()
	return u, nil
}

// GetUserByUsername 按用户名查找
func (s *Store) GetUserByUsername(username string) (*models.User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.users {
		if u.Username == username {
			return u, true
		}
	}
	return nil, false
}

// GetUserByID 按编号查找
func (s *Store) GetUserByID(id int64) (*models.User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[id]
	return u, ok
}

// ---------------- 失物 / 招领信息相关 ----------------

// CreateItem 创建一条信息
func (s *Store) CreateItem(it *models.Item) *models.Item {
	s.mu.Lock()
	defer s.mu.Unlock()

	it.ID = s.nextItemID
	s.nextItemID++
	now := time.Now()
	it.CreatedAt = now
	it.UpdatedAt = now
	if it.Status == "" {
		it.Status = models.StatusSearching
	}
	s.items[it.ID] = it
	s.persist()
	return it
}

// GetItem 按编号查找一条信息
func (s *Store) GetItem(id int64) (*models.Item, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	it, ok := s.items[id]
	return it, ok
}

// ListItems 按条件查询信息列表，结果按发布时间倒序（最新的在前）
// keyword 在标题、描述、地点中模糊匹配；itemType / status 为空表示不过滤
func (s *Store) ListItems(keyword, itemType, status string) []*models.Item {
	s.mu.RLock()
	defer s.mu.RUnlock()

	kw := strings.ToLower(strings.TrimSpace(keyword))
	result := make([]*models.Item, 0)
	for _, it := range s.items {
		if itemType != "" && string(it.Type) != itemType {
			continue
		}
		if status != "" && string(it.Status) != status {
			continue
		}
		if kw != "" {
			haystack := strings.ToLower(it.Title + " " + it.Description + " " + it.Location)
			if !strings.Contains(haystack, kw) {
				continue
			}
		}
		result = append(result, it)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result
}

// ItemUpdate 表示要修改的字段，指针为 nil 表示该字段不修改
type ItemUpdate struct {
	Type        *models.ItemType
	Title       *string
	Description *string
	Location    *string
	Contact     *string
	Status      *models.ItemStatus
}

// UpdateItem 修改一条信息，只有发布者本人可以修改
func (s *Store) UpdateItem(id, userID int64, upd ItemUpdate) (*models.Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	it, ok := s.items[id]
	if !ok {
		return nil, ErrNotFound
	}
	if it.UserID != userID {
		return nil, ErrForbidden
	}

	if upd.Type != nil {
		it.Type = *upd.Type
	}
	if upd.Title != nil {
		it.Title = *upd.Title
	}
	if upd.Description != nil {
		it.Description = *upd.Description
	}
	if upd.Location != nil {
		it.Location = *upd.Location
	}
	if upd.Contact != nil {
		it.Contact = *upd.Contact
	}
	if upd.Status != nil {
		it.Status = *upd.Status
	}
	it.UpdatedAt = time.Now()

	s.persist()
	return it, nil
}

// DeleteItem 删除一条信息，只有发布者本人可以删除
func (s *Store) DeleteItem(id, userID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	it, ok := s.items[id]
	if !ok {
		return ErrNotFound
	}
	if it.UserID != userID {
		return ErrForbidden
	}

	delete(s.items, id)
	s.persist()
	return nil
}

// ---------------- 登录黑名单（退出登录） ----------------

// AddBlacklist 把一个 token 加入黑名单
func (s *Store) AddBlacklist(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blacklist[token] = struct{}{}
}

// IsBlacklisted 判断 token 是否在黑名单中
func (s *Store) IsBlacklisted(token string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.blacklist[token]
	return ok
}
