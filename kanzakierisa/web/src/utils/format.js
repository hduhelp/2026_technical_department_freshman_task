/**
 * 展示层格式化工具：时间、相对时间、枚举文案。
 *
 * ⚠️ 后端返回的时间一律是 **UTC 的 RFC3339**（形如 `2026-09-26T14:30:00Z`）。
 * `new Date(iso)` 已经会自动按浏览器本地时区解析，**绝不能**再手动加减 8 小时，
 * 否则会出现「差 8 小时」的经典坑。
 */
import { POST_TYPES, POST_STATUS, CATEGORIES } from '@/constants'

const pad2 = (n) => String(n).padStart(2, '0')

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 把 ISO 时间串格式化为本地时区的 `YYYY-MM-DD HH:mm`。
 * 传入空值或非法值时返回空串，避免页面渲染出 `Invalid Date`。
 */
export function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * 相对时间：`刚刚` / `3 分钟前` / `5 小时前` / `3 天前`。
 * 超过 30 天退回绝对时间；未来时间（时钟偏差）也退回绝对时间。
 */
export function fromNow(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return formatTime(iso)
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`
  return formatTime(iso)
}

const pickLabel = (dict, value) => {
  if (!value) return ''
  const hit = dict.find((item) => item.value === value)
  return hit ? hit.label : value
}

/** `lost` → `失物` */
export function typeLabel(v) {
  return pickLabel(POST_TYPES, v)
}

/** `open` → `寻找中` */
export function statusLabel(v) {
  return pickLabel(POST_STATUS, v)
}

/** `card` → `校园卡` */
export function categoryLabel(v) {
  return pickLabel(CATEGORIES, v)
}

/** 类型标签的前景色（失物红 / 招领蓝），用于 PostCard 的类型徽标 */
export function typeColor(v) {
  const hit = POST_TYPES.find((item) => item.value === v)
  return hit ? hit.color : '#969799'
}

/** 状态标签映射到 Vant Tag 的 type（warning / success / default） */
export function statusTagType(v) {
  const hit = POST_STATUS.find((item) => item.value === v)
  return hit ? hit.color : 'default'
}
