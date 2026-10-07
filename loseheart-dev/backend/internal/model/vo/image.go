package vo

// ImageUploadResponseVO 图片上传成功的对象标识及平台预览地址，不返回 OSS 密钥或签名 URL。
type ImageUploadResponseVO struct {
	ObjectKey  string `json:"object_key"`
	PreviewURL string `json:"preview_url"`
	MIMEType   string `json:"mime_type"`
	SizeBytes  int64  `json:"size_bytes"`
}
