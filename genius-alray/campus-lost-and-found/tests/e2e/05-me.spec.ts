import { expect, test } from "@playwright/test"
import type { TestContext } from "../helpers/supabase"
import {
  E2E_PASSWORD,
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
 * 「我的」与个人信息（第 7 轮语义）：
 * - 注册即填写真实姓名 + 手机号，认领时直接复用（不再有「认领时补填」）；
 * - 顶部卡片是头像 + 姓名 + 手机号，右侧是退出登录；
 * - 两个标签页一屏只放一段列表；认领卡片整卡进详情，不内联手机号。
 */
test.describe("我的与个人信息", () => {
  let ctx: TestContext
  let item: E2EItem

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    ctx = newTestContext()
    const owner = await createE2EUser(ctx, "owner")
    item = await createPublishedItem(ctx, owner, {
      title: "E2E 我的 " + Math.random().toString(36).slice(2, 6),
      custody: "kept",
      contact: "13900139000",
      photos: 1,
    })
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test("注册即带个人信息；可以修改；认领时只读展示", async ({ page }) => {
    test.setTimeout(300_000)
    const seed = uniqueSeed("me")
    const accountPhone = phoneFor(seed)
    await signUpViaUi(page, seed, { realName: "王小明" })

    try {
      // 顶部卡片来自注册信息
      await page.goto("/")
      await page.getByTestId("me-entry").click()
      await page.waitForURL(/\/me$/, { timeout: T })
      await expect(page.getByTestId("profile-entry")).toContainText("王小明", {
        timeout: T,
      })
      await expect(page.getByTestId("profile-entry")).toContainText(
        accountPhone
      )
      // 头像用姓名首字（不是图片）
      await expect(
        page.getByTestId("profile-entry").getByText("王", { exact: true })
      ).toBeVisible()

      // 改姓名 → 读回
      await page.getByTestId("profile-entry").click()
      await page.waitForURL(/\/me\/profile$/, { timeout: T })
      await page.locator("#profile-name").fill("李四")
      await page.getByTestId("profile-submit").click()
      await page.waitForURL(/\/me$/, { timeout: T })
      await expect(page.getByTestId("profile-entry")).toContainText("李四", {
        timeout: T,
      })

      // 「我的信息」支持 ?next=（认领流程会带来源页）：返回键指向来源而不是「我的」
      await page.goto("/me/profile?next=/items/" + item.id)
      await expect(page.getByRole("link", { name: "返回" })).toHaveAttribute(
        "href",
        "/items/" + item.id
      )

      // 认领：确认框里只读展示账号信息，号码不可拨号
      await page.goto("/items/" + item.id)
      await page.getByTestId("pickup-open").click()
      const profileBox = page.getByTestId("claim-confirm-profile")
      await expect(profileBox).toContainText("李四", { timeout: T })
      await expect(profileBox).toContainText(accountPhone)
      await expect(profileBox.getByTestId("phone-link")).toHaveCount(0)

      await page.getByTestId("claim-confirm-ok").click()
      await expect(page.getByTestId("claim-guide")).toBeVisible({ timeout: T })
      await expect(page.getByTestId("claim-info-name")).toHaveText("李四", {
        timeout: T,
      })
    } finally {
      await cleanupUiUser(ctx, seed)
    }
  })

  test("标签页一屏一段列表；退出登录必须二次确认", async ({ page }) => {
    test.setTimeout(300_000)
    const seed = uniqueSeed("tab")
    await signUpViaUi(page, seed)

    try {
      await page.goto("/items/" + item.id)
      await submitClaimWithConfirm(page)

      await page.goto("/me")
      const publishedTab = page.getByRole("tab", { name: /我的发布/ })
      const pickupsTab = page.getByRole("tab", { name: /我的认领/ })
      await expect(publishedTab).toBeVisible({ timeout: T })
      await expect(pickupsTab).toBeVisible({ timeout: T })

      // 默认只看到「我的发布」：发布面板真的渲染了（该账号还没发布过 → 空态），
      // 且认领卡片不在这屏
      await expect(page.getByText("还没有发布")).toBeVisible({ timeout: T })
      await expect(page.getByTestId("me-pickup-card")).toHaveCount(0)

      await pickupsTab.click()
      const card = page.getByTestId("me-pickup-card").first()
      await expect(card).toBeVisible({ timeout: T })
      // 切到认领后，发布那段列表不再占屏
      await expect(page.getByText("还没有发布")).toHaveCount(0)
      await expect(card).toContainText(item.title)
      // 列表里不再内联手机号
      await expect(card).not.toContainText("13900139000")

      // 整卡点进详情
      await card.click()
      await page.waitForURL(new RegExp("/items/" + item.id + "$"), {
        timeout: T,
      })

      // 退出登录：入口在顶部卡片右侧（用位置断言，不是只断言存在）
      await page.goto("/me")
      const signOut = page.getByTestId("sign-out")
      await expect(signOut).toBeVisible({ timeout: T })
      const signOutBox = await signOut.boundingBox()
      const viewport = page.viewportSize()
      expect(signOutBox).not.toBeNull()
      expect(viewport).not.toBeNull()
      expect(signOutBox!.x, "退出登录必须在顶部卡片右侧").toBeGreaterThan(
        viewport!.width / 2
      )

      // 二次确认，取消则留在原地
      await signOut.click()
      const dialog = page.getByTestId("sign-out-confirm")
      await expect(dialog).toBeVisible({ timeout: T })
      await page.getByTestId("sign-out-cancel").click()
      await expect(dialog).toHaveCount(0, { timeout: T })
      await expect(page).toHaveURL(/\/me$/)

      await page.getByTestId("sign-out").click()
      await page.getByTestId("sign-out-ok").click()
      await page.waitForURL(/\/login/, { timeout: T })

      // 退出后进不去「我的」
      await page.goto("/me")
      await expect(page).toHaveURL(/\/login/, { timeout: T })
    } finally {
      await cleanupUiUser(ctx, seed)
    }
  })

  /**
   * 回归：手机号就是账号（内部邮箱 <手机号>@<域名>）。
   * 只把资料里的手机号改掉、不同步登录账号，用户就被锁在门外 ——
   * 资料显示新号，登录却只认旧号。
   */
  test("改手机号后：新手机号能登录，旧手机号不能", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000)
    const seed = uniqueSeed("phone")
    const oldPhone = phoneFor(seed)
    const newPhone = phoneFor(uniqueSeed("newphone"))
    await signUpViaUi(page, seed)

    try {
      await page.goto("/me/profile")
      await page.locator("#profile-phone").fill(newPhone)
      await page.getByTestId("profile-submit").click()
      await page.waitForURL(/\/me$/, { timeout: T })

      // 干净会话 1：新手机号能登进来
      const newSession = await browser.newContext()
      try {
        const freshPage = await newSession.newPage()
        await freshPage.goto("/login")
        await freshPage.fill("#phone", newPhone)
        await freshPage.fill("#password", E2E_PASSWORD)
        await freshPage
          .getByRole("button", { name: "登录", exact: true })
          .click()
        await expect(freshPage).toHaveURL(/\/$/, { timeout: T })
      } finally {
        await newSession.close()
      }

      // 干净会话 2：旧手机号不再是账号。
      // 必须**另开** context：上一次登录已经写进 cookie，同一个 context 再打开 /login
      // 会被 proxy 的乐观跳转弹回首页，于是页面上根本没有输入框可填。
      const oldSession = await browser.newContext()
      try {
        const stalePage = await oldSession.newPage()
        await stalePage.goto("/login")
        await stalePage.fill("#phone", oldPhone)
        await stalePage.fill("#password", E2E_PASSWORD)
        await stalePage
          .getByRole("button", { name: "登录", exact: true })
          .click()
        await expect(stalePage.getByText(/手机号或密码不正确/)).toBeVisible({
          timeout: T,
        })
        await expect(stalePage).toHaveURL(/\/login/)
      } finally {
        await oldSession.close()
      }
    } finally {
      // 邮箱已经跟着新手机号走了，必须按新号反查才能删掉这个账号
      await cleanupUiUser(ctx, seed, newPhone)
    }
  })
})
