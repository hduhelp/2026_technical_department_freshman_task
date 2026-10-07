import { expect, type Page } from "@playwright/test"
import { createUploadsForPaths, publishItem } from "../helpers/fixtures"
import {
  AUTH_EMAIL_DOMAIN,
  IMAGE_BUCKET,
  PNG_BYTES,
  TEST_PASSWORD,
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * E2E 共享工具。
 * 约定：
 * - 「注册/登录/发布/认领」等用户可见行为走真实 UI；
 * - 造数据（用户、已发布物品、私有桶对象）走 service_role + lib/db 的真实 RPC 路径，
 *   这样用例只验证被测行为，不被无关步骤拖慢。
 * - 第 7 轮起**账号就是手机号**：注册填「真实姓名 + 手机号 + 密码 + 勾选同意」，
 *   登录只填手机号。内部邮箱由手机号派生，测试里用 phoneFor(seed) 造号。
 */

// 规格文件从本模块取类型，这里统一再导出一次
export type { TestContext, TestUser }

export const E2E_PASSWORD = TEST_PASSWORD
export const DEFAULT_REAL_NAME = "测试用户"

/** 测试账号的「种子」：只用来派生手机号/邮箱，不是用户名 */
export function uniqueSeed(prefix: string): string {
  const safe = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 5)
  return ("e2e_" + safe + "_" + Math.random().toString(36).slice(2, 8)).slice(
    0,
    20
  )
}

/** 由种子派生一个稳定、合法、够唯一的 11 位手机号 */
export function phoneFor(seed: string): string {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const tail = (h >>> 0) % 1_000_000_000
  return "13" + tail.toString().padStart(9, "0")
}

/** 注册：真实姓名 + 手机号 + 密码 + 勾选同意条款 */
export async function signUpViaUi(
  page: Page,
  seed: string,
  options: { realName?: string; password?: string } = {}
): Promise<void> {
  const realName = options.realName ?? DEFAULT_REAL_NAME
  const password = options.password ?? E2E_PASSWORD

  await page.goto("/signup")
  await page.fill("#realName", realName)
  await page.fill("#phone", phoneFor(seed))
  await page.fill("#password", password)
  await page.fill("#confirmPassword", password)
  await page.check('input[name="agree"]')
  await page.getByRole("button", { name: "注册并登录" }).click()
  await expect(page).not.toHaveURL(/\/signup/, { timeout: 30_000 })
}

/** 登录：手机号 + 密码 */
export async function signInViaUi(
  page: Page,
  phone: string,
  password = E2E_PASSWORD
): Promise<void> {
  await page.goto("/login")
  await page.fill("#phone", phone)
  await page.fill("#password", password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 })
}

/** 通过可见按钮唤起文件选择器（贴近真实交互；隐藏 input 也能被 Playwright 捕获） */
export async function uploadPhoto(
  page: Page,
  name = "photo.png"
): Promise<void> {
  const trigger = page.getByTestId("photo-add")
  await expect(trigger).toBeVisible({ timeout: 30_000 })
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 30_000 }),
    trigger.click(),
  ])
  await chooser.setFiles({ name, mimeType: "image/png", buffer: PNG_BYTES })
}

/** 已上传照片的缩略图（拍照屏的网格） */
export function photoGrid(page: Page) {
  return page.getByAltText("已上传照片")
}

/**
 * 一次选 n 张，再确认网格里真的出现了 n 张。
 *
 * input 本身就是 multiple，应用侧也是按批处理（handleFiles 内部逐张压缩上传、
 * 逐张入 state），所以批量选与逐张点是等价路径；但逐张点会多花 n-1 次
 * 「打开选择器 → 等网格更新」的往返。
 */
