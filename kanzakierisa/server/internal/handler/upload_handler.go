package handler

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"hdu-lostfound/internal/config"
	"hdu-lostfound/internal/middleware"
	"hdu-lostfound/internal/model"
	"hdu-lostfound/internal/pkg/apperr"
	"hdu-lostfound/internal/pkg/response"
)

// 上传相关常量（SPEC 10 安全基线 + SPEC 03 要点 8）。
const (
	// formFileField 是 multipart 表单里约定的文件字段名。
	formFileField = "file"
	// sniffLen 是 http.DetectContentType 需要的探测长度。
	// 标准库依据前 512 字节的魔数判断类型，少于这个长度无法可靠识别。
	sniffLen = 512
	// uploadURLPrefix 是对外暴露的静态资源前缀，与 router 里 r.Static 挂载点一致。
	uploadURLPrefix = "/uploads/"
	// dirPerm 是新建上传目录的权限位。
	dirPerm = 0o755
	// filePerm 是落盘文件的权限位。
	filePerm = 0o644
)

// allowedExtensions 是允许的扩展名白名单（小写）。
//
// .jpeg 与 .jpg 都收：两者是同一格式的不同写法，用户从相机导出的
// 文件常见 .jpeg，拒绝它只会造成无意义的体验摩擦。
var allowedExtensions = map[string]struct{}{
	".jpg":  {},
	".jpeg": {},
	".png":  {},
}

// allowedMIMEs 是通过魔数探测允许的真实 MIME 白名单。
//
// 与扩展名白名单构成「双重校验」：只信扩展名会被
// 「把 .exe 改名成 .png」绕过；只信魔数则会把用户合法命名的
// .jpeg 误判（DetectContentType 对 JPEG 一律返回 image/jpeg）。
// 两者同时成立才放行，任一不满足都返回 1009。
var allowedMIMEs = map[string]struct{}{
	"image/jpeg": {},
	"image/png":  {},
}

// UploadHandler 处理图片上传。
type UploadHandler struct {
	cfg *config.Config
}

// NewUploadHandler 创建上传 handler，需要配置以读取上传目录与体积上限。
func NewUploadHandler(cfg *config.Config) *UploadHandler {
	return &UploadHandler{cfg: cfg}
}

// Upload 处理 POST /api/upload（multipart/form-data，字段名 file）。
//
// 鉴权：强制。虽然上传本身不涉及越权，但要求登录可以
// 把「匿名刷盘」变成「可追溯到账号的行为」，是最低成本的滥用防护。
//
// 校验顺序刻意从便宜到昂贵：体积（读 header）→ 扩展名（字符串比较）
// → 魔数（需读文件内容）。把最可能失败的检查放前面，
// 避免为一个 3MB 的非法文件先读满 512 字节再拒绝。
func (h *UploadHandler) Upload(c *gin.Context) {
	if middleware.CurrentUser(c) == nil {
		response.Fail(c, apperr.New(apperr.CodeUnauthorized))
		return
	}

	fileHeader, err := c.FormFile(formFileField)
	if err != nil {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidUpload, "请通过 %s 字段上传文件", formFileField))
		return
	}

	// 1) 体积校验：用 Multipart 解析出的 Size，无需读文件内容。
	if fileHeader.Size > h.cfg.UploadMaxBytes() {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidUpload,
			"文件大小不能超过 %d MB", h.cfg.UploadMaxMB))
		return
	}

	// 2) 扩展名校验（小写归一化后比对白名单）。
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if _, ok := allowedExtensions[ext]; !ok {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidUpload, "仅支持 jpg / jpeg / png 格式"))
		return
	}

	src, err := fileHeader.Open()
	if err != nil {
		response.Fail(c, apperr.Wrap(apperr.CodeInvalidUpload, err))
		return
	}
	defer func() {
		if closeErr := src.Close(); closeErr != nil {
			slog.Error("关闭上传文件句柄失败", "error", closeErr)
		}
	}()

	// 3) 类型校验（魔数）：读前 512 字节做探测。
	head := make([]byte, sniffLen)
	n, err := io.ReadFull(src, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		response.Fail(c, apperr.Wrap(apperr.CodeInvalidUpload, err))
		return
	}
	detected := http.DetectContentType(head[:n])
	if _, ok := allowedMIMEs[detected]; !ok {
		response.Fail(c, apperr.Newf(apperr.CodeInvalidUpload, "文件内容不是合法的图片"))
		return
	}

	// ⚠️ 关键：探测读走了 512 字节，必须把游标拨回起点，
	// 否则下面 io.Copy 写出来的文件会缺失文件头（SPEC 03 常见坑 4）。
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		response.Fail(c, apperr.Wrap(apperr.CodeInvalidUpload, err))
		return
	}

	// 4) 重命名：绝不用原始文件名（防路径穿越与覆盖攻击）。
	// uuid v4 全局唯一，且不含路径分隔符、不含 ".."。
	newName := uuid.NewString() + ext

	dst, err := h.safeDestination(newName)
	if err != nil {
		response.Fail(c, apperr.Wrap(apperr.CodeInvalidUpload, err))
		return
	}

	if err := h.writeFile(dst, src); err != nil {
		response.Fail(c, apperr.Wrap(apperr.CodeInternal, err))
		return
	}

	slog.Info("图片上传成功", "file", newName, "size", fileHeader.Size, "mime", detected)
	response.OK(c, model.UploadResult{URL: uploadURLPrefix + newName})
}

// safeDestination 计算落盘绝对路径，并确认它确实位于上传根目录内。
//
// 为什么不能只做字符串拼接：newName 虽然由 uuid 生成、当前不可能含 ".."，
// 但「当前不可能」不等于「永远不可能」—— 一旦将来有人把命名规则改成
// 基于用户输入，这里就是文件覆盖/任意写的入口。用 filepath.Abs 归一化后
// 做前缀比较，把这层防护变成结构性的、不依赖上游命名规则的正确性。
//
// 注意结尾必须拼上 os.PathSeparator 再比较：否则 /data/uploads-evil
// 会被 /data/uploads 误判为「在目录内」（前缀相同但实为兄弟目录）。
func (h *UploadHandler) safeDestination(name string) (string, error) {
	root, err := filepath.Abs(h.cfg.UploadDir)
	if err != nil {
		return "", fmt.Errorf("解析上传目录失败: %w", err)
	}

	dst, err := filepath.Abs(filepath.Join(root, name))
	if err != nil {
		return "", fmt.Errorf("解析目标路径失败: %w", err)
	}

	if !strings.HasPrefix(dst, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("目标路径越出上传目录: %s", name)
	}
	return dst, nil
}

// writeFile 确保目录存在后把内容写入目标路径。
//
// 用 os.Create 而非 os.CreateTemp + rename：单文件写入、
// 目标名已是不可预测的 uuid，无需额外的原子替换机制。
func (h *UploadHandler) writeFile(dst string, src io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(dst), dirPerm); err != nil {
		return fmt.Errorf("创建上传目录失败: %w", err)
	}

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, filePerm)
	if err != nil {
		return fmt.Errorf("创建上传文件失败: %w", err)
	}
	defer func() {
		if closeErr := out.Close(); closeErr != nil {
			slog.Error("关闭上传文件失败", "error", closeErr)
		}
	}()

	if _, err := io.Copy(out, src); err != nil {
		return fmt.Errorf("写入上传文件失败: %w", err)
	}
	return nil
}
