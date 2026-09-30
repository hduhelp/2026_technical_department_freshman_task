import "server-only"

export const MISSING_CONFIG_MESSAGE =
  "尚未配置 Supabase：请在项目根目录的 .env.local 中填写 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY，然后重启开发服务器。可参考 .env.example。"

export type SupabaseConfig = {
  url: string
  anonKey: string
}

/**
 * 读取 Supabase 配置。缺配置时返回 null，而不是直接抛错，便于页面渲染友好提示。
 * Supabase 新的客户端密钥叫 publishable key（NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY）；
 * 旧的 anon key（NEXT_PUBLIC_SUPABASE_ANON_KEY）仍兼容，两个都读。
 */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) return null
  return { url, anonKey }
}

/** 页面用它决定渲染内容还是渲染「还没配置」的提示。 */
export function hasSupabaseConfig(): boolean {
  return supabaseConfig() !== null
}

export function requireSupabaseConfig(): SupabaseConfig {
  const config = supabaseConfig()
  if (!config) throw new Error(MISSING_CONFIG_MESSAGE)
  return config
}

export type DeepseekConfig = {
  apiKey: string
  baseUrl: string
  model: string
}

/** 读取 DeepSeek 视觉模型配置。没配 Key 时返回 null，按钮会禁用并给出提示。 */
export function deepseekConfig(): DeepseekConfig | null {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) return null
  const baseUrl = (
    process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com"
  ).replace(/\/+$/, "")
  const model = process.env.DEEPSEEK_VISION_MODEL?.trim() || "deepseek-flash"
  return { apiKey, baseUrl, model }
}

/**
 * 用户名会被确定性映射成内部登录邮箱，这里配置它用的域名。
 * 默认值用保留 TLD .invalid，保证这个邮箱永远不可路由、不会真的发信。
 */
export function authEmailDomain(): string {
  return (
    process.env.AUTH_EMAIL_DOMAIN?.trim() || "user.campus-lostfound.invalid"
  )
}

/** service_role key 是可选的，只有本地验证脚本会用到。 */
export function serviceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null
}
