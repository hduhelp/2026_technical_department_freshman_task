import { expect, test } from "@playwright/test"
import type { TestContext } from "../helpers/supabase"
import {
  cardByTitle,
  cleanupUiUser,
  newTestContext,
  phoneFor,
  photoGrid,
  signInViaUi,
  signUpViaUi,
  uiUserId,
  uniqueSeed,
  uploadPhoto,
  uploadPhotos,
} from "./helpers"

const T = 30_000

/**
 * 发布向导：四屏（拍照 → 确认信息 → 怎么还 → 详细设置）。
 * - 一屏只做一件事：拍照屏没有任何文本输入，也没有步骤条；
 * - 点「下一步」时才让 AI 看一遍照片（全屏 photo-check-loading），建议永远可跳过；
 * - 第 2 屏识别期间全屏加载且不渲染输入框（防「两套输入框」）；
 * - 上限 3 张、不提示数量；「代为保管」直接用账号手机号，不再问联系方式。
 */
test.describe("发布向导", () => {
  let ctx: TestContext
  let seed = ""

  test.beforeEach(async ({ page }) => {
    test.setTimeout(300_000)
    ctx = newTestContext()
    seed = uniqueSeed("pub")
    await signUpViaUi(page, seed)
  })

  test.afterEach(async () => {
    await cleanupUiUser(ctx, seed)
  })

  test("三张照片 → 全屏识别 → 代为保管 → 发布成功", async ({ page }) => {
    const accountPhone = phoneFor(seed)
    const editedTitle = "E2E 发布 " + Math.random().toString(36).slice(2, 6)

    await page.goto("/publish")
    await expect(
      page.getByRole("heading", { level: 1, name: "发布招领" })
    ).toBeVisible({ timeout: T })

    // 拍照屏只做拍照：没有文本表单，也没有「确认信息」这类步骤提示
    await expect(page.getByTestId("photo-add")).toBeVisible({ timeout: T })
    await expect(
      page.locator('input[type="text"], input[type="tel"], textarea')
    ).toHaveCount(0)
    await expect(page.getByText("确认信息")).toHaveCount(0)

    // 照片网格的最后一个元素必须是「添加照片」
    await uploadPhotos(page, 2)
    const addTileIsLast = await page
      .getByTestId("photo-add")
      .evaluate(
        (el) =>
          el.parentElement === el.parentElement?.parentElement?.lastElementChild
      )
    expect(addTileIsLast, "「添加照片」必须是网格的最后一个").toBe(true)

    // 上限 3 张：满了以后「添加照片」消失，且界面从不报张数
    await uploadPhoto(page, "photo-3.png")
    await expect(photoGrid(page)).toHaveCount(3, { timeout: 60_000 })
    await expect(page.getByTestId("photo-add")).toHaveCount(0, {
      timeout: T,
    })
    await expect(page.getByText(/已上传\s*\d/)).toHaveCount(0)

    await page.getByRole("button", { name: "下一步" }).click()

    // 点「下一步」才检查一次照片（全屏）
    await expect(page.getByTestId("photo-check-loading")).toBeVisible({
      timeout: T,
    })

    // 第 2 屏：识别期间全屏加载，屏幕上没有输入框
    await expect(page.getByTestId("analyze-loading")).toBeVisible({
      timeout: T,
    })
    await expect(page.locator("#title")).toHaveCount(0)
    // 检查已经结束（否则对话框根本没机会出现）：3 张 → 不该给补拍建议
    await expect(page.getByTestId("photo-advice-dialog")).toHaveCount(0)
    await expect(page.getByTestId("photo-advice-skip")).toHaveCount(0)

    await expect(page.locator("#title")).toBeVisible({ timeout: 60_000 })
    await expect(page.locator("#title")).not.toHaveValue("", {
      timeout: 60_000,
    })
    // mock 的描述里带张数：证明三张照片真的都送到了模型
    await expect(page.locator("#description")).toHaveValue(/照片共 3 张/, {
      timeout: 60_000,
    })

    await page.locator("#title").fill(editedTitle)
    await page.getByRole("button", { name: "下一步" }).click()

    // 第 3 屏：两张带描述的卡片；上一屏的表单已消失
    await expect(page.getByTestId("custody-kept")).toBeVisible({ timeout: T })
    await expect(page.getByTestId("custody-in-place")).toBeVisible({
      timeout: T,
    })
    await expect(page.locator("#title")).toHaveCount(0)

    await page.getByTestId("custody-kept").click()

    // 第 4 屏：手机号来自账号，不给输入框
    await expect(page.getByText(accountPhone)).toBeVisible({ timeout: T })
    await expect(page.locator("#contact")).toHaveCount(0)

    await page.getByRole("button", { name: "发布", exact: true }).click()
    await expect(page.getByTestId("publish-success")).toBeVisible({
      timeout: T,
    })
    await page.waitForURL(/\/$/, { timeout: T })

    // 墙上出现新物品
    await expect(page.getByTestId("item-wall")).toBeVisible({ timeout: T })
    const card = cardByTitle(page, editedTitle)
    await expect(card).toBeVisible({ timeout: T })

    // 数据库侧：代为保管 + 账号手机号 + 3 张图
    const row = await ctx.admin
      .from("found_items")
      .select("id, title, custody, contact, status, description")
      .eq("title", editedTitle)
      .single()
    expect(row.error).toBeNull()
    expect(row.data?.custody).toBe("kept")
    expect(row.data?.contact).toBe(accountPhone)
    expect(row.data?.status).toBe("published")
    expect((row.data?.description ?? "").length).toBeGreaterThan(0)

    const images = await ctx.admin
      .from("found_item_images")
      .select("storage_path", { count: "exact" })
      .eq("found_item_id", row.data!.id)
    expect(images.count).toBe(3)

    // 本人看自己的物品：没有认领入口
    await card.click()
    await page.waitForURL(new RegExp("/items/" + row.data!.id), { timeout: T })
    await expect(
      page.getByRole("heading", { level: 1, name: editedTitle })
    ).toBeVisible({ timeout: T })
    await expect(page.getByTestId("item-owner-notice")).toBeVisible({
      timeout: T,
    })
    await expect(page.getByTestId("pickup-open")).toHaveCount(0)
  })

  test("一张照片：先给补拍建议；删掉照片回到空状态；返回退回上一步", async ({
    page,
  }) => {
    await page.goto("/publish")
    // 第 1 屏的返回沿用路由默认：回失物墙
    await expect(page.getByRole("link", { name: "返回" })).toHaveAttribute(
      "href",
      "/"
    )

    await uploadPhoto(page, "photo-1.png")
    await expect(photoGrid(page)).toHaveCount(1, { timeout: 60_000 })

    // 可以删掉照片；删空后「下一步」不可点
    await page.getByRole("button", { name: "删除这张照片" }).click()
    await expect(photoGrid(page)).toHaveCount(0, { timeout: T })
    await expect(page.getByRole("button", { name: "下一步" })).toBeDisabled()

    await uploadPhoto(page, "photo-1.png")
    await expect(photoGrid(page)).toHaveCount(1, { timeout: 60_000 })
    await page.getByRole("button", { name: "下一步" }).click()

    // 只有一张 → 检查后给建议（可跳过，不阻塞）
    await expect(page.getByTestId("photo-check-loading")).toBeVisible({
      timeout: T,
    })
    await expect(page.getByTestId("photo-advice-dialog")).toBeVisible({
      timeout: T,
    })
    await expect(page.getByText("建议补拍")).toBeVisible({ timeout: T })

    // 「继续拍照」= 留在拍照屏
    await page.getByTestId("photo-advice-retake").click()
    await expect(page.getByTestId("photo-advice-dialog")).toHaveCount(0, {
      timeout: T,
    })
    await expect(page.locator("#title")).toHaveCount(0)
    await expect(photoGrid(page)).toHaveCount(1, { timeout: T })

    // 「仍然继续」才进第 2 屏
    await page.getByRole("button", { name: "下一步" }).click()
    await expect(page.getByTestId("photo-advice-dialog")).toBeVisible({
      timeout: T,
    })
    await page.getByTestId("photo-advice-skip").click()
    await expect(page.locator("#title")).toBeVisible({ timeout: 60_000 })
    await expect(page.locator("#title")).not.toHaveValue("", {
      timeout: 60_000,
    })
    const analyzed = await page.locator("#title").inputValue()

    await page.getByRole("button", { name: "下一步" }).click()
    await expect(page.getByTestId("custody-kept")).toBeVisible({ timeout: T })

    // 标题栏的返回 = 退回上一步（URL 不变，已识别过的内容不重跑）
    await page.getByLabel("返回").click()
    await expect(page.locator("#title")).toBeVisible({ timeout: T })
    await expect(page.locator("#title")).toHaveValue(analyzed)
    expect(new URL(page.url()).pathname).toBe("/publish")
  })

  test("指定存放位置：位置详情必填，定位失败也能靠它发布", async ({ page }) => {
    const editedTitle = "E2E 留原地 " + Math.random().toString(36).slice(2, 6)
    const locationLabel = "图书馆 3 楼自习区靠窗第三排"

    await page.goto("/publish")
    await uploadPhotos(page, 2)
    await page.getByRole("button", { name: "下一步" }).click()

    await expect(page.locator("#title")).toBeVisible({ timeout: 60_000 })
    await expect(page.locator("#title")).not.toHaveValue("", {
      timeout: 60_000,
    })
    await page.locator("#title").fill(editedTitle)
    await page.getByRole("button", { name: "下一步" }).click()

    await expect(page.getByTestId("custody-in-place")).toBeVisible({
      timeout: T,
    })
    await page.getByTestId("custody-in-place").click()

    // 位置详情是必填：留空点「发布」会被拦下，人还留在这一屏
    await expect(page.getByLabel("位置详情")).toBeVisible({ timeout: T })
    await expect(page.locator("#locationLabel")).toBeVisible({ timeout: T })
    await page.getByRole("button", { name: "发布", exact: true }).click()
    await expect(page.getByText("请填写位置详情")).toBeVisible({ timeout: T })
    expect(new URL(page.url()).pathname).toBe("/publish")

    // headless 拿不到定位：填了位置详情就能发布
    await page.locator("#locationLabel").fill(locationLabel)
    await page.getByRole("button", { name: "发布", exact: true }).click()

    await expect(page.getByTestId("publish-success")).toBeVisible({
      timeout: T,
    })
    await page.waitForURL(/\/$/, { timeout: T })

    const row = await ctx.admin
      .from("found_items")
      .select("id, custody, location_label, location_lat, status")
      .eq("title", editedTitle)
      .single()
    expect(row.error).toBeNull()
    expect(row.data?.custody).toBe("in_place")
    expect(row.data?.location_label).toBe(locationLabel)
    expect(row.data?.location_lat).toBeNull()
    expect(row.data?.status).toBe("published")
  })

  test("AI 配额用完：跳过识别、弹 warning 提示，仍可手动填写继续", async ({
    page,
  }) => {
    // 把这个账号的配额先花光（等价于它已经调用过 10 次）
    const userId = await uiUserId(ctx, seed)
    if (!userId) throw new Error("找不到刚注册的账号")
    const seeded = await ctx.admin
      .from("ai_calls")
      .insert(Array.from({ length: 10 }, () => ({ user_id: userId })))
    expect(seeded.error).toBeNull()

    await page.goto("/publish")
    await uploadPhoto(page, "photo-1.png")
    await page.getByRole("button", { name: "下一步" }).click()

    // 拍照建议被跳过：不弹「建议补拍」，只给一条 warning
    await expect(page.getByText(/AI 识别已达上限/).first()).toBeVisible({
      timeout: T,
    })
    await expect(page.getByTestId("photo-advice-dialog")).toHaveCount(0)

    // 表单照常可用：手动填完名称与描述就能继续，AI 不可用不阻塞发布
    await expect(page.locator("#title")).toBeVisible({ timeout: T })
    await page.locator("#title").fill("手动填写的名称")
    await page.locator("#description").fill("手动填写的描述")
    await expect(page.getByRole("button", { name: "下一步" })).toBeEnabled({
      timeout: T,
    })
  })

  test("指定存放位置：定位成功也只说「已获取定位」，界面上不出现经纬度", async ({
    browser,
  }) => {
    const editedTitle = "E2E 定位 " + Math.random().toString(36).slice(2, 6)
    const locationLabel = "图书馆 3 楼自习区"
    const lat = 31.230416
    const lng = 121.473701

    // 复用 beforeEach 已注册的账号，只换一个「有定位权限」的上下文
    const context = await browser.newContext({
      geolocation: { latitude: lat, longitude: lng },
      permissions: ["geolocation"],
    })

    try {
      const page = await context.newPage()
      await signInViaUi(page, phoneFor(seed))

      await page.goto("/publish")
      await uploadPhotos(page, 2)
      await page.getByRole("button", { name: "下一步" }).click()
      await expect(page.locator("#title")).toBeVisible({ timeout: 60_000 })
      await expect(page.locator("#title")).not.toHaveValue("", {
        timeout: 60_000,
      })
      await page.locator("#title").fill(editedTitle)
      await page.getByRole("button", { name: "下一步" }).click()

      await expect(page.getByTestId("custody-in-place")).toBeVisible({
        timeout: T,
      })
      await page.getByTestId("custody-in-place").click()

      // 定位成功：提示只说拿到了定位，屏幕上没有任何坐标数字
      await expect(page.getByText("已获取定位")).toBeVisible({ timeout: T })
      await page.locator("#locationLabel").fill(locationLabel)
      const body = await page.locator("body").innerText()
      expect(body).not.toContain(String(lat))
      expect(body).not.toContain(String(lng))

      await page.getByRole("button", { name: "发布", exact: true }).click()
      await expect(page.getByTestId("publish-success")).toBeVisible({
        timeout: T,
      })
      await page.waitForURL(/\/$/, { timeout: T })

      const row = await ctx.admin
        .from("found_items")
        .select("id, custody, location_label, location_lat, location_lng")
        .eq("title", editedTitle)
        .single()
      expect(row.error).toBeNull()
      expect(row.data?.custody).toBe("in_place")
      expect(row.data?.location_label).toBe(locationLabel)
      // 坐标仍然入库（只用来生成地图链接，不落成用户可见文案）
      expect(row.data?.location_lat).toBeCloseTo(lat, 4)
      expect(row.data?.location_lng).toBeCloseTo(lng, 4)
    } finally {
      await context.close()
    }
  })
})
