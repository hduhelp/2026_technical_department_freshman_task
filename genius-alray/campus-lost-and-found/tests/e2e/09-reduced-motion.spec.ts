import { expect, test } from "@playwright/test"
import type { TestContext } from "../helpers/supabase"
import {
  cardByTitle,
  cleanupUiUser,
  newTestContext,
  phoneFor,
  photoGrid,
  signUpViaUi,
  uniqueSeed,
  uploadPhoto,
} from "./helpers"

const T = 30_000

/**
 * 动效无障碍反证：系统开启「减少动态效果」时，MotionProvider(reducedMotion="user")
 * 应让动画退化但不影响可用性 —— 元素依然可见可点，发布主流程依然能走完。
 */
test.use({ reducedMotion: "reduce" })

test.describe("减少动态效果下的发布主流程", () => {
  let ctx: TestContext
  let seed = ""

  test.beforeEach(async ({ page }) => {
    test.setTimeout(300_000)
    ctx = newTestContext()
    seed = uniqueSeed("reduce")
    await signUpViaUi(page, seed)
  })

  test.afterEach(async () => {
    await cleanupUiUser(ctx, seed)
  })

  test("元素始终可用，四屏能走完", async ({ page }) => {
    // 先确认环境真的生效（避免选项没带上导致「假验证」）
    const reduced = await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
    expect(reduced).toBe(true)

    const editedTitle = "E2E 降动 " + Math.random().toString(36).slice(2, 6)
    await page.goto("/publish")
    await expect(page.getByTestId("photo-add")).toBeVisible({ timeout: T })

    await uploadPhoto(page, "photo-1.png")
    await expect(photoGrid(page)).toHaveCount(1, { timeout: 60_000 })

    // 只有一张 → 补拍建议对话框也必须正常出现（对话框不是「循环动效」）
    await page.getByRole("button", { name: "下一步" }).click()
    await expect(page.getByTestId("photo-advice-dialog")).toBeVisible({
      timeout: T,
    })
    await page.getByTestId("photo-advice-skip").click()

    await expect(page.locator("#title")).toBeVisible({ timeout: T })
    await expect(page.locator("#title")).not.toHaveValue("", {
      timeout: 60_000,
    })
    await page.locator("#title").fill(editedTitle)
    await page.getByRole("button", { name: "下一步" }).click()

    await expect(page.getByTestId("custody-kept")).toBeVisible({ timeout: T })
    await page.getByTestId("custody-kept").click()
    await expect(page.getByText(phoneFor(seed))).toBeVisible({ timeout: T })

    await page.getByRole("button", { name: "发布", exact: true }).click()
    await expect(page.getByTestId("publish-success")).toBeVisible({
      timeout: T,
    })
    await page.waitForURL(/\/$/, { timeout: T })
    await expect(cardByTitle(page, editedTitle)).toBeVisible({ timeout: T })
  })
})
