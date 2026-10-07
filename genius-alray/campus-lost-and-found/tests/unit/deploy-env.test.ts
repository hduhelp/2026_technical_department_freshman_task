import { describe, expect, it } from "vitest"
import { checkDeployEnv, REQUIRED_AT_BUILD } from "@/lib/deploy-env"

/**
 * 部署前哨（第 10 轮）：这几条规则只有在真正上线时才会第一次生效，
 * 所以必须在这里把「什么时候该拦住构建」钉死。
 */
const BASE = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefg.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  AI_PROVIDER: "ai-sdk",
  AI_API_KEY: "sk-xxx",
  AI_MODEL: "deepseek-flash",
  // 生产环境的 Cloudflare sitekey（公开值）；留空会触发一条警告，见下面的用例
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
}

describe("部署环境检查", () => {
  it("本地开发（非 production）一律不检查，免得连 dev 都起不来", () => {
    const check = checkDeployEnv({ NODE_ENV: "development" })
    expect(check.errors).toEqual([])
    expect(check.warnings).toEqual([])
  })

  it("变量齐全的生产构建没有任何错误", () => {
    const check = checkDeployEnv({ ...BASE, VERCEL_ENV: "production" })
    expect(check.errors).toEqual([])
    expect(check.warnings).toEqual([])
  })

  it("缺任一必需变量都报错，且点名具体是哪几个", () => {
    for (const key of REQUIRED_AT_BUILD) {
      const env: Record<string, string | undefined> = { ...BASE }
      delete env[key]
      const check = checkDeployEnv(env)
      expect(check.errors.join("\n"), key).toContain(key)
    }
  })

  it("NEXT_PUBLIC_SUPABASE_URL 不是合法 URL 也算错（CSP 直接依赖它）", () => {
    const check = checkDeployEnv({
      ...BASE,
      NEXT_PUBLIC_SUPABASE_URL: "不是网址",
    })
    expect(check.errors.join("\n")).toContain("不是合法 URL")
  })

  it("生产环境 AI_PROVIDER 还是 mock：拦住构建", () => {
    const check = checkDeployEnv({
      ...BASE,
      VERCEL_ENV: "production",
      AI_PROVIDER: "mock",
    })
    expect(check.errors.join("\n")).toContain("AI_PROVIDER")
  })

  it("显式声明 ALLOW_MOCK_AI=1 时放行", () => {
    const check = checkDeployEnv({
      ...BASE,
      VERCEL_ENV: "production",
      AI_PROVIDER: "mock",
      ALLOW_MOCK_AI: "1",
    })
    expect(check.errors).toEqual([])
  })

  it("预览环境用 mock 不拦（预览没有真实用户）", () => {
    const check = checkDeployEnv({
      ...BASE,
      VERCEL_ENV: "preview",
      AI_PROVIDER: "mock",
    })
    expect(check.errors).toEqual([])
  })

  it("生产环境没配 Turnstile sitekey：给警告（Supabase 开了 CAPTCHA 就会全挂）", () => {
    const check = checkDeployEnv({
      ...BASE,
      VERCEL_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
    })
    expect(check.errors).toEqual([])
    expect(check.warnings.join("\n")).toContain(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY"
    )
  })

  it("预览部署拿到 service_role 密钥：给警告而不是错误", () => {
    const check = checkDeployEnv({ ...BASE, VERCEL_ENV: "preview" })
    expect(check.errors).toEqual([])
    expect(check.warnings.join("\n")).toContain("SUPABASE_SERVICE_ROLE_KEY")
  })
})
