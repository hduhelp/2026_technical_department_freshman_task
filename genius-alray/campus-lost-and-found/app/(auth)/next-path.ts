/** 只接受站内相对路径，避免开放重定向（next 参数来自不可信的 querystring / 表单） */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback
  if (!value.startsWith("/") || value.startsWith("//")) return fallback
  return value
}
