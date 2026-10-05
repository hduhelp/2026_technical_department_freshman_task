package main

import (
	"net/http"
	"os"
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

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func newRouter(db *gorm.DB, secret []byte) *gin.Engine {
	db.AutoMigrate(&User{})
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
