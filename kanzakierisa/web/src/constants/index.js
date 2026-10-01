/**
 * 全局枚举映射表。
 *
 * 取值必须与后端 `server/internal` 中的枚举、以及 SQL 注释里的取值一一对应。
 * 前端所有下拉、标签、文案都从这里取，避免出现散落各处的魔法字符串。
 */

// 帖子类型：lost=丢失寻找 | found=捡到招领
export const POST_TYPES = [
  { value: 'lost', label: '失物', color: '#ee0a24' },
  { value: 'found', label: '招领', color: '#1989fa' },
]

// 帖子状态：与后端状态机白名单同源（open → matched → closed）
export const POST_STATUS = [
  { value: 'open', label: '寻找中', color: 'warning' },
  { value: 'matched', label: '已找到', color: 'success' },
  { value: 'closed', label: '已结束', color: 'default' },
]

// 认领状态：与后端 `valid.ClaimStatusPending` 等常量同源。
// `color` 直接就是 Vant Tag 的 type，故没有 'rejected' → 'danger' 之外的自定义色。
export const CLAIM_STATUS = [
  { value: 'pending', label: '待审核', color: 'warning' },
  { value: 'approved', label: '已通过', color: 'success' },
  { value: 'rejected', label: '已拒绝', color: 'danger' },
  { value: 'redeemed', label: '已交接', color: 'default' },
]

// 物品分类
export const CATEGORIES = [
  { value: 'card', label: '校园卡' },
  { value: 'digital', label: '电子数码' },
  { value: 'book', label: '书籍资料' },
  { value: 'key', label: '钥匙证件' },
  { value: 'clothes', label: '衣物' },
  { value: 'other', label: '其他' },
]

// 与后端 `JWT_EXPIRE_HOURS` 无关，仅用于前端展示口径
export const PAGE_SIZE = 10

// ===== 图片上传约束 =====
// 必须与后端保持一致，否则会出现「前端放行、后端 1009」的错位：
// - MAX_IMAGES   → SPEC 8.5「images ≤ 3」
// - MAX_IMAGE_MB → 后端 UPLOAD_MAX_MB
export const MAX_IMAGES = 3
export const MAX_IMAGE_MB = 2

// 上传文件选择框的 accept：与后端 allowedExtensions / allowedMIMEs 对齐
export const ACCEPT_IMAGE_MIME = 'image/png,image/jpeg'

// 前端预检用的 MIME 白名单。
// 注意用 image/jpeg 而不是 image/jpg —— 后者不是合法 MIME，
// 浏览器对 .jpg / .jpeg 一律上报 image/jpeg。
export const IMAGE_MIME_REGEXP = /^image\/(png|jpeg)$/
