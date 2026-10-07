import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createPickup, publishItem, withdrawItem } from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"
import { listMyItems, listWallItems } from "@/lib/db/found-items"
import { listItemPickups, listMyPickups } from "@/lib/db/pickups"

/**
 * 「我的」查询必须显式按调用者收窄。
 * RLS 改成公开可读之后，found_items 对登录用户返回全部 published，
 * pickups 也会被 owner 视角放大；这两个函数因此新增了 id 参数。
 * 这里钉住「不传 id 会看到别人的数据」这一风险不再回归。
 */
describe("我的查询：listMyItems / listMyPickups", () => {
  let ctx: TestContext
  let a: TestUser
  let b: TestUser
  let aItem = ""
  let bItem = ""

  beforeAll(async () => {
    ctx = createTestContext()
    a = await ctx.user("alpha")
    b = await ctx.user("beta")
    aItem = (await publishItem(a, { title: "A 的物品" })).id
    bItem = (await publishItem(b, { title: "B 的物品" })).id
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("listMyItems(ownerId) 只返回自己的物品", async () => {
    const mineOfA = await listMyItems(a.client, a.id)
    expect(mineOfA.some((item) => item.id === aItem)).toBe(true)
    expect(mineOfA.some((item) => item.id === bItem)).toBe(false)
    expect(mineOfA.every((item) => item.owner_id === a.id)).toBe(true)

    const mineOfB = await listMyItems(b.client, b.id)
    expect(mineOfB.some((item) => item.id === bItem)).toBe(true)
    expect(mineOfB.some((item) => item.id === aItem)).toBe(false)
  })

  it("listMyPickups(pickerId) 只返回自己提交的领取；owner 用 listItemPickups 看全部", async () => {
    await createPickup(b, aItem)

    const mineOfB = await listMyPickups(b.client, b.id)
    expect(mineOfB.some((row) => row.found_item_id === aItem)).toBe(true)
    expect(mineOfB.every((row) => row.picker_id === b.id)).toBe(true)

    const mineOfA = await listMyPickups(a.client, a.id)
    expect(mineOfA).toEqual([])

    const forOwner = await listItemPickups(a.client, aItem)
    expect(forOwner.length).toBe(1)
    expect(forOwner[0]?.picker_name).toBe(b.realName)
  })

  it("listMyItems 排除 withdrawn；claimed 仍保留且仍在墙上（认领即归属）", async () => {
    const claimed = await publishItem(a, { title: "A 的已被认领物品" })
    await createPickup(b, claimed.id)

    const withdrawn = await publishItem(a, { title: "A 的撤单物品" })
    await withdrawItem(a, withdrawn.id)

    const mine = await listMyItems(a.client, a.id)
    const mineIds = mine.map((item) => item.id)
    expect(mineIds).toContain(claimed.id)
    expect(mineIds).not.toContain(withdrawn.id)
    expect(mine.every((item) => item.owner_id === a.id)).toBe(true)

    const wall = await listWallItems(a.client, { limit: 100, offset: 0 })
    const wallIds = wall.map((item) => item.id)
    expect(wallIds).toContain(claimed.id)
    expect(wallIds).not.toContain(withdrawn.id)
  })
})
