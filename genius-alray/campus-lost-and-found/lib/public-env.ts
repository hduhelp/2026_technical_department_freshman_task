/**
 * 只放**可以进客户端**的公开环境变量。
 *
 * 【为什么不跟 lib/env.ts 放一起】env.ts 用 zod 定义整套服务端 schema；
 * 客户端组件（登录/注册表单、人机校验）只要一个 sitekey，却会把整个 zod
 * 拖进浏览器 bundle。这里保持零依赖，服务端按需从 env.ts 拿到同一个对象。
 *
 * 注意：Next 只会内联**字面量**形式的 process.env.NEXT_PUBLIC_* 访问，
 * 所以下面必须逐个写出来，不能动态取值。
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  authEmailDomain: process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? "campus.local",
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
} as const
