import { expect, test } from "@playwright/test"
import type { TestContext } from "../helpers/supabase"
import {
  cleanupUiUser,
  createE2EUser,
  createPublishedItem,
  newTestContext,
  signUpViaUi,
  uniqueSeed,
  type E2EItem,
} from "./helpers"

const T = 30_000

/**
 * 骨架屏：数据 / 图片没到位时不许白屏，更不许露出「破图 + alt 文本」。
 * 这里把两个瞬时状态都用 page.route **人为拖慢/掐断网络**，变成可稳定断言的状态。
 */
/**
 * 首屏骨架是**服务端流式**吐出来的：`app/(wall)/loading.tsx` 作为第一段 HTML 立刻发出去，
 * 真实卡片在同一个响应的后面。所以这里断言的是**同一份 HTML 里的先后顺序**（确定性），
 * 而不是「客户端跳转时看得见骨架」—— 那种瞬时状态只在几十毫秒内出现，写进用例就是掷骰子。
 */
test.describe("失物墙首屏骨架", () => {
  test("流式首屏：HTML 先吐出双列骨架，再吐真实卡片", async ({ request }) => {
    const response = await request.get("/")
    expect(response.status()).toBe(200)

    const html = await response.text()
    const skeleton = html.indexOf("wall-skeleton")
    const content = Math.max(
      html.indexOf("item-cover"),
      html.indexOf("wall-empty")
    )

    expect(skeleton).toBeGreaterThan(-1)
    expect(content).toBeGreaterThan(-1)
    // 慢网络下浏览器先画骨架，数据流到了再替换
    expect(skeleton).toBeLessThan(content)
  })
})

test.describe("详情页图片骨架", () => {
  let ctx: TestContext
  let item: E2EItem

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    ctx = newTestContext()
    const owner = await createE2EUser(ctx, "skeleton")
    item = await createPublishedItem(ctx, owner, {
      title: "E2E 骨架 " + Math.random().toString(36).slice(2, 6),
      photos: 2,
    })
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test("图片没加载完先显示骨架，加载完淡入", async ({ page }) => {
    test.setTimeout(240_000)
    const seed = uniqueSeed("skel")
    await signUpViaUi(page, seed)
    // 拖慢私有桶签名 URL 的图片请求
    await page.route(
      (url) => url.pathname.includes("/storage/v1/object/sign/"),
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        await route.continue()
      }
    )

    try {
      // 不能等 load：load 会一直等到图片下载完，那时骨架早就没了
      await page.goto("/items/" + item.id, { waitUntil: "domcontentloaded" })

      const skeleton = page.getByTestId("gallery-image-0-skeleton")
      await expect(skeleton).toBeVisible({ timeout: T })
      await expect(skeleton).toHaveCount(0, { timeout: T })
      await expect(page.getByTestId("gallery-image-0")).toBeVisible({
        timeout: T,
      })
      // 页面本身不是白屏：标题、圆点计数器都在
      await expect(
        page.getByRole("heading", { level: 1, name: item.title })
      ).toBeVisible({ timeout: T })
      await expect(page.getByTestId("gallery-counter")).toHaveText("1/2", {
        timeout: T,
      })
    } finally {
      await cleanupUiUser(ctx, seed)
    }
  })

  test("图片加载失败：显示图标占位，不出现破图与 alt 文本", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const seed = uniqueSeed("broken")
    await signUpViaUi(page, seed)
    // 直接掐断图片请求
    await page.route(
      (url) => url.pathname.includes("/storage/v1/object/sign/"),
      (route) => route.abort()
    )

    try {
      await page.goto("/items/" + item.id)

      const placeholder = page.getByTestId("gallery-image-0-error")
      await expect(placeholder).toBeVisible({ timeout: T })
      await expect(placeholder).toContainText("图片暂时无法显示")
      // <img> 仍留在 DOM 里（屏幕阅读器读得到 alt），但对用户不可见 —— 不会露破图
      await expect(
        page.getByTestId("gallery-image-0").locator("img")
      ).toHaveCSS("opacity", "0")
    } finally {
      await cleanupUiUser(ctx, seed)
    }
  })
})
