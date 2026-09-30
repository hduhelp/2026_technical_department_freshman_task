const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** 绝对时间，例如 2026/09/25 14:30。只在服务端组件使用，避免时区导致的 hydration 不一致。 */
export function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ""
  return dateTimeFormatter.format(date)
}

/** 相对时间，例如 3 分钟前。只在服务端组件使用。 */
export function formatRelativeTime(
  value: string | Date,
  now = Date.now()
): string {
  const date = typeof value === "string" ? new Date(value) : value
  const diff = now - date.getTime()
  if (Number.isNaN(diff)) return ""

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return "刚刚"
  if (diff < hour) return Math.floor(diff / minute) + " 分钟前"
  if (diff < day) return Math.floor(diff / hour) + " 小时前"
  if (diff < 30 * day) return Math.floor(diff / day) + " 天前"
  return formatDateTime(date)
}

/** 把 Date 转成 <input type="datetime-local"> 需要的本地时间字符串。 */
export function toDateTimeLocalValue(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  )
}

/** 相似度 0..1 转成百分比文案。 */
export function formatSimilarity(score: number): string {
  return Math.round(Math.max(0, Math.min(1, score)) * 100) + "%"
}
