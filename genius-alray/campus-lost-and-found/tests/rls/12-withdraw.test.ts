import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createPickup,
  itemStatus,
  publishItem,
  withdrawItem,
  withdrawItemRaw,
} from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"
import {
  listMyItems,
  listWallItems,
  withdrawItem as dbWithdrawItem,
} from "@/lib/db/found-items"

/**
 * 矩阵 12（第 4 轮）：withdraw_found_item —— 认领即归属之后，拾主只能撤回没人认领的物品
 */
describe("矩阵 12：撤单状态机", () => {
  let ctx: TestContext
  let owner: TestUser
  let picker: TestUser
  let other: TestUser

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("owner")
    picker = await ctx.user("picker")
    other = await ctx.user("other")
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("published 可撤 → withdrawn；墙上看不到、他人读不到、拾主可读；二次撤单 P0001", async () => {
    const item = await publishItem(owner, { title: "待撤单物品" })

    await withdrawItem(owner, item.id)
    expect(await itemStatus(ctx, item.id)).toBe("withdrawn")

    const row = await ctx.admin
      .from("found_items")
      .select("withdrawn_at")
      .eq("id", item.id)
      .single()
    expect(row.data?.withdrawn_at).not.toBeNull()

    // 墙上消失
    const wall = await listWallItems(owner.client, { limit: 100, offset: 0 })
    expect(wall.some((entry) => entry.id === item.id)).toBe(false)

    // 他人按 id 查为空（RLS）
    const hidden = await other.client
      .from("found_items")
      .select("id, status")
      .eq("id", item.id)
    expect(hidden.data).toEqual([])

    // 拾主仍可读
    const mine = await owner.client
      .from("found_items")
      .select("id, status")
      .eq("id", item.id)
      .single()
    expect(mine.data?.status).toBe("withdrawn")

    // 二次撤单
    const again = await withdrawItemRaw(owner, item.id)
    expect(again.error?.code).toBe("P0001")
    expect(again.error?.message).toContain("已撤单")
  })

  it("claimed 不可撤 → P0001「该物品已被认领，无法撤单」", async () => {
    const item = await publishItem(owner, { title: "已被认领的物品" })
    await createPickup(picker, item.id)
    expect(await itemStatus(ctx, item.id)).toBe("claimed")

    const result = await withdrawItemRaw(owner, item.id)
    expect(result.error?.code).toBe("P0001")
    expect(result.error?.message).toContain("该物品已被认领，无法撤单")
    expect(await itemStatus(ctx, item.id)).toBe("claimed")
  })

  it("非 owner 撤单 → 42501「无权操作该物品」", async () => {
    const item = await publishItem(owner, { title: "别人的物品" })
    const result = await withdrawItemRaw(other, item.id)
    expect(result.error?.code).toBe("42501")
    expect(result.error?.message).toContain("无权操作该物品")
    expect(await itemStatus(ctx, item.id)).toBe("published")
  })

  it("不存在的物品 → P0002", async () => {
    const result = await withdrawItemRaw(owner, crypto.randomUUID())
    expect(result.error?.code).toBe("P0002")
  })

  it("lib/db 封装：withdrawItem 生效，listMyItems 排除 withdrawn，listWallItems 含 claimed", async () => {
    const minePublished = await publishItem(owner, { title: "我的待撤单" })
    const mineClaimed = await publishItem(owner, { title: "我的已被认领" })
    await createPickup(other, mineClaimed.id)
    await dbWithdrawItem(owner.client, minePublished.id)

    const myItems = await listMyItems(owner.client, owner.id)
    const myIds = myItems.map((entry) => entry.id)
    expect(myIds).not.toContain(minePublished.id)
    expect(myIds).toContain(mineClaimed.id)

    const wall = await listWallItems(owner.client, { limit: 100, offset: 0 })
    const wallIds = wall.map((entry) => entry.id)
    expect(wallIds).toContain(mineClaimed.id)
    expect(wallIds).not.toContain(minePublished.id)
  })
})
