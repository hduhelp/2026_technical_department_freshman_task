/**
 * 部署前哨：把「部署成功了但其实用不了」的配置错误挡在构建阶段。
 *
 * 这不是在重复 lib/env.ts 的运行时校验，而是补上它管不到的两件事：
 *
 * 1) CSP 的 Supabase origin 是**构建时**从 NEXT_PUBLIC_SUPABASE_URL 算出来的
 *    （见 next.config.ts）。构建环境里没有这个变量时它退化成空串，
 *    **构建照样成功**，但线上所有浏览器端 Supabase 请求（登录、直读公开列）
 *    会被 CSP 拦掉 —— 部署日志里一个异常都看不到。
 * 2) AI_PROVIDER 默认 mock：生产环境忘了配就是「假识别」，不报错也不告警。
 *
 * 【为什么单独一个模块】next.config.ts 里的逻辑没法被单测直接调用，
 * 而这两条恰恰是「只有上线时才会第一次生效」的规则，最需要测试覆盖。
 */

/** 构建期就必须存在的变量：少一个，产物上线后都是坏的 */
export const REQUIRED_AT_BUILD = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const

export type DeployEnvCheck = {
  /** 致命问题：调用方应当直接让构建失败 */
  errors: string[]
  /** 需要人看见、但不该阻断发布的问题 */
  warnings: string[]
}

/**
 * 只在 NODE_ENV=production（即 next build / next start）时检查：
 * 本地 next dev 与 vitest 不该因为「还没配 Supabase」而起不来。
 */
export function checkDeployEnv(
  env: Record<string, string | undefined>
): DeployEnvCheck {
  const errors: string[] = []
  const warnings: string[] = []

  if (env.NODE_ENV !== "production") return { errors, warnings }

  const missing = REQUIRED_AT_BUILD.filter((key) => !env[key])
  if (missing.length > 0) {
    errors.push(
      "[deploy] 缺少必需的环境变量：" +
        missing.join(", ") +
        "。本地请先跑 pnpm db:env；Vercel 请在 Project Settings → Environment Variables 配好" +
        "（注意 NEXT_PUBLIC_SUPABASE_URL 必须对构建环境可见，CSP 依赖它）后重新部署。"
    )
  }

  // 单独再验一次 URL：CSP 直接拿它的 origin，写错了同样是「构建成功、线上被拦」
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  if (supabaseUrl) {
    try {
      new URL(supabaseUrl)
    } catch {
      errors.push(
        "[deploy] NEXT_PUBLIC_SUPABASE_URL 不是合法 URL：" + supabaseUrl
      )
    }
  }

  if (
    env.VERCEL_ENV === "production" &&
    env.AI_PROVIDER !== "ai-sdk" &&
    env.ALLOW_MOCK_AI !== "1"
  ) {
    errors.push(
      "[deploy] 生产环境的 AI_PROVIDER 不是 ai-sdk（默认 mock = 假识别）。" +
        "请配置 AI_PROVIDER=ai-sdk 与 AI_API_KEY / AI_MODEL，" +
        "或设置 ALLOW_MOCK_AI=1 明确接受 mock 结果。"
    )
  }

  // Supabase 控制台开了 CAPTCHA protection 而这里没配 sitekey：
  // 页面上不会渲染挑战，于是注册/登录都拿不到 captchaToken，全部失败。
  // 这两处配置分别在两个控制台里，最容易只改一半 —— 只警告不阻断：
  // 也可能确实是「Supabase 根本没开 CAPTCHA」，那就是正常配置。
  if (env.VERCEL_ENV === "production" && !env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
    warnings.push(
      "[deploy] 生产环境没有配置 NEXT_PUBLIC_TURNSTILE_SITE_KEY。" +
        "如果 Supabase 那边开了 CAPTCHA protection，注册与登录会全部失败（前端拿不到 token）；" +
        "要么配上 sitekey，要么在 Supabase 控制台关掉 CAPTCHA。"
    )
  }

  // 预览部署默认公开可访问。若它同样拿到了 service_role 密钥，
  // 任何拿到预览链接的人都能对**生产库**注册账号、发布内容。
  if (env.VERCEL_ENV === "preview" && env.SUPABASE_SERVICE_ROLE_KEY) {
    warnings.push(
      "[deploy] 预览部署拿到了 SUPABASE_SERVICE_ROLE_KEY：预览站默认公开，" +
        "等于把生产库的写入口递了出去。建议把密钥的环境作用域限制为 Production，" +
        "或给预览单独建一个 Supabase 项目，并开启 Deployment Protection。"
    )
  }

  return { errors, warnings }
}
