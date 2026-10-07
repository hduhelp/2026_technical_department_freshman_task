import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createPickup, publishItem, withdrawItem } from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 安全矩阵 1/3（第 4 轮）：认领即归属后的行级可见性
 * - 未撤单（含 claimed）全部登录用户可读
 * - withdrawn 仅拾主可读（他人按 id 查为空）
 * - anon 完全读不到
 */
const PUBLIC_COLUMNS =
  "id, owner_id, title, description, custody, status, created_at, updated_at, claimed_at, withdrawn_at"

describe("矩阵 1/3：published / claimed 可读，withdrawn 仅拾主可见", () => {
  let ctx: TestContext
  let owner: TestUser
  let viewer: TestUser
  let publishedId = ""
  let claimedId = ""
  let withdrawnId = ""

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("owner")
    viewer = await ctx.user("viewer")

    publishedId = (
      await publishItem(owner, {
        title: "公开的黑色钱包",
        description: "皮质钱包，内有若干卡片。",
        photoCount: 2,
      })
    ).id

    claimedId = (await publishItem(owner, { title: "已被认领的水杯" })).id
    await createPickup(viewer, claimedId)

    withdrawnId = (await publishItem(owner, { title: "已撤单的钥匙" })).id
    await withdrawItem(owner, withdrawnId)
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("矩阵 1：published 物品的公开列可读且拿到数据", async () => {
    const result = await viewer.client
      .from("found_items")
      .select(PUBLIC_COLUMNS)
      .eq("id", publishedId)
      .single()

    expect(result.error).toBeNull()
    expect(result.data?.title).toBe("公开的黑色钱包")
    expect(result.data?.status).toBe("published")
    expect(result.data?.custody).toBe("kept")
    expect(result.data?.claimed_at).toBeNull()
    expect(result.data?.withdrawn_at).toBeNull()
  })

  it("矩阵 1：已认领（claimed）的物品仍然可读，并带 claimed_at", async () => {
    const result = await viewer.client
      .from("found_items")
      .select(PUBLIC_COLUMNS)
      .eq("id", claimedId)
      .single()

    expect(result.error).toBeNull()
    expect(result.data?.status).toBe("claimed")
    expect(result.data?.claimed_at).not.toBeNull()
  })

  it("矩阵 1：他人按 id 查不到已撤单物品", async () => {
    const result = await viewer.client
      .from("found_items")
      .select("id, title, status")
      .eq("id", withdrawnId)
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it("矩阵 1：拾主自己能看到已撤单物品（含 withdrawn_at）", async () => {
    const result = await owner.client
      .from("found_items")
      .select(PUBLIC_COLUMNS)
      .eq("id", withdrawnId)
      .single()

    expect(result.error).toBeNull()
    expect(result.data?.status).toBe("withdrawn")
    expect(result.data?.withdrawn_at).not.toBeNull()
  })

  it("矩阵 1：集合查询包含 published + claimed，但不含 withdrawn", async () => {
    const result = await viewer.client
      .from("found_items")
      .select("id, status")
      .order("created_at", { ascending: false })
      .limit(100)

    expect(result.error).toBeNull()
    const ids = (result.data ?? []).map((row) => row.id)
    expect(ids).toContain(publishedId)
    expect(ids).toContain(claimedId)
    expect(ids).not.toContain(withdrawnId)
    expect((result.data ?? []).every((row) => row.status !== "withdrawn")).toBe(
      true
    )
  })

  it("矩阵 1：published 与 claimed 物品的图片记录都可读", async () => {
    const images = await viewer.client
      .from("found_item_images")
      .select("id, found_item_id, storage_path, position")
      .eq("found_item_id", publishedId)
      .order("position")
    expect(images.error).toBeNull()
    expect(images.data?.length).toBe(2)

    const claimedImages = await viewer.client
      .from("found_item_images")
      .select("id")
      .eq("found_item_id", claimedId)
    expect(claimedImages.error).toBeNull()
  })

  it("矩阵 3：未登录（anon）能读失物墙，但读不到 contact / location", async () => {
    // 第 7 轮起首屏信息流对未登录开放
    const items = await ctx.anon
      .from("found_items")
      .select("id, title, status")
      .eq("id", publishedId)
    expect(items.error).toBeNull()
    expect(items.data?.length).toBe(1)

    const images = await ctx.anon
      .from("found_item_images")
      .select("id")
      .eq("found_item_id", publishedId)
    expect(images.error).toBeNull()

    // 撤单的物品对 anon 不可见
    const withdrawn = await ctx.anon
      .from("found_items")
      .select("id")
      .eq("id", withdrawnId)
    expect(withdrawn.data ?? []).toEqual([])

    // 机密列依旧碰不得
    const secret = await ctx.anon.from("found_items").select("contact")
    expect(secret.error?.code).toBe("42501")
  })
})
