/** 只接受站内相对路径，防止开放重定向。 */
export function safeNextPath(value: string | undefined | null): string {
  if (!value) return "/"
  if (!value.startsWith("/") || value.startsWith("//")) return "/"
  return value
}
