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
