package main

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// 建立/连接数据库
var DB *sql.DB

func initDB() {
	var err error
	DB, err = sql.Open("sqlite", "./lostfound.db") // ★ 驱动名 "sqlite"
	if err != nil {
		log.Fatal("打开数据库失败:", err)
	}
	if err := DB.Ping(); err != nil { // ★ Ping 才是真去连一下
		log.Fatal("连接数据库失败:", err)
	}

	schema := `
	CREATE TABLE IF NOT EXISTS users (
		user_id    INTEGER PRIMARY KEY AUTOINCREMENT,
		username   TEXT NOT NULL UNIQUE,
		password   TEXT NOT NULL,
		created_at TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS items (
		item_id      INTEGER PRIMARY KEY AUTOINCREMENT,
		publisher    TEXT NOT NULL,
		user_id      INTEGER NOT NULL,
		type         TEXT NOT NULL,
		title        TEXT NOT NULL,
		place        TEXT NOT NULL,
		happened_at  TEXT,
		description  TEXT NOT NULL,
		contact_info TEXT NOT NULL,
		image        TEXT,
		status       TEXT NOT NULL DEFAULT 'searching',
		created_at   TEXT NOT NULL
	);`
	if _, err := DB.Exec(schema); err != nil {
		log.Fatal("建表失败:", err)
	}
}

/*
失物招领该有：
1:ID
2:发布者
3:发布者ID
4:类型(寻物/招领)
5:失物地点
6:发生时间
7:描述
8:联系方式
9:状态
10:发布时间
失物
*/

type Item struct { //储存用
	ItemID      int    `json:"item_id"`
	Publisher   string `json:"publisher"`
	UserID      int    `json:"user_id"`
	Type        string `json:"type"`
	Title       string `json:"title"` //物品类型
	Place       string `json:"place"`
	HappenedAt  string `json:"happened_at"`
	Description string `json:"description"`
	ContactInfo string `json:"contact_info"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
	Image       string `json:"image"`
}
type ItemResp struct {
	ItemID    int    `json:"item_id"`
	Publisher string `json:"publisher"`
	Type      string `json:"type"`
	Title     string `json:"title"`
	Place     string `json:"place"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
	Image     string `json:"image"`
}
type ItemCreateReq struct {
	Type        string `json:"type"`
	Title       string `json:"title"`
	Place       string `json:"place"`
	HappenedAt  string `json:"happened_at"`
	Description string `json:"description"`
	ContactInfo string `json:"contact_info"`
	Image       string `json:"image"`
}
type ItemUpdateReq struct {
	Type        string `json:"type"`
	Title       string `json:"title"`
	Place       string `json:"place"`
	HappenedAt  string `json:"happened_at"`
	Description string `json:"description"`
	ContactInfo string `json:"contact_info"`
	Status      string `json:"status"`
	Image       string `json:"image"`
}

/*
用户应有：
用户名
ID
密码
*/

