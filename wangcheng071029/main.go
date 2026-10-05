package main

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type User struct {
	ID           uint      `json:"id"`
	Username     string    `json:"username" gorm:"uniqueIndex;not null"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type Post struct {
	ID          uint      `json:"id"`
	AuthorID    uint      `json:"author_id" gorm:"index"`
	Author      User      `json:"author"`
	Type        string    `json:"type"`
	ItemName    string    `json:"item_name"`
	Location    string    `json:"location"`
	HappenedAt  time.Time `json:"happened_at"`
	Description string    `json:"description"`
	Contact     string    `json:"contact"`
	Status      string    `json:"status" gorm:"index"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type postInput struct {
	Type        string `json:"type"`
	ItemName    string `json:"item_name"`
	Location    string `json:"location"`
	HappenedAt  string `json:"happened_at"`
	Description string `json:"description"`
	Contact     string `json:"contact"`
}

func parsePost(input postInput) (Post, bool) {
	if (input.Type != "lost" && input.Type != "found") || strings.TrimSpace(input.ItemName) == "" || strings.TrimSpace(input.Location) == "" || strings.TrimSpace(input.Description) == "" || strings.TrimSpace(input.Contact) == "" {
		return Post{}, false
	}
	happenedAt, err := time.Parse(time.RFC3339, input.HappenedAt)
	if err != nil {
		return Post{}, false
	}
	return Post{Type: input.Type, ItemName: strings.TrimSpace(input.ItemName), Location: strings.TrimSpace(input.Location), HappenedAt: happenedAt, Description: strings.TrimSpace(input.Description), Contact: strings.TrimSpace(input.Contact)}, true
}

func newRouter(db *gorm.DB, secret []byte) *gin.Engine {
	db.AutoMigrate(&User{}, &Post{})
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.POST("/api/auth/register", func(c *gin.Context) {
		var input credentials
		if c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Username) == "" || input.Password == "" {
			c.JSON(http.StatusBadRequest, gin.H{"message": "用户名和密码不能为空"})
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "密码处理失败"})
			return
		}
		user := User{Username: strings.TrimSpace(input.Username), PasswordHash: string(hash)}
		if err := db.Create(&user).Error; err != nil {
			c.JSON(http.StatusConflict, gin.H{"message": "用户名已存在"})
			return
		}
		c.JSON(http.StatusCreated, user)
	})

	r.POST("/api/auth/login", func(c *gin.Context) {
		var input credentials
		if c.ShouldBindJSON(&input) != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": "请求格式错误"})
			return
		}
		var user User
		if err := db.Where("username = ?", strings.TrimSpace(input.Username)).First(&user).Error; err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)) != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "用户名或密码错误"})
			return
		}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"exp":     time.Now().Add(24 * time.Hour).Unix(),
		})
		signed, err := token.SignedString(secret)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"message": "登录令牌生成失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"token": signed, "user": user})
	})

	auth := func(c *gin.Context) {
		header := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if header == "" || header == c.GetHeader("Authorization") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "请先登录"})
			return
		}
		token, err := jwt.Parse(header, func(token *jwt.Token) (any, error) {
			return secret, nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "登录已失效"})
			return
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		id, ok := claims["user_id"].(float64)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"message": "登录令牌无效"})
			return
		}
		c.Set("user_id", uint(id))
		c.Next()
	}

	protected := r.Group("/api/auth", auth)
	protected.GET("/me", func(c *gin.Context) {
		var user User
		if err := db.First(&user, c.GetUint("user_id")).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"message": "用户不存在"})
			return
		}
		c.JSON(http.StatusOK, user)
	})
	protected.POST("/logout", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "已退出登录"})
	})

	posts := r.Group("/api/posts")
	posts.GET("", func(c *gin.Context) {
		query := db.Preload("Author")
		if value := c.Query("type"); value == "lost" || value == "found" {
			query = query.Where("type = ?", value)
		}
		if value := c.Query("status"); value == "searching" || value == "found" || value == "closed" {
			query = query.Where("status = ?", value)
		}
		if value := strings.TrimSpace(c.Query("q")); value != "" {
			like := "%" + value + "%"
			query = query.Where("item_name LIKE ? OR location LIKE ? OR description LIKE ?", like, like, like)
		}
		page, size := 1, 10
		if value, err := strconv.Atoi(c.DefaultQuery("page", "1")); err == nil && value > 0 {
			page = value
		}
		if value, err := strconv.Atoi(c.DefaultQuery("page_size", "10")); err == nil && value > 0 && value <= 50 {
			size = value
		}
		var total int64
		query.Model(&Post{}).Count(&total)
		var results []Post
		query.Order("created_at DESC").Limit(size).Offset((page - 1) * size).Find(&results)
		c.JSON(http.StatusOK, gin.H{"items": results, "total": total, "page": page, "page_size": size})
	})
	posts.GET("/:id", func(c *gin.Context) {
		var post Post
		if err := db.Preload("Author").First(&post, c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"message": "信息不存在"})
			return
		}
		c.JSON(http.StatusOK, post)
	})

	owned := posts.Group("", auth)
	owned.POST("", func(c *gin.Context) {
		var input postInput
		post, valid := Post{}, c.ShouldBindJSON(&input) == nil
		if valid {
			post, valid = parsePost(input)
		}
		if !valid {
			c.JSON(http.StatusBadRequest, gin.H{"message": "请完整填写有效的信息"})
			return
		}
		post.AuthorID = c.GetUint("user_id")
		post.Status = "searching"
		db.Create(&post)
		db.Preload("Author").First(&post, post.ID)
		c.JSON(http.StatusCreated, post)
	})
	owned.PUT("/:id", func(c *gin.Context) {
		var post Post
		if err := db.First(&post, c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"message": "信息不存在"})
			return
		}
		if post.AuthorID != c.GetUint("user_id") {
			c.JSON(http.StatusForbidden, gin.H{"message": "只能修改自己的信息"})
			return
		}
		var input postInput
		updated, valid := Post{}, c.ShouldBindJSON(&input) == nil
		if valid {
			updated, valid = parsePost(input)
		}
		if !valid {
			c.JSON(http.StatusBadRequest, gin.H{"message": "请完整填写有效的信息"})
			return
		}
		post.Type, post.ItemName, post.Location = updated.Type, updated.ItemName, updated.Location
		post.HappenedAt, post.Description, post.Contact = updated.HappenedAt, updated.Description, updated.Contact
		db.Save(&post)
		c.JSON(http.StatusOK, post)
	})
	owned.DELETE("/:id", func(c *gin.Context) {
		var post Post
		if err := db.First(&post, c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"message": "信息不存在"})
			return
		}
		if post.AuthorID != c.GetUint("user_id") {
			c.JSON(http.StatusForbidden, gin.H{"message": "只能删除自己的信息"})
			return
		}
		db.Delete(&post)
		c.Status(http.StatusNoContent)
	})
	owned.PATCH("/:id/status", func(c *gin.Context) {
		var post Post
		if err := db.First(&post, c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"message": "信息不存在"})
			return
		}
		if post.AuthorID != c.GetUint("user_id") {
			c.JSON(http.StatusForbidden, gin.H{"message": "只能变更自己的信息状态"})
			return
		}
		var input struct {
			Status string `json:"status"`
		}
		if c.ShouldBindJSON(&input) != nil || !((post.Status == "searching" && input.Status == "found") || (post.Status == "found" && input.Status == "closed")) {
			c.JSON(http.StatusBadRequest, gin.H{"message": "状态只能按顺序变更"})
			return
		}
		post.Status = input.Status
		db.Save(&post)
		c.JSON(http.StatusOK, post)
	})
	r.StaticFile("/", "./static/index.html")
	r.Static("/static", "./static")

	return r
}

func main() {
	db, err := gorm.Open(sqlite.Open("lost_found.db"), &gorm.Config{})
	if err != nil {
		panic(err)
	}
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "hdu-lost-found-demo-secret"
	}
	newRouter(db, []byte(secret)).Run(":8080")
}
