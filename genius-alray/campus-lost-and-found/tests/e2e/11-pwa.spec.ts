import { expect, test } from "@playwright/test"

const T = 30_000

/**
 * PWA 外壳：清单、图标、iOS 元信息，以及「未登录也能拿到离线页」这条代理规则。
 *
 * 这里**不**验证 Service Worker 的缓存行为：SW 只在生产构建里注册
 * （见 components/pwa/service-worker-register.tsx），而 E2E 跑的是 `pnpm dev`。
 * 缓存策略的纪律由 tests/unit/pwa.test.ts 守。
 *
 * 用 /login 是因为它未登录可达、又不依赖数据库；布局元信息对所有页面一致。
 */
test.describe("PWA 外壳", () => {
  test("页面带着 manifest / apple-touch-icon / theme-color", async ({
    page,
  }) => {
    await page.goto("/login")

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest"
    )
    // iOS 的「添加到主屏幕」认 apple-* 这一条，标准名由 Next 自动输出，两条都要在
    await expect(
      page.locator('meta[name="apple-mobile-web-app-capable"]')
    ).toHaveAttribute("content", "yes")
    await expect(
      page.locator('meta[name="mobile-web-app-capable"]')
    ).toHaveAttribute("content", "yes")
    await expect(
      page.locator('meta[name="apple-mobile-web-app-title"]')
    ).toHaveAttribute("content", "失物招领")
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
    // 状态栏颜色：浅色/深色各一条由 metadata 生成，各一条由 StatusBarKeeper 镜像。
    // 镜像那份不归 React 管 —— 路由切换时 Next 会重建 <head>，只有它留得住（防闪白）。
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(4)
    await expect(
      page.locator('meta[name="theme-color"]:not([data-status-bar-keeper])')
    ).toHaveCount(2)
    await expect(
      page.locator('meta[name="theme-color"][data-status-bar-keeper]')
    ).toHaveCount(2)
  })

  test("清单可解析，图标真的能取到且是 PNG", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest")
    expect(res.status()).toBe(200)

    const manifest = await res.json()
    expect(manifest.name).toBe("校园失物招领")
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toBe("/")

    const icons = manifest.icons as Array<{
      src: string
      sizes: string
      purpose: string
    }>
    expect(
      icons.some((i) => i.sizes === "192x192" && i.purpose === "any")
    ).toBe(true)
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true)

    for (const icon of icons) {
      const asset = await request.get(icon.src)
      expect(asset.status(), icon.src).toBe(200)
      expect(asset.headers()["content-type"], icon.src).toContain("image/png")
    }
  })

  test("离线页未登录也能打开（不能被 proxy 重定向到 /login）", async ({
    page,
  }) => {
    await page.goto("/offline")
    await expect(page).toHaveURL(/\/offline$/)
    await expect(
      page.getByRole("heading", { name: "当前没有网络连接" })
    ).toBeVisible({ timeout: T })
    await expect(page.getByTestId("offline-retry")).toBeVisible()
  })

  test("sw.js 是 JavaScript 且不被缓存（否则永远更新不到新版本）", async ({
    request,
  }) => {
    const res = await request.get("/sw.js")
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toContain("javascript")
    expect(res.headers()["cache-control"]).toContain("no-store")
  })

  test("拦截浏览器安装提示，改由首页标题栏的「安装应用」按钮触发", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByTestId("title-bar")).toBeVisible({ timeout: T })
    // 等 hydration：StatusBarKeeper 只在客户端挂载后才插入这个 meta
    await page.waitForFunction(
      () => document.querySelector("meta[data-status-bar-keeper]") !== null
    )

    // 真正的 beforeinstallprompt 只在「可安装且未安装」时由浏览器给出，
    // 这里造一个同形状的事件，验证我们拦下默认提示并让按钮去调 prompt()
    const defaultPrevented = await page.evaluate(() => {
      const state = window as unknown as { __installPromptCalls: number }
      state.__installPromptCalls = 0
      const event = new Event("beforeinstallprompt", {
        cancelable: true,
      }) as Event & {
        prompt: () => Promise<void>
        userChoice: Promise<{ outcome: string }>
      }
      event.prompt = async () => {
        state.__installPromptCalls += 1
      }
      event.userChoice = Promise.resolve({ outcome: "accepted" })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(defaultPrevented).toBe(true)

    const button = page.getByTestId("install-app")
    await expect(button).toBeVisible({ timeout: T })
    await expect(button).toHaveText("安装应用")

    await button.click()
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __installPromptCalls: number })
            .__installPromptCalls
      )
    ).toBe(1)
  })

  test("全站安全响应头真的下发了（CSP / nosniff / 禁止嵌入 / 无 X-Powered-By）", async ({
    page,
  }) => {
    const response = await page.goto("/")
    const headers = response?.headers() ?? {}

    const csp = headers["content-security-policy"] ?? ""
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    // 浏览器端要直连 Supabase，CSP 必须放行它，否则登录会直接崩
    expect(csp).toContain(
      new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321")
        .origin
    )

    expect(headers["x-content-type-options"]).toBe("nosniff")
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")
    expect(headers["x-frame-options"]).toBe("DENY")
    expect(headers["x-powered-by"]).toBeUndefined()
  })
})
