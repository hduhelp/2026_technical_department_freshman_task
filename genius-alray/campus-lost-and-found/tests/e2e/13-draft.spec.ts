import { expect, test } from "@playwright/test"
import { IMAGE_BUCKET, type TestContext } from "../helpers/supabase"
import {
  cleanupUiUser,
  newTestContext,
  photoGrid,
  signUpViaUi,
  uiUserId,
  uniqueSeed,
  uploadPhoto,
  uploadPhotos,
} from "./helpers"

const T = 30_000

/**
 * 发布草稿（第 10 轮）：
 * - 一个用户只有一份草稿，发布页每次打开看到的都是同一份（跨访问保留）；
 * - 从草稿移除照片会**连存储对象一起删掉** —— 这正是「不再留桶内孤儿」的落点。
 */
test.describe("发布草稿", () => {
  let ctx: TestContext
  let seed = ""

  test.beforeEach(async ({ page }) => {
    test.setTimeout(300_000)
    ctx = newTestContext()
    seed = uniqueSeed("draft")
    await signUpViaUi(page, seed)
  })

  test.afterEach(async () => {
    await cleanupUiUser(ctx, seed)
  })

  test("草稿跨访问保留，而且永远只有一份", async ({ page }) => {
    const draftTitle = "草稿里的名称 " + Math.random().toString(36).slice(2, 5)

    await page.goto("/publish")
    // 两张：mock 的「建议补拍」只在 1 张时触发，这里不想被那个对话框打断
    await uploadPhotos(page, 2)
    await expect(photoGrid(page)).toHaveCount(2, { timeout: 60_000 })

    // 第 2 屏：等 AI 写完（表单出现即代表识别结束），再改成自己的文案并存入草稿
    await page.getByRole("button", { name: "下一步" }).click()
    await expect(page.locator("#title")).toBeVisible({ timeout: T })
    await page.locator("#title").fill(draftTitle)
    await page.locator("#description").fill("草稿里的描述")
    await page.getByRole("button", { name: "下一步" }).click()
    await expect(page.getByTestId("custody-kept")).toBeVisible({ timeout: T })

    // 离开发布页再回来
    await page.goto("/")
    await page.goto("/publish")

    // 照片还在
    await expect(photoGrid(page)).toHaveCount(2, { timeout: 60_000 })
    // 文案也还在，而且**不会被 AI 覆盖**（草稿里有内容就不再自动识别）
    await page.getByRole("button", { name: "下一步" }).click()
    await expect(page.locator("#title")).toHaveValue(draftTitle, { timeout: T })
    await expect(page.locator("#description")).toHaveValue("草稿里的描述")

    // 再存一次：仍然是同一份（覆盖，而不是新建第二份草稿）
    const nextTitle = draftTitle + " v2"
    await page.locator("#title").fill(nextTitle)
    await page.getByRole("button", { name: "下一步" }).click()
    await expect(page.getByTestId("custody-kept")).toBeVisible({ timeout: T })

    const userId = await uiUserId(ctx, seed)
    if (!userId) throw new Error("找不到刚注册的账号")
    const drafts = await ctx.admin
      .from("publish_drafts")
      .select("user_id, title")
      .eq("user_id", userId)
    expect(drafts.data?.length).toBe(1)
    expect(drafts.data?.[0]?.title).toBe(nextTitle)
  })

  test("从草稿移除照片：登记行与存储对象一起消失（不留孤儿）", async ({
    page,
  }) => {
    await page.goto("/publish")
    await uploadPhoto(page, "photo-1.png")
    await expect(photoGrid(page)).toHaveCount(1, { timeout: 60_000 })

    const userId = await uiUserId(ctx, seed)
    if (!userId) throw new Error("找不到刚注册的账号")

    const rows = await ctx.admin
      .from("image_uploads")
      .select("id, storage_path")
      .eq("uploader_id", userId)
    expect(rows.data?.length).toBe(1)

    const storagePath = rows.data?.[0]?.storage_path
    if (!storagePath) throw new Error("没有拿到刚上传对象的存储路径")

    // 上传后对象确实在私有桶里
    const before = await ctx.admin.storage
      .from(IMAGE_BUCKET)
      .download(storagePath)
    expect(before.error).toBeNull()

    await page.getByRole("button", { name: "删除这张照片" }).click()
    await expect(photoGrid(page)).toHaveCount(0, { timeout: T })

    // 登记行没了
    const after = await ctx.admin
      .from("image_uploads")
      .select("id")
      .eq("uploader_id", userId)
    expect(after.data).toEqual([])

    // 对象也没了 —— 这就是以前会留下来的那个孤儿
    const gone = await ctx.admin.storage
      .from(IMAGE_BUCKET)
      .download(storagePath)
    expect(gone.error).not.toBeNull()
  })
})
