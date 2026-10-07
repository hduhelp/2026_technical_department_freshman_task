package main

import (
	"fmt"
	"log"

	"lostfound/config"
	"lostfound/dao"
	"lostfound/models"
	"lostfound/router"
	"lostfound/utils"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// main 是整个后端服务的启动流程：读配置 → 连数据库 → 建表 → 装 JWT → 起服务
func main() {
	// 1. 读配置文件
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("❌ 加载配置失败: %v", err)
	}

	// 2. 连接 MySQL（DSN 由配置拼成）
	db, err := gorm.Open(mysql.Open(cfg.MySQL.DSN()), &gorm.Config{})
	if err != nil {
		log.Fatalf("❌ 连接数据库失败: %v\n提示：检查 MySQL 服务是否启动、config.yaml 里的密码对不对、数据库 %s 是否已创建", err, cfg.MySQL.DBName)
	}
	dao.InitDB(db)
	fmt.Println("✅ 数据库连接成功")

	// 3. 自动建表：GORM 按结构体定义生成表结构（只建表/补字段，不会删列）
	if err := db.AutoMigrate(&models.User{}, &models.Item{}); err != nil {
		log.Fatalf("❌ 建表失败: %v", err)
	}
	fmt.Println("✅ 数据表已就绪")

	// 4. 初始化 JWT（把密钥和有效期装进 utils 包）
	utils.InitJWT(cfg.JWT.Secret, cfg.JWT.ExpireHours)

	// 5. 注册路由并启动服务
	r := router.Setup()
	fmt.Printf("🚀 服务已启动：http://localhost:%d\n", cfg.Server.Port)
	if err := r.Run(fmt.Sprintf(":%d", cfg.Server.Port)); err != nil {
		log.Fatalf("❌ 服务启动失败: %v", err)
	}
}
