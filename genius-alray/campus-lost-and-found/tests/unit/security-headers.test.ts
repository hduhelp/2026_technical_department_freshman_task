import { describe, expect, it } from "vitest"
import nextConfig from "@/next.config"

type HeaderRule = {
  source: string
  headers: Array<{ key: string; value: string }>
}

async function headerRules(): Promise<HeaderRule[]> {
  const headers = nextConfig.headers as unknown as
    (() => Promise<HeaderRule[]>) | undefined
  if (!headers) throw new Error("next.config 没有配置 headers")
  return await headers()
}

function valueOf(rule: HeaderRule, key: string): string | undefined {
  return rule.headers.find((header) => header.key === key)?.value
}

/**
 * 安全响应头（第 9 轮）：站内存着姓名与手机号，CSP 与这几个头是 XSS /
 * 点击劫持之外最后能兜住的一层。断言的是「配置真的下发了」，
 * 不依赖 NODE_ENV（HSTS 与 'unsafe-eval' 只在非 dev 出现，故意不在这里断言）。
 */
describe("next.config 安全响应头", () => {
  it("全站规则包含 CSP / nosniff / Referrer-Policy / 禁止嵌入", async () => {
    const rule = (await headerRules()).find((item) => item.source === "/:path*")
    expect(rule, "缺少全站 headers 规则").toBeDefined()

    expect(valueOf(rule!, "X-Content-Type-Options")).toBe("nosniff")
    expect(valueOf(rule!, "Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    )
    expect(valueOf(rule!, "X-Frame-Options")).toBe("DENY")

    const csp = valueOf(rule!, "Content-Security-Policy")
    expect(csp).toBeTruthy()
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "manifest-src 'self'",
    ]) {
      expect(csp, directive).toContain(directive)
    }
  })

  it("CSP 放行 Supabase origin（浏览器端要直连它登录/读公开列）", async () => {
    const rule = (await headerRules()).find((item) => item.source === "/:path*")
    const csp = valueOf(rule!, "Content-Security-Policy") ?? ""
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (url) {
      expect(csp).toContain(new URL(url).origin)
    }
  })

  it("CSP 放行 Turnstile（登录/注册的人机校验是跨源脚本 + 跨源 iframe）", async () => {
    const rule = (await headerRules()).find((item) => item.source === "/:path*")
    const csp = valueOf(rule!, "Content-Security-Policy") ?? ""
    const origin = "https://challenges.cloudflare.com"
    expect(csp).toContain("script-src 'self' 'unsafe-inline' " + origin)
    expect(csp).toContain("frame-src 'self' " + origin)
  })

  it("HSTS 不带 includeSubDomains（该域名下的其他子域不归我们管）", async () => {
    const rule = (await headerRules()).find((item) => item.source === "/:path*")
    const hsts = valueOf(rule!, "Strict-Transport-Security")
    // 非 dev 环境才下发；测试环境 NODE_ENV=test，因此这里一定有值
    expect(hsts).toContain("max-age=63072000")
    expect(hsts).not.toContain("includeSubDomains")
  })

  it("sw.js 的缓存头没有被安全头挤掉（否则永远更新不到新版本）", async () => {
    const rule = (await headerRules()).find((item) => item.source === "/sw.js")
    expect(rule).toBeDefined()
    expect(valueOf(rule!, "Cache-Control")).toContain("no-store")
  })

  it("关掉 X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })
})
