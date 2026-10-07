import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { pruneAbandonedDrafts } from "@/lib/db/prune-drafts"
import { createUpload, uploadObject } from "../helpers/fixtures"
import {
  createTestContext,
  IMAGE_BUCKET,
  type TestContext,
} from "../helpers/supabase"

/**
 * 矩阵 16：被放弃的发布草稿回收（第 14 轮）
 *
 * 生产上这件事由 Vercel Cron 每天调 /api/cron/prune-drafts 触发
 * （见 vercel.json 与 app/api/cron/prune-drafts/route.ts）。
 * 这里直接测它的实现：草稿 + 照片对象 + 上传登记行必须一起消失，
 * 而「还在用」的草稿一根毫毛都不能动 —— 回收脚本写错的代价是删用户的数据。
 */
describe("矩阵 16：草稿回收", () => {
  let ctx: TestContext

  beforeAll(() => {
    ctx = createTestContext()
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  }

  /**
   * 造一份「有照片的草稿」，并把它最后一次活动时间定在过去。
   *
   * 【为什么用 INSERT 而不是 attach_draft_photo + UPDATE】publish_drafts 上有
   * BEFORE UPDATE 触发器（publish_drafts_touch）会把 updated_at 强行顶成 now()，
   * 「回拨时间」只能靠 INSERT 时一次写死。
   */
  async function seedDraft(prefix: string, updatedAt: string) {
    const user = await ctx.user(prefix)
    const upload = await createUpload(user.id)
    await uploadObject(ctx, upload.path)

    const draft = await ctx.admin.from("publish_drafts").insert({
      user_id: user.id,
      title: "被放弃的草稿",
      custody: "in_place",
      location_label: "测试点位",
      updated_at: updatedAt,
    })
    expect(draft.error, "种入草稿").toBeNull()

    const link = await ctx.admin.from("publish_draft_images").insert({
      user_id: user.id,
      upload_id: upload.id,
      position: 0,
    })
    expect(link.error, "种入草稿照片").toBeNull()

    return { user, upload }
  }

  async function storageObjects(userId: string): Promise<number> {
    const listed = await ctx.admin.storage.from(IMAGE_BUCKET).list(userId)
    expect(listed.error).toBeNull()
    return listed.data?.length ?? 0
  }

  it("回收超过 30 天没动过的草稿：对象、登记行、草稿一起删；活跃草稿不动", async () => {
    const stale = await seedDraft("stale", daysAgo(40))
    const fresh = await seedDraft("fresh", daysAgo(1))

    expect(await storageObjects(stale.user.id)).toBe(1)
    expect(await storageObjects(fresh.user.id)).toBe(1)

    const result = await pruneAbandonedDrafts(30)
    expect(result.drafts).toBe(1)
    expect(result.objects).toBe(1)
    expect(result.skipped).toBe(0)

    // 过期草稿：三样都不该剩
    expect(await storageObjects(stale.user.id)).toBe(0)
    const uploadRow = await ctx.admin
      .from("image_uploads")
      .select("id")
      .eq("id", stale.upload.id)
    expect(uploadRow.data ?? []).toHaveLength(0)
    const draftRow = await ctx.admin
      .from("publish_drafts")
      .select("user_id")
      .eq("user_id", stale.user.id)
    expect(draftRow.data ?? []).toHaveLength(0)

    // 活跃草稿：原样保留（照片、登记行、草稿都还在）
    expect(await storageObjects(fresh.user.id)).toBe(1)
    const freshUpload = await ctx.admin
      .from("image_uploads")
      .select("id")
      .eq("id", fresh.upload.id)
    expect(freshUpload.data ?? []).toHaveLength(1)
    const freshDraft = await ctx.admin
      .from("publish_drafts")
      .select("user_id")
      .eq("user_id", fresh.user.id)
    expect(freshDraft.data ?? []).toHaveLength(1)
  }, 60_000)

  it("再跑一次是幂等的：没有可回收的草稿就什么都不删", async () => {
    const result = await pruneAbandonedDrafts(30)
    expect(result.drafts).toBe(0)
    expect(result.objects).toBe(0)
  })
})
