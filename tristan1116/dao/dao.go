package dao

import (
	"errors"

	"gorm.io/gorm"
)

// DB 是全局数据库句柄，由 main 启动时通过 InitDB 注入
// （小项目常见的简化写法：全项目共用一个连接池）
var DB *gorm.DB

// ErrNotFound 统一的"记录不存在"错误
// dao 层负责把 GORM 的 ErrRecordNotFound 翻译成它，这样上层就不用 import gorm 了
var ErrNotFound = errors.New("记录不存在")

// InitDB 注入数据库句柄（main 里调用一次）
func InitDB(db *gorm.DB) {
	DB = db
}

// translate 把 GORM 的"找不到记录"翻译成 dao.ErrNotFound，其他错误原样返回
func translate(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}
	return err
}