type User struct {
	UserID    int    `json:"user_id"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	CreatedAt string `json:"created_at"`
}
type UserLoginReq struct { //登录输入
	Username string `json:"username"`
	Password string `json:"password"`
}
type UserResp struct { //登录输出响应
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
}
type RegisterReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

var jwtKey = []byte(os.Getenv("JWT_KEY")) //密钥储存在环境变量里面
const UploadDir = "./uploads"

// 将items简洁输出，舍去私密信息
func toResp(it Item) ItemResp {
	return ItemResp{
		ItemID:    it.ItemID,
		Publisher: it.Publisher,
		Type:      it.Type,
		Title:     it.Title,
		Place:     it.Place,
		Status:    it.Status,
		CreatedAt: it.CreatedAt,
		Image:     it.Image,
	}
}

func UsertoResp(user User) UserResp {
	return UserResp{
		UserID:   user.UserID,
		Username: user.Username,
	}
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		//★ 客户端发的是 "Bearer eyJhbGci..." → 要【去掉 "Bearer " 前缀】
		if !strings.HasPrefix(auth, "Bearer ") {
			c.AbortWithStatusJSON(401, gin.H{"ok": false, "msg": "未认证"})
			return
		}
		tokenStr := auth[len("Bearer "):]
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			// ★ 养成习惯：检查算法（防 alg 混淆攻击）
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("意外的签名算法")
			}
			return jwtKey, nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(401, gin.H{"ok": false, "msg": "未认证"})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(401, gin.H{"ok": false, "msg": "未认证"})
			return
		}

		uidFloat, ok := claims["user_id"].(float64)
		if !ok {
			c.AbortWithStatusJSON(401, gin.H{"ok": false, "msg": "未认证"})
			return
		}
		uid := int(uidFloat)
		var us User
		err = DB.QueryRow("SELECT user_id, username FROM users WHERE user_id = ?", uid).
			Scan(&us.UserID, &us.Username)
		if err != nil { // ★ ErrNoRows 或别的错 → 一律 401
			c.AbortWithStatusJSON(401, gin.H{"ok": false, "msg": "未认证"})
			return
		}

		c.Set("username", us.Username)
		c.Set("user_id", us.UserID)
		c.Next()
	}
}

func validateItemReq(itemType, title, place, description, contactInfo string) string {
	if itemType != "招领" && itemType != "丢失" {
		return "帖子类型应为招领或丢失"
	}
	if title == "" {
		return "物品名不能为空"
	}
	if place == "" {
		return "位置不能为空"
	}
	if description == "" {
		return "描述不能为空"
	}
	if contactInfo == "" {
		return "联系方式不能为空"
	}
	return ""
}

func main() {
	initDB()

	err := os.MkdirAll(UploadDir, 0755)
	if err != nil {
		return
	}
	r := gin.Default()

	r.GET("/hello", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"msg": "hello"})
	})

	r.GET("/items", func(c *gin.Context) {
		// ① 读参数
		typeQ := c.Query("type")
		keyword := c.Query("keyword")

		// ② 排序（白名单）
		orderSQL := "DESC"
		if c.DefaultQuery("order", "desc") == "asc" {
			orderSQL = "ASC"
		}

		// ③ 分页 + 修正
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		size, _ := strconv.Atoi(c.DefaultQuery("size", "10"))
		if page < 1 {
			page = 1
		}
		if size < 1 || size > 100 {
			size = 10
		}
		offset := (page - 1) * size

		// ④ 动态 WHERE
		where := []string{}
		args := []any{}
		if typeQ != "" {
			where = append(where, "type = ?")
			args = append(args, typeQ)
		}
		if keyword != "" {
			where = append(where, "(title LIKE ? OR description LIKE ?)")
			args = append(args, "%"+keyword+"%", "%"+keyword+"%")
		}
		whereSQL := ""
		if len(where) > 0 {
			whereSQL = " WHERE " + strings.Join(where, " AND ")
			//变成了 WHERE type = ? AND (title LIKE ? OR description LIKE ?
		}

		// ⑤ 总数（只带过滤参数）
		var total int
		if err := DB.QueryRow("SELECT COUNT(*) FROM items"+whereSQL, args...).Scan(&total); err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		// ⑥ 当页（过滤 + 分页）
		pageSQL := `SELECT item_id, publisher, user_id, type, title, place,
                       happened_at, description, contact_info, image, status, created_at
                FROM items` + whereSQL + ` ORDER BY created_at ` + orderSQL + ` LIMIT ? OFFSET ?`
		//语句变为SELECT item_id, publisher, user_id, type, title, place, happened_at, description, contact_info, image, status, created_at
		//      FROM items WHERE type = ? AND (title LIKE ? OR description LIKE ?) ORDER BY created_at ASC/DESC LIMIT ? OFFSET ?
		args = append(args, size, offset)
		rows, err := DB.Query(pageSQL, args...) //输入row
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}
		defer rows.Close()

		// ⑦ 遍历
		out := make([]ItemResp, 0, size)
		for rows.Next() {
			var it Item
			if err := rows.Scan(&it.ItemID, &it.Publisher, &it.UserID, &it.Type,
				&it.Title, &it.Place, &it.HappenedAt, &it.Description,
				&it.ContactInfo, &it.Image, &it.Status, &it.CreatedAt); err != nil { //这里将rows输入给it
				c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
				return
			}
			out = append(out, toResp(it))
		}
		if err := rows.Err(); err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		c.JSON(200, gin.H{"ok": true, "data": out, "total": total, "page": page, "size": size})
	})

	//根据id获取详情信息
	r.GET("/items/:id", func(c *gin.Context) {
		idStr := c.Param("id")
		id, err := strconv.Atoi(idStr) //保证ID为整数
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "msg": "id应该为数字！"})
			return
		}
		var it Item
		row := DB.QueryRow(`SELECT item_id, publisher, user_id, type, title, place,
       		happened_at, description, contact_info, image, status, created_at 
			FROM items WHERE item_id = ?`, id)

		err = row.Scan(&it.ItemID, &it.Publisher, &it.UserID, &it.Type,
			&it.Title, &it.Place, &it.HappenedAt, &it.Description,
			&it.ContactInfo, &it.Image, &it.Status, &it.CreatedAt)

		if err != nil {
			if errors.Is(err, sql.ErrNoRows) { // ★ 查不到走这里
				c.JSON(404, gin.H{"ok": false, "msg": "没有这条"})
				return
			}
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		c.JSON(200, gin.H{"ok": true, "data": it})
		return
	})

	r.GET("/me", AuthMiddleware(), func(c *gin.Context) {
		c.JSON(200, gin.H{
			"ok": true,
			"data": gin.H{
				"user_id":  c.GetInt("user_id"),
				"username": c.GetString("username"),
			},
		})
	})

	r.GET("/my/items", AuthMiddleware(), func(c *gin.Context) {
		uid := c.GetInt("user_id")
		// ① 读参数
		typeQ := c.Query("type")
		keyword := c.Query("keyword")

		// ② 排序（白名单）
		orderSQL := "DESC"
		if c.DefaultQuery("order", "desc") == "asc" {
			orderSQL = "ASC"
		}

		// ③ 分页 + 修正
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		size, _ := strconv.Atoi(c.DefaultQuery("size", "10"))
		if page < 1 {
			page = 1
		}
		if size < 1 || size > 100 {
			size = 10
		}
		offset := (page - 1) * size

		// ④ 动态 WHERE
		where := []string{}
		args := []any{}
		where = append(where, "user_id = ?") // ★★ 无条件加（这就是"只看自己的"）
		args = append(args, uid)

		if typeQ != "" {
			where = append(where, "type = ?")
			args = append(args, typeQ)
		}
		if keyword != "" {
			where = append(where, "(title LIKE ? OR description LIKE ?)")
			args = append(args, "%"+keyword+"%", "%"+keyword+"%")
		}
		whereSQL := ""
		if len(where) > 0 {
			whereSQL = " WHERE " + strings.Join(where, " AND ")
			//变成了 WHERE type = ? AND (title LIKE ? OR description LIKE ?
		}

		// ⑤ 总数（只带过滤参数）
		var total int
		if err := DB.QueryRow("SELECT COUNT(*) FROM items"+whereSQL, args...).Scan(&total); err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		// ⑥ 当页（过滤 + 分页）
		pageSQL := `SELECT item_id, publisher, user_id, type, title, place,
                       happened_at, description, contact_info, image, status, created_at
                FROM items` + whereSQL + ` ORDER BY created_at ` + orderSQL + ` LIMIT ? OFFSET ?`
		//语句变为SELECT item_id, publisher, user_id, type, title, place, happened_at, description, contact_info, image, status, created_at
		//      FROM items WHERE type = ? AND (title LIKE ? OR description LIKE ?) ORDER BY created_at ASC/DESC LIMIT ? OFFSET ?
		args = append(args, size, offset)
		rows, err := DB.Query(pageSQL, args...) //输入row
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}
		defer rows.Close()

		// ⑦ 遍历
		out := make([]ItemResp, 0, size)
		for rows.Next() {
			var it Item
			if err := rows.Scan(&it.ItemID, &it.Publisher, &it.UserID, &it.Type,
				&it.Title, &it.Place, &it.HappenedAt, &it.Description,
				&it.ContactInfo, &it.Image, &it.Status, &it.CreatedAt); err != nil { //这里将rows输入给it
				c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
				return
			}
			out = append(out, toResp(it))
		}
		if err := rows.Err(); err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		c.JSON(200, gin.H{"ok": true, "data": out, "total": total, "page": page, "size": size})
	})

	r.POST("/items", AuthMiddleware(), func(c *gin.Context) {
		var req ItemCreateReq
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"ok": false, "msg": "请求体格式不对"})
			return
		}
		if msg := validateItemReq(req.Type, req.Title, req.Place, req.Description, req.ContactInfo); msg != "" {
			c.JSON(400, gin.H{"ok": false, "msg": msg})
			return
		}
		if req.HappenedAt == "" {
			req.HappenedAt = time.Now().Format("2006-01-02 15:04:05")
		}

		createdAt := time.Now().Format("2006-01-02 15:04:05")
		uid := c.GetInt("user_id")
		username := c.GetString("username")

		res, err := DB.Exec(`
   			INSERT INTO items (publisher, user_id, type, title, place,
                       happened_at, description, contact_info, image, status, created_at)
    		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			username, uid, req.Type, req.Title, req.Place,
			req.HappenedAt, req.Description, req.ContactInfo, req.Image, "searching", createdAt)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		id, err := res.LastInsertId()
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		it := Item{
			ItemID:      int(id),
			Publisher:   username,
			UserID:      uid,
			Type:        req.Type,
			Title:       req.Title,
			Place:       req.Place,
			HappenedAt:  req.HappenedAt,
			Description: req.Description,
			ContactInfo: req.ContactInfo,
			Status:      "searching",
			CreatedAt:   createdAt,
			Image:       req.Image,
		}

		c.JSON(201, gin.H{"ok": true, "data": it}) //创造成功
	})

	r.POST("/register", func(c *gin.Context) {
		var req RegisterReq
		//检查用户名和密码是否合法
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"ok": false, "msg": "请求体格式不对"})
			return
		}
		if req.Username == "" {
			c.JSON(400, gin.H{"ok": false, "msg": "用户名不能为空"})
			return
		}
		if len(req.Password) < 6 {
			c.JSON(400, gin.H{"ok": false, "msg": "密码不能少于6个"})
			return
		}

		var existID int
		err := DB.QueryRow("SELECT user_id FROM users WHERE username = ?", req.Username).Scan(&existID) //existID = user_id
		if err == nil {
			c.JSON(409, gin.H{"ok": false, "msg": "用户名已存在"})
			return
		}
		if !errors.Is(err, sql.ErrNoRows) { // ★ 不是"没找到" → 真出错了
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		//哈希
		hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		createdAt := time.Now().Format("2006-01-02 15:04:05")
		res, err := DB.Exec(`INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)`,
			req.Username, string(hashed), createdAt)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}
		id, _ := res.LastInsertId()

		//注册user
		us := User{
			UserID:    int(id),
			Username:  req.Username,
			Password:  string(hashed),
			CreatedAt: createdAt,
		}

		c.JSON(201, gin.H{"ok": true, "data": gin.H{"user_id": us.UserID, "username": us.Username}})
	})

	/*keyStr := os.Getenv("JWT_KEY")
	if keyStr == "" {
		log.Fatal("没设置 JWT_KEY 环境变量")
	}*/
	r.POST("/login", func(c *gin.Context) {
		var req UserLoginReq
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"ok": false, "msg": "请求体格式不对"})
			return
		} else if req.Username == "" {
			c.JSON(400, gin.H{"ok": false, "msg": "密码或用户名错误"})
			return
		} else if req.Password == "" {
			c.JSON(400, gin.H{"ok": false, "msg": "密码或用户名错误"})
			return
		}

		//查用户
		var us User
		err := DB.QueryRow("SELECT user_id, username, password, created_at FROM users WHERE username = ?",
			req.Username).Scan(&us.UserID, &us.Username, &us.Password, &us.CreatedAt)
		if err != nil {
			c.JSON(401, gin.H{"ok": false, "msg": "用户名或密码错误"})
			return
		}

		//查密码
		if err := bcrypt.CompareHashAndPassword([]byte(us.Password), []byte(req.Password)); err != nil {
			c.JSON(401, gin.H{"ok": false, "msg": "用户名或密码错误"})
			return
		}

		claims := jwt.MapClaims{
			"user_id":  us.UserID,
			"username": us.Username,
			"exp":      time.Now().Add(time.Hour * 24).Unix(),
		}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		signed, err := token.SignedString(jwtKey)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}
		c.JSON(200, gin.H{"ok": true, "token": signed})
		return
	})

	/*
		r.GET("/user", func(c *gin.Context) {
			c.JSON(200, gin.H{"ok": true, "data": users})
		})
	*/

	r.PUT("/items/:id", AuthMiddleware(), func(c *gin.Context) {
		id, err := strconv.Atoi(c.Param("id")) //保证id为整数
		if err != nil {
			c.JSON(400, gin.H{"ok": false, "msg": "id应该为数字！"})
			return
		}

		var req ItemUpdateReq
		if err := c.ShouldBindJSON(&req); err != nil { //最后看格式 403->400
			c.JSON(400, gin.H{"ok": false, "msg": "请求体格式不对"})
			return
		}
		if msg := validateItemReq(req.Type, req.Title, req.Place, req.Description, req.ContactInfo); msg != "" {
			c.JSON(400, gin.H{"ok": false, "msg": msg})
			return
		}

		var ownerID int
		var image string
		err = DB.QueryRow(`SELECT user_id,image FROM items WHERE item_id = ?`, id).Scan(&ownerID, &image)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				c.JSON(404, gin.H{"ok": false, "msg": "没找到该信息"})
				return
			}
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}
		if ownerID != c.GetInt("user_id") {
			c.JSON(403, gin.H{"ok": false, "msg": "无权修改"})
			return
		}

		if req.Image != "" {
			path := filepath.Join(UploadDir, filepath.Base(image))
			if err := os.Remove(path); err != nil {
				log.Println("删图片失败:", err) // ★ 不影响下面的修改
			}
		} else {
			req.Image = image
		}

		_, err = DB.Exec(`
			UPDATE items SET type = ?, title = ?, place = ?, happened_at = ?,
							 description = ?, contact_info = ?, image = ?, status = ?
			WHERE item_id = ?`,
			req.Type, req.Title, req.Place, req.HappenedAt,
			req.Description, req.ContactInfo, req.Image, req.Status, id)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		var it Item
		err = DB.QueryRow(`SELECT item_id, publisher, user_id, type, title, place,
       				happened_at, description, contact_info, image, status, 
       				created_at FROM items WHERE item_id = ?`, id).Scan(
			&it.ItemID, &it.Publisher, &it.UserID, &it.Type,
			&it.Title, &it.Place, &it.HappenedAt, &it.Description,
			&it.ContactInfo, &it.Image, &it.Status, &it.CreatedAt)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		c.JSON(200, gin.H{"ok": true, "msg": "修改成功", "data": it})
		return
	})

	//上传图片
	r.POST("/upload", AuthMiddleware(), func(c *gin.Context) {
		file, err := c.FormFile("file") // ① 收文件（gin 的 API）
		if err != nil {
			c.JSON(400, gin.H{"ok": false, "msg": "没有文件"})
			return
		}

		const maxSize = 5 << 20 // ② ★ 大小限制 5MB
		if file.Size > maxSize {
			c.JSON(400, gin.H{"ok": false, "msg": "文件不能超过 5MB"})
			return
		}

		ext := strings.ToLower(filepath.Ext(file.Filename)) // ③ ★ 类型白名单
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" &&
			ext != ".gif" && ext != ".webp" {
			c.JSON(400, gin.H{"ok": false, "msg": "只支持 jpg/png/gif/webp"})
			return
		}

		// ④ ★★ 生成随机文件名 —— 这一步就是防路径穿越
		name := fmt.Sprintf("%d%s", time.Now().UnixNano(), ext) // 例：1727...123.jpg

		if err := c.SaveUploadedFile(file, filepath.Join(UploadDir, name)); err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "保存失败"})
			return
		}

		c.JSON(200, gin.H{"ok": true, "data": gin.H{"filename": name}})
	})

	r.PUT("/items/:id/status", AuthMiddleware(), func(c *gin.Context) {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"ok": false, "msg": "id应该为数字！"})
			return
		}

		var ownerID int
		err = DB.QueryRow(`SELECT user_id FROM items WHERE item_id = ?`, id).Scan(&ownerID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				c.JSON(404, gin.H{"ok": false, "msg": "没找到该信息"})
				return
			}
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}
		if ownerID != c.GetInt("user_id") {
			c.JSON(403, gin.H{"ok": false, "msg": "无权修改"})
			return
		}

		var req struct {
			Status string `json:"status"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"ok": false, "msg": "格式不对"})
			return
		}
		if req.Status != "searching" && req.Status != "found" && req.Status != "closed" {
			c.JSON(400, gin.H{"ok": false, "msg": "状态只能是 searching/found/closed"})
			return
		}

		_, err = DB.Exec("UPDATE items SET status = ? WHERE item_id = ?", req.Status, id)

		c.JSON(200, gin.H{"ok": true, "msg": "状态已更新", "data": req.Status})
	})

	r.DELETE("/items/:id", AuthMiddleware(), func(c *gin.Context) {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"ok": false, "msg": "id应该为数字！"})
			return
		}

		var ownerID int
		var image string
		err = DB.QueryRow(`SELECT user_id,image FROM items WHERE item_id = ?`, id).Scan(&ownerID, &image)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				c.JSON(404, gin.H{"ok": false, "msg": "没找到该信息"})
				return
			}
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}
		if ownerID != c.GetInt("user_id") {
			c.JSON(403, gin.H{"ok": false, "msg": "无权删除"})
			return
		}

		_, err = DB.Exec(`DELETE FROM items WHERE item_id = ?`, id)
		if err != nil {
			c.JSON(500, gin.H{"ok": false, "msg": "内部错误"})
			return
		}

		if image != "" {
			path := filepath.Join(UploadDir, filepath.Base(image))
			if err := os.Remove(path); err != nil {
				log.Println("删图片失败:", err) // ★ 不影响下面的删除 ✓
			}
		}

		c.JSON(200, gin.H{"ok": true, "msg": "删除成功"})
	})

	r.Static("/uploads", "./uploads")
	r.Static("/static", "./static")
	err = r.Run("127.0.0.1:8080")
	if err != nil {
		return
	}
}
