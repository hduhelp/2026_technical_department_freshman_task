import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createUpload } from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 矩阵 17：服务端身份（service_role）的表权限（第 15 轮）
 *
 * 【为什么专门为「权限」写一条矩阵】线上出过一次：上传图片报
 * `permission denied for table image_uploads`（42501）。根因是当时的迁移
 * 只显式 grant 了部分表，其余指望 Supabase 平台的「新建表自动授权」——
 * 那个机制只对 postgres 角色创建的对象生效，而推迁移用的是 CLI 的临时
 * 登录角色，云端新项目又默认要求显式 GRANT。本地因为隐式授权兜着，
 * 永远复现不出来。
 *
 * 这条用例把「服务端身份到底能不能干活」钉死：以后再加表、再收权限，
 * 只要忘了给 service_role 授权，这里就会红。
 * （本地 config.toml 现在也设成 auto_expose_new_tables = false，与云端同一套规则。）
 */
describe("矩阵 17：service_role 表权限", () => {
  let ctx: TestContext
  let user: TestUser

  beforeAll(async () => {
    ctx = createTestContext()
    user = await ctx.user("priv")
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("能读 found_items 的机密列（签名 URL 与测试 oracle 都靠它）", async () => {
    const result = await ctx.admin
      .from("found_items")
      .select("id, contact, location_lat")
      .limit(1)
    expect(result.error).toBeNull()
  })

  it("能读 app_config（限流阈值唯一真源）", async () => {
    const result = await ctx.admin
      .from("app_config")
      .select("max_photos, publish_per_day")
      .single()
    expect(result.error).toBeNull()
    expect(result.data).toBeTruthy()
  })

  it("能写 image_uploads（落库登记 + 失败回滚都要它）", async () => {
    const upload = await createUpload(user.id)

    const readBack = await ctx.admin
      .from("image_uploads")
      .select("id")
      .eq("id", upload.id)
    expect(readBack.error).toBeNull()
    expect(readBack.data ?? []).toHaveLength(1)

    const removed = await ctx.admin
      .from("image_uploads")
      .delete()
      .eq("id", upload.id)
    expect(removed.error).toBeNull()
  })

  it("能清理草稿与草稿照片（Vercel Cron 的回收任务走的就是这条路）", async () => {
    const upload = await createUpload(user.id)

    const draft = await ctx.admin
      .from("publish_drafts")
      .insert({ user_id: user.id, title: "回收用草稿" })
    expect(draft.error).toBeNull()

    const link = await ctx.admin
      .from("publish_draft_images")
      .insert({ user_id: user.id, upload_id: upload.id, position: 0 })
    expect(link.error).toBeNull()

    const links = await ctx.admin
      .from("publish_draft_images")
      .select("upload_id")
      .eq("user_id", user.id)
    expect(links.error).toBeNull()

    expect(
      (await ctx.admin.from("image_uploads").delete().eq("id", upload.id)).error
    ).toBeNull()
    expect(
      (await ctx.admin.from("publish_drafts").delete().eq("user_id", user.id))
        .error
    ).toBeNull()
  })

  it("客户端身份（登录用户与匿名）仍然读不到 app_config", async () => {
    expect(
      (await user.client.from("app_config").select("*")).error
    ).not.toBeNull()
    expect((await ctx.anon.from("app_config").select("*")).error).not.toBeNull()
  })
})
