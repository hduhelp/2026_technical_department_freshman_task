import { expect, test } from "@playwright/test"
import type { TestContext } from "../helpers/supabase"
import {
  createE2EUser,
  createPublishedItem,
  cleanupUiUser,
  newTestContext,
  signUpViaUi,
  uniqueSeed,
  type E2EItem,
} from "./helpers"

const T = 30_000

/**
 * 物品详情：原生 scroll-snap 相册（没有左右箭头）。
 * 计数器与圆点 aria-current 跟着滚动走，页面不许横向溢出。
 */
test.describe("物品详情相册", () => {
  let ctx: TestContext
  let item: E2EItem

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    ctx = newTestContext()
    const owner = await createE2EUser(ctx, "owner")
    item = await createPublishedItem(ctx, owner, {
      title: "E2E 相册 " + Math.random().toString(36).slice(2, 6),
      photos: 2,
    })
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test("滚动切换 + 圆点同步 + 圆点跳转，且无横向溢出", async ({ page }) => {
    test.setTimeout(240_000)
    const seed = uniqueSeed("swiper")
    await signUpViaUi(page, seed)

    try {
      await page.goto("/items/" + item.id)
      await expect(
        page.getByRole("heading", { level: 1, name: item.title })
      ).toBeVisible({ timeout: T })
      await expect(page.getByTestId("item-back")).toHaveAttribute("href", "/")

      const track = page.getByTestId("gallery-track")
      const counter = page.getByTestId("gallery-counter")
      await expect(track).toBeVisible({ timeout: T })
      await expect(counter).toHaveText("1/2", { timeout: T })
      await expect(page.getByTestId("gallery-dot-0")).toHaveAttribute(
        "aria-current",
        "true"
      )

      // 原生横向滚动到第二张（等价于手指左滑后的落点）
      await track.evaluate((el) => {
        el.scrollLeft = el.clientWidth
      })
      await expect(counter).toHaveText("2/2", { timeout: T })
      await expect(page.getByTestId("gallery-dot-1")).toHaveAttribute(
        "aria-current",
        "true"
      )

      // 点第 1 个圆点跳回第一张
      await page.getByTestId("gallery-dot-0").click()
      await expect(counter).toHaveText("1/2", { timeout: T })
      await expect(page.getByTestId("gallery-dot-0")).toHaveAttribute(
        "aria-current",
        "true"
      )

      // 移动端无横向溢出
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      )
      expect(overflow).toBeLessThanOrEqual(1)
    } finally {
      await cleanupUiUser(ctx, seed)
    }
  })
})
