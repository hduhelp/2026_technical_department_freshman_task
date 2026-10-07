import { expect, test } from "@playwright/test"
import type { TestContext } from "../helpers/supabase"
import { itemStatus, pickupCount } from "../helpers/fixtures"
import {
  DEFAULT_REAL_NAME,
  createE2EUser,
  createPublishedItem,
  cleanupUiUser,
  newTestContext,
  phoneFor,
  signUpViaUi,
  submitClaimWithConfirm,
  uniqueSeed,
  type E2EItem,
} from "./helpers"

const T = 30_000

/**
 * 认领流程（第 7 轮语义）：
 * - 详情页只放一个入口，点开先弹「诚信认领」二次确认（只读展示自己的姓名与手机号）；
 * - 取消不写库；确认后**立刻**跳到「认领信息」独立一屏（不再等对勾）；
 * - 认领后物品置为 claimed，屏上揭晓拾主电话 / 位置。
 */
test.describe("认领流程", () => {
  let ctx: TestContext
  let keptItem: E2EItem
  let inPlaceItem: E2EItem
  const locationLabel = "图书馆 3 楼自习区靠窗第三排"

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    ctx = newTestContext()
    const owner = await createE2EUser(ctx, "owner")
    const rand = Math.random().toString(36).slice(2, 6)
    keptItem = await createPublishedItem(ctx, owner, {
      title: "E2E 钱包 " + rand,
      description: "黑色皮质钱包，内含数张卡片。",
      custody: "kept",
      contact: "13900139000",
      photos: 2,
    })
    inPlaceItem = await createPublishedItem(ctx, owner, {
      title: "E2E 雨伞 " + rand,
      custody: "in_place",
      locationLabel,
      photos: 2,
    })
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test("取消不写库；确认后立刻进认领信息并揭晓电话，刷新仍在", async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const seed = uniqueSeed("claim")
    const accountPhone = phoneFor(seed)
    await signUpViaUi(page, seed)

    try {
      await page.goto("/items/" + keptItem.id)
      await expect(page.getByTestId("item-back")).toBeVisible({ timeout: T })

      // 详情页不泄露拾主电话
      const body = await page.locator("body").innerText()
      expect(body).not.toContain(keptItem.contact)

      const open = page.getByTestId("pickup-open")
      await expect(open).toBeVisible({ timeout: T })
      await expect(open).toContainText("我要认领")
      // 认领不再是详情页里的内联表单
      await expect(page.locator("form")).toHaveCount(0)

      // 1) 点开只弹确认框，不写库
      await open.click()
      const dialog = page.getByTestId("claim-confirm")
      await expect(dialog).toBeVisible({ timeout: T })
      await expect(dialog).toContainText("诚信认领")
      await expect(page.getByTestId("claim-confirm-profile")).toContainText(
        DEFAULT_REAL_NAME
      )
      await expect(page.getByTestId("claim-confirm-profile")).toContainText(
        accountPhone
      )
      // 确认框里展示自己的号码，不能拨号
      await expect(
        page.getByTestId("claim-confirm-profile").getByTestId("phone-link")
      ).toHaveCount(0)
      expect(await pickupCount(ctx, keptItem.id)).toBe(0)

      // 2) 取消 → 仍在详情页，仍无记录
      await page.getByTestId("claim-confirm-cancel").click()
      await expect(dialog).toHaveCount(0, { timeout: T })
      expect(await pickupCount(ctx, keptItem.id)).toBe(0)
      await expect(page).toHaveURL(new RegExp("/items/" + keptItem.id + "$"))

      // 3) 确认 → 立刻跳到认领信息（不是留在详情页等对勾）
      await submitClaimWithConfirm(page)
      await expect(page).toHaveURL(
        new RegExp("/items/" + keptItem.id + "/claim$"),
        { timeout: T }
      )
      await expect(page.getByTestId("claim-guide")).toBeVisible({ timeout: T })
      await expect(page.getByTestId("reveal-contact")).toContainText(
        keptItem.contact,
        { timeout: T }
      )
      await expect(page.getByTestId("claim-info-name")).toHaveText(
        DEFAULT_REAL_NAME,
        { timeout: T }
      )
      await expect(page.getByTestId("claim-others")).toHaveCount(0)

      // 揭晓的电话是统一组件：点击先二次确认再拨号
      await page.getByTestId("reveal-contact").getByTestId("phone-link").click()
      await expect(page.getByTestId("phone-call-dialog")).toBeVisible({
        timeout: T,
      })
      await expect(page.getByTestId("phone-call-dialog")).toContainText(
        keptItem.contact
      )
      // 「确认」那一半也要真的有拨号地址，否则二次确认等于装饰
      await expect(page.getByTestId("phone-call-confirm")).toHaveAttribute(
        "href",
        "tel:" + keptItem.contact
      )
      await page.getByTestId("phone-call-cancel").click()
      await expect(page.getByTestId("phone-call-dialog")).toHaveCount(0, {
        timeout: T,
      })

      // 刷新后认领状态与揭晓都还在
      await page.reload()
      await expect(page.getByTestId("claim-guide")).toBeVisible({ timeout: T })
      await expect(page.getByTestId("reveal-contact")).toContainText(
        keptItem.contact,
        { timeout: T }
      )

      // DB：认领即归属
      expect(await pickupCount(ctx, keptItem.id)).toBe(1)
      expect(await itemStatus(ctx, keptItem.id)).toBe("claimed")

      // 本人回详情页：按钮变成「查看认领信息」
      await page.goto("/items/" + keptItem.id)
      await expect(page.getByTestId("pickup-view-info")).toBeVisible({
        timeout: T,
      })
      await expect(page.getByTestId("pickup-open")).toHaveCount(0)

      // 「我的认领」里出现这条
      await page.goto("/me")
      await page.getByRole("tab", { name: /我的认领/ }).click()
      const card = page.getByTestId("me-pickup-card").first()
      await expect(card).toBeVisible({ timeout: T })
      await expect(card).toContainText(keptItem.title)
    } finally {
      await cleanupUiUser(ctx, seed)
    }
  })

  test("留在原地：详情不含位置，认领后揭晓位置并用高德打开", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const seed = uniqueSeed("place")
    await signUpViaUi(page, seed)

    try {
      await page.goto("/items/" + inPlaceItem.id)
      await expect(page.getByTestId("item-back")).toBeVisible({ timeout: T })
      await expect(page.getByTestId("pickup-open")).toBeVisible({ timeout: T })

      const body = await page.locator("body").innerText()
      expect(body).not.toContain(locationLabel)

      await submitClaimWithConfirm(page)
      await expect(page).toHaveURL(
        new RegExp("/items/" + inPlaceItem.id + "/claim$"),
        { timeout: T }
      )
      // 不显示经纬度、也不把详情铺在按钮上：控件固定显示「查看定位」
      const reveal = page.getByTestId("reveal-location")
      const locationLink = reveal.getByTestId("location-link")
      await expect(locationLink).toHaveText("查看定位", { timeout: T })
      await expect(reveal).not.toContainText(locationLabel)
      await expect(page.getByTestId("reveal-contact")).toHaveCount(0)

      // 位置详情在二次确认框里
      await locationLink.click()
      await expect(page.getByTestId("map-open-dialog")).toBeVisible({
        timeout: T,
      })
      await expect(page.getByTestId("map-open-dialog")).toContainText(
        locationLabel
      )
      // 确认后用高德打开（只有位置描述时走搜索 URL）；
      // callnative=1 是手机端能被高德 App 接管的关键参数，必须带上
      await expect(page.getByTestId("map-open-confirm")).toHaveAttribute(
        "href",
        /^https:\/\/uri\.amap\.com\/search\?keyword=.+&callnative=1&src=campus-lost-found$/
      )
      await page.getByTestId("map-open-cancel").click()
      await expect(page.getByTestId("map-open-dialog")).toHaveCount(0, {
        timeout: T,
      })
    } finally {
      await cleanupUiUser(ctx, seed)
    }
  })
})
