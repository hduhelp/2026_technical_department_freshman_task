import { expect, test } from "@playwright/test"
import type { TestContext } from "../helpers/supabase"
import {
  createPickup,
  itemStatus,
  pickupCount,
  withdrawItemRaw,
} from "../helpers/fixtures"
import {
  cardByTitle,
  createE2EUser,
  createPublishedItem,
  cleanupUiUser,
  newTestContext,
  signInViaUi,
  signUpViaUi,
  submitClaimWithConfirm,
  uniqueSeed,
  type E2EItem,
  type TestUser,
} from "./helpers"

const T = 30_000

/**
 * 撤单与撤回认领 —— 两个危险操作都必须二次确认。
 * - 未认领时撤单：确认框 → withdrawn → 墙上看不到、他人 404、本人详情页显示已撤单；
 * - 已被认领后：/me 不再给撤单按钮，直接调 RPC 也被 P0001 拒绝；
 * - 认领人「领错了？」：物品回到待认领，认领记录保留。
 */
test.describe("撤单与撤回认领", () => {
  let ctx: TestContext
  let owner: TestUser
  let target: E2EItem
  let control: E2EItem
  let releaseItem: E2EItem

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    ctx = newTestContext()
    owner = await createE2EUser(ctx, "owner")
    const controlOwner = await createE2EUser(ctx, "ctrl")
    const rand = Math.random().toString(36).slice(2, 6)
    target = await createPublishedItem(ctx, owner, {
      title: "E2E 待撤单 " + rand,
    })
    control = await createPublishedItem(ctx, controlOwner, {
      title: "E2E 对照 " + rand,
    })
    // 注意：挂在别人名下 —— 测试 1 需要 owner 的 /me 里只有一个「撤单」按钮，
    // 而撤回认领只要求「不是自己发布的物品」，不要求属于特定人。
    releaseItem = await createPublishedItem(ctx, controlOwner, {
      title: "E2E 撤回认领 " + rand,
    })
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test("未认领时撤单：二次确认 → 墙上消失 → 本人见已撤单 → 他人 404", async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const ownerContext = await browser.newContext()
    try {
      const page = await ownerContext.newPage()
      await signInViaUi(page, owner.phone)

      await page.goto("/")
      await expect(cardByTitle(page, control.title)).toBeVisible({ timeout: T })
      await expect(cardByTitle(page, target.title)).toBeVisible({ timeout: T })

      await page.goto("/me")
      await page.getByTestId("withdraw-open").click()
      const dialog = page.getByTestId("withdraw-confirm")
      await expect(dialog).toBeVisible({ timeout: T })
      await expect(dialog).toContainText("撤单后")

      // 取消不写库
      await page.getByTestId("withdraw-cancel").click()
      await expect(dialog).toHaveCount(0, { timeout: T })
      expect(await itemStatus(ctx, target.id)).toBe("published")

      // 确认 → 产品侧真的撤了
      await page.getByTestId("withdraw-open").click()
      await expect(dialog).toBeVisible({ timeout: T })
      await page.getByTestId("withdraw-ok").click()
      await expect
        .poll(() => itemStatus(ctx, target.id), {
          timeout: T,
          message: "撤单没有把物品置为 withdrawn（产品侧问题）",
        })
        .toBe("withdrawn")

      // 墙上消失，其它物品还在
      await page.goto("/")
      await expect(cardByTitle(page, control.title)).toBeVisible({ timeout: T })
      await expect(cardByTitle(page, target.title)).toHaveCount(0, {
        timeout: T,
      })

      // 本人详情页显示已撤单
      await page.goto("/items/" + target.id)
      await expect(page.getByTestId("pickup-withdrawn")).toBeVisible({
        timeout: T,
      })
      await expect(page.getByTestId("pickup-open")).toHaveCount(0)
    } finally {
      await ownerContext.close()
    }

    // 他人访问已撤单物品 → RLS 隐藏 → 404
    const strangerSeed = uniqueSeed("stranger")
    const strangerContext = await browser.newContext()
    try {
      const stranger = await strangerContext.newPage()
      await signUpViaUi(stranger, strangerSeed)
      const response = await stranger.goto("/items/" + target.id)
      expect(response?.status()).toBe(404)
    } finally {
      await strangerContext.close()
      await cleanupUiUser(ctx, strangerSeed)
    }
  })

  test("已被认领后：/me 没有撤单按钮，直接调 RPC 也被拒", async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const picker = await createE2EUser(ctx, "picker")
    const claimed = await createPublishedItem(ctx, owner, {
      title: "E2E 已认领 " + Math.random().toString(36).slice(2, 6),
    })
    await createPickup(picker, claimed.id)

    const ownerContext = await browser.newContext()
    try {
      const page = await ownerContext.newPage()
      await signInViaUi(page, owner.phone)
      await page.goto("/me")
      await expect(page.getByText(claimed.title).first()).toBeVisible({
        timeout: T,
      })
      // 已认领的物品仍在「我的发布」，但不给撤单按钮
      await expect(page.getByTestId("withdraw-open")).toHaveCount(0, {
        timeout: T,
      })
    } finally {
      await ownerContext.close()
    }

    // 绕过 UI 直接调 RPC：必须被 P0001 拒绝，且物品仍是 claimed
    const result = await withdrawItemRaw(owner, claimed.id)
    expect(result.error?.code).toBe("P0001")
    expect(result.error?.message).toContain("该物品已被认领，无法撤单")
    expect(await itemStatus(ctx, claimed.id)).toBe("claimed")
  })

  test("认领人「领错了？」：物品回到待认领，认领记录保留", async ({ page }) => {
    test.setTimeout(300_000)
    const seed = uniqueSeed("release")
    await signUpViaUi(page, seed)

    try {
      await page.goto("/items/" + releaseItem.id)
      await submitClaimWithConfirm(page)

      await expect(page.getByTestId("claim-release")).toBeVisible({
        timeout: T,
      })
      await page.getByTestId("claim-release-open").click()
      const dialog = page.getByTestId("claim-release-confirm")
      await expect(dialog).toBeVisible({ timeout: T })
      await expect(dialog).toContainText("撤回认领？")

      // 取消不生效
      await page.getByTestId("claim-release-cancel").click()
      await expect(dialog).toHaveCount(0, { timeout: T })
      expect(await itemStatus(ctx, releaseItem.id)).toBe("claimed")

      await page.getByTestId("claim-release-open").click()
      await page.getByTestId("claim-release-ok").click()
      await page.waitForURL(new RegExp("/items/" + releaseItem.id + "$"), {
        timeout: T,
      })

      // 回到待认领：又出现认领入口
      await expect(page.getByTestId("pickup-open")).toBeVisible({ timeout: T })
      expect(await itemStatus(ctx, releaseItem.id)).toBe("published")
      // 记录保留（数据库侧不删行）
      expect(await pickupCount(ctx, releaseItem.id)).toBe(1)

      // 没有认领记录的人停不到认领信息屏
      await page.goto("/items/" + releaseItem.id + "/claim")
      await expect(page).toHaveURL(
        new RegExp("/items/" + releaseItem.id + "$"),
        {
          timeout: T,
        }
      )
    } finally {
      await cleanupUiUser(ctx, seed)
    }
  })
})
