// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Turnstile 组件（第 10 轮）。
 *
 * 这里只钉两件事，都是「配置切换时最容易出事」的边界：
 * - 没配 sitekey（本地开发 / 自动化测试）：整块人机校验必须消失，
 *   连第三方脚本都不许注入 —— 否则测试环境会去打外网。
 * - 配了 sitekey：挑战容器要真的渲染出来。
 *
 * 真正的挑战交互由 Cloudflare 的 iframe 负责，jsdom 里没有意义去模拟。
 */

const initialState = {}

async function loadWidget(siteKey: string) {
  vi.resetModules()
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", siteKey)
  const loaded = await import("@/components/auth/turnstile-widget")
  return loaded.TurnstileWidget
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("Turnstile 组件", () => {
  it("没配 sitekey：不渲染、不注入第三方脚本", async () => {
    const TurnstileWidget = await loadWidget("")
    render(<TurnstileWidget onToken={() => {}} resetSignal={initialState} />)

    expect(screen.queryByTestId("turnstile")).toBeNull()
    expect(
      document.querySelectorAll("script[src*='challenges.cloudflare.com']")
    ).toHaveLength(0)
  })

  it("配了 sitekey：渲染挑战容器", async () => {
    const TurnstileWidget = await loadWidget("1x00000000000000000000AA")
    render(<TurnstileWidget onToken={() => {}} resetSignal={initialState} />)

    expect(screen.getByTestId("turnstile")).toBeTruthy()
  })
})
