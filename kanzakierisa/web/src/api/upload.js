/**
 * 图片上传接口。
 *
 * 对应后端 `internal/handler/upload_handler.go`（`POST /api/upload`）。
 * 响应经拦截器解包后形如 `{ url: '/uploads/8f3c....png' }`，是**相对路径**。
 */
import request from './request'

/**
 * 上传单张图片。
 *
 * ⚠️ 刻意**不设置** `Content-Type`。
 *
 * multipart 请求头必须带上 `boundary=----xxx` 分隔段，而这个 boundary 由
 * 浏览器在真正发送时随机生成。手写成固定的 `multipart/form-data` 会把 boundary
 * 抹掉，后端 `c.FormFile` 无法切分请求体，直接报「请通过 file 字段上传文件」
 * （P5 常见坑 1）。
 *
 * 所以这里把请求体原样交给 axios：它识别出 FormData 后会删除该头，
 * 由浏览器自动补全带 boundary 的正确值。
 *
 * @param {File} file 用户选择的图片文件
 * @returns {Promise<{url: string}>} 相对路径，如 `{ url: '/uploads/8f3c.png' }`
 */
export const upload = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return request.post('/upload', fd)
}
