import { expect, test } from "@playwright/test"
import type { TestContext } from "../helpers/supabase"
import { itemStatus } from "../helpers/fixtures"
import {
  cardByTitle,
  createE2EUser,
  createPublishedItem,
  cleanupUiUser,
  newTestContext,
  phoneFor,
  signInViaUi,
  signUpViaUi,
  submitClaimWithConfirm,
  uniqueSeed,
  type E2EItem,
  type TestUser,
} from "./helpers"

const T = 30_000

/**
 * 多人认领（第 7 轮起允许）：认领只是登记，归属靠线下协商。
 * - 第一个人认领后，第二个人的详情页显示「已有人认领」+「我也要认领」；
 * - 认领信息屏要提示「还有 N 个人也认领了」并给出对方电话；
 * - 拾主在「我的发布 → 查看认领人」能看到全部人选。
 */
test.describe("多人认领与认领人名单", () => {
  let ctx: TestContext
  let owner: TestUser
  let item: E2EItem

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    ctx = newTestContext()
    owner = await createE2EUser(ctx, "owner")
    item = await createPublishedItem(ctx, owner, {
      title: "E2E 多人认领 " + Math.random().toString(36).slice(2, 6),
      custody: "kept",
      contact: "13900139000",
      photos: 2,
    })
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test("第二个人也能认领；认领信息屏给出其他认领人；拾主看到完整名单", async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const seedA = uniqueSeed("pickerA")
    const seedB = uniqueSeed("pickerB")

    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const ownerContext = await browser.newContext()

    try {
      // 第一个人（张三）认领
      const pageA = await ctxA.newPage()
      await signUpViaUi(pageA, seedA, { realName: "张三" })
      await pageA.goto("/items/" + item.id)
      await expect(pageA.getByTestId("pickup-open")).toContainText("我要认领")
      await submitClaimWithConfirm(pageA)
      await expect(pageA.getByTestId("claim-info-name")).toHaveText("张三", {
        timeout: T,
      })
      expect(await itemStatus(ctx, item.id)).toBe("claimed")

      // 第二个人（李四）：看到「已有人认领」，但仍然可以认领
      const pageB = await ctxB.newPage()
      await signUpViaUi(pageB, seedB, { realName: "李四" })
      await pageB.goto("/items/" + item.id)
      await expect(pageB.getByTestId("pickup-claimed")).toBeVisible({
        timeout: T,
      })
      const openB = pageB.getByTestId("pickup-open")
      await expect(openB).toContainText("我也要认领")
      await submitClaimWithConfirm(pageB)

      // 认领信息屏：提示还有 1 个人也认领了，并能直接联系对方
      const others = pageB.getByTestId("claim-others")
      await expect(others).toBeVisible({ timeout: T })
      await expect(others).toContainText("还有 1 个人也认领了")
      await expect(others).toContainText("张三")
      await expect(
        others.getByTestId("claim-other-phone").first()
      ).toContainText(phoneFor(seedA))
      await expect(pageB.getByTestId("claim-info-name")).toHaveText("李四", {
        timeout: T,
      })

      // 已认领的物品仍然留在墙上，并带「已认领」角标
      await pageB.goto("/")
      const wallCard = cardByTitle(pageB, item.title)
      await expect(wallCard).toBeVisible({ timeout: T })
      await expect(wallCard).toContainText("已认领", { timeout: T })

      // 拾主：/me → 查看认领人 → 两个人都在
      const ownerPage = await ownerContext.newPage()
      await signInViaUi(ownerPage, owner.phone)
      await ownerPage.goto("/me")
      const link = ownerPage.locator(
        'a[href="/me/items/' + item.id + '/pickups"]'
      )
      await expect(link).toBeVisible({ timeout: T })
      await link.click()
      await ownerPage.waitForURL(
        new RegExp("/me/items/" + item.id + "/pickups"),
        { timeout: T }
      )
      await expect(ownerPage.getByText("认领人（2）")).toBeVisible({
        timeout: T,
      })
      await expect(ownerPage.getByText("张三")).toBeVisible({ timeout: T })
      await expect(ownerPage.getByText("李四")).toBeVisible({ timeout: T })
      await expect(ownerPage.getByText(phoneFor(seedA))).toBeVisible({
        timeout: T,
      })
      await expect(ownerPage.getByText(phoneFor(seedB))).toBeVisible({
        timeout: T,
      })
      // 已被认领 → 「我的发布」里那件物品不再给撤单按钮（owner 名下只有这一件）
      await ownerPage.goto("/me")
      await expect(ownerPage.getByText(item.title).first()).toBeVisible({
        timeout: T,
      })
      await expect(ownerPage.getByTestId("withdraw-open")).toHaveCount(0, {
        timeout: T,
      })
    } finally {
      await ctxA.close()
      await ctxB.close()
      await ownerContext.close()
      // 删除认领人必须在断言之后：pickups.picker_id 是 on delete cascade
      await cleanupUiUser(ctx, seedA)
      await cleanupUiUser(ctx, seedB)
    }
  })
})
