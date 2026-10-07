import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * lib/env.ts 的运行时校验（第 10 轮）：
 * - 环境变量缺失/写错时给出**看得懂**的提示，而不是一个 ZodError("Invalid input")
 * - 生产环境不允许「静默的假 AI」
 */

const REQUIRED = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefg.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
}

async function loadEnv(overrides: Record<string, string> = {}) {
  vi.resetModules()
  for (const [key, value] of Object.entries({ ...REQUIRED, ...overrides })) {
    vi.stubEnv(key, value)
  }
  return import("@/lib/env")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("lib/env 运行期校验", () => {
  it("缺 SUPABASE_SERVICE_ROLE_KEY 时点名报错", async () => {
    const { serverEnv } = await loadEnv({ SUPABASE_SERVICE_ROLE_KEY: "" })
    expect(() => serverEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it("AI_PROVIDER=ai-sdk 却没给 KEY/MODEL 时点名报错", async () => {
    const { serverEnv } = await loadEnv({
      AI_PROVIDER: "ai-sdk",
      AI_API_KEY: "",
      AI_MODEL: "deepseek-flash",
    })
    expect(() => serverEnv()).toThrow(/AI_API_KEY/)
  })

  it("生产环境（VERCEL_ENV=production）仍是 mock 时拒绝启动", async () => {
    const { serverEnv } = await loadEnv({
      VERCEL_ENV: "production",
      AI_PROVIDER: "mock",
      ALLOW_MOCK_AI: "",
    })
    expect(() => serverEnv()).toThrow(/AI_PROVIDER/)
  })

  it("显式 ALLOW_MOCK_AI=1 时生产环境也放行", async () => {
    const { serverEnv } = await loadEnv({
      VERCEL_ENV: "production",
      AI_PROVIDER: "mock",
      ALLOW_MOCK_AI: "1",
    })
    expect(serverEnv().AI_PROVIDER).toBe("mock")
  })

  it("配置齐全时可以读出配置", async () => {
    const { serverEnv } = await loadEnv({
      AI_PROVIDER: "ai-sdk",
      AI_API_KEY: "sk-x",
      AI_MODEL: "m",
    })
    expect(serverEnv().AI_PROVIDER).toBe("ai-sdk")
    expect(serverEnv().NEXT_PUBLIC_SUPABASE_URL).toBe(
      REQUIRED.NEXT_PUBLIC_SUPABASE_URL
    )
  })

  it("phoneToEmail：手机号去掉非数字后拼内部域名", async () => {
    const { phoneToEmail } = await loadEnv({
      NEXT_PUBLIC_AUTH_EMAIL_DOMAIN: "campus.local",
    })
    expect(phoneToEmail("138-0013-8000")).toBe("13800138000@campus.local")
  })
})
