import { z } from "zod"

import { publicEnv } from "./public-env"

// 客户端组件请**直接引 lib/public-env.ts**（零依赖），
// 从这里透传只是为了让服务端代码有个统一的 env 入口。
export { publicEnv }

// Next.js 只会在构建时内联「字面量」形式的环境变量访问，
// 因此这里逐个写出 process.env.XXX，不能动态取值。
const serverSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z
      .string()
      .min(1, "缺少 NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z
      .string()
      .min(1, "缺少 NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .min(1, "缺少 SUPABASE_SERVICE_ROLE_KEY"),
    NEXT_PUBLIC_AUTH_EMAIL_DOMAIN: z.string().min(1).default("campus.local"),
    // Cloudflare Turnstile 的 sitekey。它是**公开值**（secret 配在 Supabase 控制台），
    // 所以可以进客户端。留空 = 不渲染人机校验，本地开发与自动化测试就是这样。
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().default(""),
    // 整套 AI 能力共用一个视觉多模态模型，因此只需要一个模型配置
    AI_PROVIDER: z.enum(["mock", "ai-sdk"]).default("mock"),
    AI_BASE_URL: z.string().default(""),
    AI_API_KEY: z.string().default(""),
    AI_MODEL: z.string().default(""),
    // Vercel Cron 调 /api/cron/* 时带的共享密钥；留空则 cron 路由一律 401（失败关闭）
    CRON_SECRET: z.string().default(""),
  })
  .superRefine((value, ctx) => {
    // 接了真实供应商却不给 key/model：不在这里拦住的话，要等到用户
    // 拍完照点「识别」才炸，而且报的是模型端的 401。
    if (value.AI_PROVIDER !== "ai-sdk") return
    for (const key of ["AI_API_KEY", "AI_MODEL"] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "AI_PROVIDER=ai-sdk 时必须同时配置 " + key,
        })
      }
    }
  })

export type ServerEnv = z.infer<typeof serverSchema>

/**
 * 生产环境不允许「静默的假 AI」。
 *
 * AI_PROVIDER 的默认值是 mock（本地开发与自动化测试靠它离线跑完整条链路）。
 * 云端一旦忘了配，站点会照常「识别成功」，只是结果永远是写死的那几条 ——
 * 不报错、不告警，只有翻日志才看得出来。
 *
 * 所以 Vercel 生产部署（VERCEL_ENV=production）下必须显式表态：
 * 要么接真模型，要么用 ALLOW_MOCK_AI=1 明确声明「我就是要 mock」。
 * 预览与本地不受影响（预览没有真实用户，本地靠它跑测试）。
 */
function assertProductionAiProvider(env: ServerEnv): void {
  if (process.env.VERCEL_ENV !== "production") return
  if (env.AI_PROVIDER === "ai-sdk") return
  if (process.env.ALLOW_MOCK_AI === "1") return
  throw new Error(
    "[env] 生产环境的 AI_PROVIDER 仍是 mock（假识别）。" +
      "请配置 AI_PROVIDER=ai-sdk 与 AI_API_KEY / AI_MODEL，" +
      "或显式设置 ALLOW_MOCK_AI=1 声明接受 mock 结果。"
  )
}

function readServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_AUTH_EMAIL_DOMAIN: process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    CRON_SECRET: process.env.CRON_SECRET,
  })

  if (!parsed.success) {
    // 默认的 ZodError 只说 "Invalid input"，看不出到底哪个变量没配。
    // 这类问题都发生在「刚部署完」的时刻，把字段名一起打出来。
    const detail = parsed.error.issues
      .map((issue) => (issue.path.join(".") || "env") + "：" + issue.message)
      .join("；")
    throw new Error("[env] 环境变量配置有误 —— " + detail)
  }

  assertProductionAiProvider(parsed.data)
  return parsed.data
}

let cached: ServerEnv | null = null

export function serverEnv() {
  if (!cached) cached = readServerEnv()
  return cached
}

/**
 * 手机号 → 内部邮箱。
 * 【第 7 轮】账号体系改成「手机号 + 密码」，但 Supabase Auth 需要邮箱/手机号二选一；
 * 我们不做短信验证码，所以把手机号映射成内部邮箱 <phone>@<域名>，
 * 手机号唯一 ⇒ 内部邮箱唯一，登录/注册都走 signInWithPassword / signUp。
 */
export function phoneToEmail(phone: string) {
  const normalized = phone.replace(/\D/g, "")
  return normalized + "@" + (publicEnv.authEmailDomain || "campus.local")
}
