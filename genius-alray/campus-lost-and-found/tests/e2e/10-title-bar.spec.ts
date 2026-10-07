import { expect, test } from "@playwright/test"
import type { TestContext } from "../helpers/supabase"
import {
  createE2EUser,
  createPublishedItem,
  cleanupUiUser,
  newTestContext,
  signUpViaUi,
  submitClaimWithConfirm,
  uniqueSeed,
  type E2EItem,
} from "./helpers"

const T = 30_000

/**
 * 统一标题栏：全站唯一，由 app/template.tsx 挂在 layout 上。
 * - /login、/signup 是扁平页，没有标题栏；
 * - 其余页面有且只有一个 header（就是标题栏），且在 main 内部；
 * - 标题按路由推导，详情页被物品名称覆盖；返回控件 testid 按路由。
 */
test.describe("统一标题栏", () => {
  let ctx: TestContext
  let item: E2EItem

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    ctx = newTestContext()
    const owner = await createE2EUser(ctx, "owner")
    item = await createPublishedItem(ctx, owner, {
      title: "E2E 标题栏 " + Math.random().toString(36).slice(2, 6),
    })
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test("登录与注册页没有标题栏", async ({ page }) => {
    test.setTimeout(120_000)
    for (const path of ["/login", "/signup"]) {
      await page.goto(path)
      await expect(
        page.getByTestId("title-bar"),
        path + " 不应有标题栏"
      ).toHaveCount(0, { timeout: T })
      await expect(page.locator("header")).toHaveCount(0, { timeout: T })
    }
  })

  test("登录后每页有且只有一个标题栏，标题按路由；首页「我的」在右上角", async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const seed = uniqueSeed("bar")
    const context = await browser.newContext()

    try {
      const page = await context.newPage()
      await signUpViaUi(page, seed)

      const cases: Array<{ path: string; title: string }> = [
        { path: "/", title: "失物招领墙" },
        { path: "/publish", title: "发布招领" },
        { path: "/me", title: "我的" },
        { path: "/me/profile", title: "我的信息" },
        { path: "/terms", title: "服务条款" },
        { path: "/privacy", title: "隐私政策" },
        { path: "/items/" + item.id, title: item.title },
      ]

      for (const route of cases) {
        await page.goto(route.path)
        await expect(
          page.getByTestId("title-bar"),
          route.path + " 应有唯一标题栏"
        ).toHaveCount(1, { timeout: T })
        // 整页只允许 1 个 header，且它就是标题栏，并且位于 main 内部
        await expect(page.locator("header")).toHaveCount(1, { timeout: T })
        await expect(
          page.locator('header[data-testid="title-bar"]')
        ).toHaveCount(1, { timeout: T })
        await expect(page.locator("main header")).toHaveCount(1, { timeout: T })
        await expect(
          page.getByRole("heading", { level: 1, name: route.title })
        ).toBeVisible({ timeout: T })
      }

      // 首页：没有底部导航，「我的」入口在视口右半边、贴着右边缘
      await page.goto("/")
      await expect(
        page.getByRole("navigation", { name: "主导航" })
      ).toHaveCount(0)
      const meEntry = page.getByTestId("me-entry")
      await expect(meEntry).toBeVisible({ timeout: T })
      const box = await meEntry.boundingBox()
      const viewport = page.viewportSize()
      expect(box).not.toBeNull()
      expect(viewport).not.toBeNull()
      expect(box!.x, "「我的」入口必须在视口右半边").toBeGreaterThan(
        viewport!.width / 2
      )
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1)

      await meEntry.click()
      await page.waitForURL(/\/me$/, { timeout: T })
    } finally {
      await context.close()
      await cleanupUiUser(ctx, seed)
    }
  })

  test("返回控件按路由：首页无返回、详情 item-back、认领页 pickup-cancel", async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const seed = uniqueSeed("back")
    const context = await browser.newContext()

    try {
      const page = await context.newPage()
      await signUpViaUi(page, seed)

      // 首页：右上角「我的」，没有返回控件
      await page.goto("/")
      await expect(page.getByTestId("me-entry")).toBeVisible({ timeout: T })
      await expect(page.getByTestId("item-back")).toHaveCount(0)

      // 发布：返回沿用路由默认，回失物墙
      await page.goto("/publish")
      await expect(page.getByRole("link", { name: "返回" })).toHaveAttribute(
        "href",
        "/"
      )

      // 详情：item-back → 失物墙
      await page.goto("/items/" + item.id)
      await expect(page.getByTestId("item-back")).toHaveAttribute("href", "/")
      await expect(
        page.getByRole("heading", { level: 1, name: item.title })
      ).toBeVisible({ timeout: T })

      // 认领信息：pickup-cancel → 回物品
      await submitClaimWithConfirm(page)
      await expect(page.getByTestId("pickup-cancel")).toHaveAttribute(
        "href",
        "/items/" + item.id
      )
      await expect(
        page.getByRole("heading", { level: 1, name: "认领信息" })
      ).toBeVisible({ timeout: T })
    } finally {
      await context.close()
      await cleanupUiUser(ctx, seed)
    }
  })
})