export async function uploadPhotos(page: Page, count: number): Promise<void> {
  if (count <= 0) return

  const trigger = page.getByTestId("photo-add")
  await expect(trigger).toBeVisible({ timeout: 30_000 })
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 30_000 }),
    trigger.click(),
  ])
  await chooser.setFiles(
    Array.from({ length: count }, (_, index) => ({
      name: "photo-" + (index + 1) + ".png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    }))
  )
  await expect(photoGrid(page)).toHaveCount(count, { timeout: 60_000 })
}

export type E2EItem = {
  id: string
  title: string
  description: string
  contact: string
  locationLabel: string
}

/** 建一个测试账号（API 侧），返回带 phone / realName 的用户 */
export async function createE2EUser(
  ctx: TestContext,
  prefix: string
): Promise<TestUser> {
  return ctx.user(prefix)
}

/** 用真实 RPC 路径发布一条物品，并上传真实图片对象（保证卡片/详情页有图可看） */
export async function createPublishedItem(
  ctx: TestContext,
  owner: TestUser,
  options: {
    title?: string
    description?: string
    custody?: "kept" | "in_place"
    contact?: string
    locationLabel?: string
    lat?: number | null
    lng?: number | null
    photos?: number
  } = {}
): Promise<E2EItem> {
  const photos = options.photos ?? 1
  const paths: string[] = []
  for (let index = 0; index < photos; index += 1) {
    const path = owner.id + "/" + crypto.randomUUID() + ".png"
    const upload = await ctx.admin.storage
      .from(IMAGE_BUCKET)
      .upload(path, PNG_BYTES, { contentType: "image/png", upsert: true })
    if (upload.error) {
      throw new Error("上传测试图片失败：" + upload.error.message)
    }
    ctx.trackStoragePath(path)
    paths.push(path)
  }

  const title =
    options.title ?? "E2E 物品 " + Math.random().toString(36).slice(2, 6)
  const description = options.description ?? "端到端验证用的物品描述。"
  const custody = options.custody ?? "kept"
  const contact = options.contact ?? "13800138000"
  const locationLabel = options.locationLabel ?? ""

  // 与 /api/upload 一致：先登记 uploads 行，再用 id 发布（第 9 轮起不传路径）
  const seeds = await createUploadsForPaths(owner.id, paths)
  const item = await publishItem(owner, {
    title,
    description,
    custody,
    contact,
    locationLabel,
    lat: options.lat ?? null,
    lng: options.lng ?? null,
    uploadIds: seeds.map((seed) => seed.id),
  })

  return { id: item.id, title, description, contact, locationLabel }
}

/** 失物墙上的某张卡（按标题定位） */
export function cardByTitle(page: Page, title: string) {
  return page.locator('[data-testid="item-card"]').filter({ hasText: title })
}

export function newTestContext(): TestContext {
  return createTestContext()
}

/**
 * 认领：第 7 轮起**在详情页**完成 —— 点「我要认领」→ 弹「诚信认领」→「我确认认领」
 * → 立刻跳到「认领信息」独立一屏。姓名/手机号直接用账号里的，不再有输入框。
 */
export async function submitClaimWithConfirm(page: Page): Promise<void> {
  await page.getByTestId("pickup-open").click()
  await expect(page.getByTestId("claim-confirm")).toBeVisible({
    timeout: 30_000,
  })
  await page.getByTestId("claim-confirm-ok").click()
  await expect(page.getByTestId("claim-guide")).toBeVisible({ timeout: 30_000 })
}

/**
 * 清理「通过 UI 注册」的账号：ctx.cleanup() 只知道 API 侧创建的用户，
 * 这里按手机号派生的邮箱反查 id，删除其私有桶对象后再删用户（级联物品/图片/认领）。
 */
/**
 * 按派生邮箱反查「通过 UI 注册」的账号 id。
 * 手机号被改过时传新的那个：登录邮箱跟着手机号走，已不等于 seed 派生的邮箱。
 */
export async function uiUserId(
  ctx: TestContext,
  seed: string,
  phone?: string
): Promise<string | null> {
  const email = (phone ?? phoneFor(seed)) + "@" + AUTH_EMAIL_DOMAIN
  const listed = await ctx.admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  return listed.data?.users.find((user) => user.email === email)?.id ?? null
}

export async function cleanupUiUser(
  ctx: TestContext,
  seed: string,
  phone?: string
): Promise<void> {
  const userId = await uiUserId(ctx, seed, phone)
  if (!userId) return

  try {
    const topLevel = await ctx.admin.storage
      .from(IMAGE_BUCKET)
      .list(userId, { limit: 200 })
    for (const entry of topLevel.data ?? []) {
      const asFile = userId + "/" + entry.name
      if (entry.id) {
        await ctx.admin.storage.from(IMAGE_BUCKET).remove([asFile])
        continue
      }
      const files = await ctx.admin.storage
        .from(IMAGE_BUCKET)
        .list(asFile, { limit: 200 })
      const paths = (files.data ?? []).map((file) => asFile + "/" + file.name)
      if (paths.length > 0) {
        await ctx.admin.storage.from(IMAGE_BUCKET).remove(paths)
      }
    }
  } catch {
    // 存储清理失败不阻塞用例结论；用户删除仍会级联清掉数据库行
  }

  await ctx.admin.auth.admin.deleteUser(userId)
}
