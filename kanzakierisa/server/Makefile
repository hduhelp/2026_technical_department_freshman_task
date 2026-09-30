# 校园失物招领系统 · 后端常用命令
# 用法：make <target>

MYSQL ?= mysql
DB_USER ?= root
DB_NAME ?= lost_found

.PHONY: help
help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.PHONY: run
run: ## 启动开发服务器
	go run ./cmd/api

.PHONY: build
build: ## 编译二进制到 bin/api
	go build -o bin/api ./cmd/api

.PHONY: vet
vet: ## 静态检查
	go vet ./...

.PHONY: test
test: ## 运行测试
	go test ./... -v

.PHONY: tidy
tidy: ## 整理依赖
	go mod tidy

.PHONY: schema
schema: ## 导入建表脚本（会删表重建）
	$(MYSQL) -u$(DB_USER) -p < sql/schema.sql

.PHONY: seed
seed: ## 导入演示数据
	$(MYSQL) -u$(DB_USER) -p < sql/seed.sql

.PHONY: up
up: ## 用 docker compose 启动 MySQL
	docker compose up -d

.PHONY: down
down: ## 停止 docker compose
	docker compose down
