package integration_test

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lost-found/backend/global"
	"lost-found/backend/internal/config"
	"lost-found/backend/internal/model/entity"
	"lost-found/backend/internal/service"

	"gorm.io/gorm/logger"
)

// TestPrivateOSSIntegration 验证本地配置连接真实私有 OSS：PutObject、HeadObject、GetObject。
// 使用普通演示账号上传一个无个人信息的 2×2 PNG；按演示阶段保留对象的约定不删除它。
// 单独启用 LOST_FOUND_OSS_INTEGRATION=1，默认测试不会产生云端写入。
func TestPrivateOSSIntegration(t *testing.T) {
	if os.Getenv("LOST_FOUND_OSS_INTEGRATION") != "1" {
		t.Skip("requires configured private OSS; retains one small demo object")
	}
	cwd, _ := os.Getwd()
	if err := os.Chdir(filepath.Join(cwd, "../..")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	config.Init()
	global.Db.Logger = logger.Default.LogMode(logger.Silent)
	db, err := global.Db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close(); _ = global.RedisClient.Close() })
	var actor entity.AuthUser
	if err := global.Db.Table("users").Where("account_no = ?", "25051408").Take(&actor).Error; err != nil {
		t.Fatal("demo user is unavailable")
	}
	bitmap := image.NewRGBA(image.Rect(0, 0, 2, 2))
	bitmap.Set(0, 0, color.RGBA{R: 64, G: 128, B: 255, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, bitmap); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	upload, err := service.UploadPostImage(ctx, actor, encoded.Bytes())
	if err != nil {
		t.Fatal("private OSS upload failed", err)
	}
	if err := service.ValidatePostImages(ctx, actor.ID, []string{upload.ObjectKey}); err != nil {
		t.Fatal("private OSS Head/ownership validation failed", err)
	}
	filename := upload.ObjectKey[strings.LastIndex(upload.ObjectKey, "/")+1:]
	data, mime, err := service.PreviewPostImage(ctx, actor, filename)
	if err != nil || mime != "image/png" || !bytes.Equal(data, encoded.Bytes()) {
		t.Fatal("private OSS readback failed", err)
	}
	t.Logf("real private OSS Put/Head/Get passed; retained %d-byte object: %s", upload.SizeBytes, upload.ObjectKey)
}
