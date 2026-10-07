import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  createPickup,
  itemStatus,
  pickupCount,
  publishItem,
  releaseClaim,
  releaseClaimRaw,
} from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 矩阵 18（第 18 轮回归）：release_found_item_claim 的多人认领语义。
 *
 * 缺陷：旧实现无条件把物品从 claimed 改回 published。第 7 轮起允许多人认领，
 * 于是 A、B 都认领后 A 撤回 → 物品变成「待认领」，B 的认领被无声作废，
 * 第三人也能再认领。修复后：
 *   - 还有活跃认领 → 物品保持 claimed，撤回者只退出认领人名单；
 *   - 活跃认领清零 → 物品回到 published；
 *   - 记录保留（行还在，released_at 非空），撤回后可以重新认领。
 *
 * 限流按 pickups 行数算（1 小时 2 次 / 24 小时 5 次），本文件要反复认领，
 * 所以每个用例之后清掉这三个人的认领行 —— 与 05-create-pickup.test.ts 一样。
 */
describe("矩阵 18：撤回认领（多人认领语义）", () => {
  let ctx: TestContext
  let owner: TestUser
  let a: TestUser
  let b: TestUser
  let c: TestUser

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("rls18owner")
    a = await ctx.user("rls18a")
    b = await ctx.user("rls18b")
    c = await ctx.user("rls18c")
  }, 120_000)

  afterEach(async () => {
    const reset = await ctx.admin
      .from("pickups")
      .delete()
      .in("picker_id", [a.id, b.id, c.id])
    if (reset.error) {
      throw new Error("重置认领配额失败：" + reset.error.message)
    }
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  /** service_role oracle：直接看原始行，断言「记录保留」与 released_at */
  async function pickupRows(itemId: string) {
    const result = await ctx.admin
      .from("pickups")
      .select("picker_id, released_at")
      .eq("found_item_id", itemId)
      .order("created_at")
    if (result.error) {
      throw new Error("读取认领记录失败：" + result.error.message)
    }
    return result.data ?? []
  }

  it("还有人认领时撤回：物品保持 claimed，撤回者退出名单", async () => {
    const item = await publishItem(owner, { title: "多人认领后撤回" })
    await createPickup(a, item.id)
    await createPickup(b, item.id)
    expect(await itemStatus(ctx, item.id)).toBe("claimed")

    await releaseClaim(a, item.id)

    // 关键回归：不能因为一个人撤回就把物品放回待认领
    expect(await itemStatus(ctx, item.id)).toBe("claimed")
    // 记录保留：两行都在，A 那行带 released_at，B 那行仍是活跃
    const rows = await pickupRows(item.id)
    expect(rows.length).toBe(2)
    expect(
      rows.find((row) => row.picker_id === a.id)?.released_at
    ).not.toBeNull()
    expect(rows.find((row) => row.picker_id === b.id)?.released_at).toBeNull()

    // 撤回的人从认领人名单里消失
    const claimers = await b.client.rpc("list_found_item_claimers", {
      p_item_id: item.id,
    })
    expect(claimers.error).toBeNull()
    expect((claimers.data ?? []).map((row) => row.out_picker_id)).toEqual([
      b.id,
    ])

    // 撤回的人也不再被放行联系方式 / 位置
    const revealed = await a.client.rpc("reveal_found_item_contact", {
      p_item_id: item.id,
    })
    expect(revealed.error?.code).toBe("42501")
  })

  it("最后一个活跃认领撤回后，物品回到 published；撤回后可重新认领", async () => {
    const item = await publishItem(owner, { title: "都撤回后回到待认领" })
    await createPickup(a, item.id)
    await createPickup(b, item.id)

    await releaseClaim(a, item.id)
    expect(await itemStatus(ctx, item.id)).toBe("claimed")

    await releaseClaim(b, item.id)
    expect(await itemStatus(ctx, item.id)).toBe("published")
    // 两条记录都还在，只是都标记为已撤回
    expect(await pickupCount(ctx, item.id)).toBe(2)
    const rows = await pickupRows(item.id)
    expect(rows.every((row) => row.released_at !== null)).toBe(true)

    // 重新认领复用同一条记录，不新增行，released_at 被清空
    await createPickup(a, item.id)
    expect(await itemStatus(ctx, item.id)).toBe("claimed")
    expect(await pickupCount(ctx, item.id)).toBe(2)
    const after = await pickupRows(item.id)
    expect(after.find((row) => row.picker_id === a.id)?.released_at).toBeNull()
  })

  it("单人认领撤回后回到 published（既有行为不回退）", async () => {
    const item = await publishItem(owner, { title: "单人撤回" })
    await createPickup(a, item.id)

    await releaseClaim(a, item.id)

    expect(await itemStatus(ctx, item.id)).toBe("published")
    expect(await pickupCount(ctx, item.id)).toBe(1)
    // 物品重新出现在墙上（anon 可读），所以还能再认领
    const wall = await ctx.anon
      .from("found_items")
      .select("id")
      .eq("id", item.id)
    expect(wall.error).toBeNull()
    expect(wall.data?.length).toBe(1)
  })

  it("已撤回的记录不能重复撤回 → 42501", async () => {
    const item = await publishItem(owner, { title: "重复撤回" })
    await createPickup(a, item.id)
    await releaseClaim(a, item.id)

    const again = await releaseClaimRaw(a, item.id)
    expect(again.error?.code).toBe("42501")
    expect(await itemStatus(ctx, item.id)).toBe("published")
  })

  it("没认领过的人撤回 → 42501，物品状态不变", async () => {
    const item = await publishItem(owner, { title: "没认领却撤回" })
    await createPickup(a, item.id)

    const result = await releaseClaimRaw(c, item.id)
    expect(result.error?.code).toBe("42501")
    expect(await itemStatus(ctx, item.id)).toBe("claimed")
  })

  it("不存在的物品 → P0002", async () => {
    const result = await releaseClaimRaw(a, crypto.randomUUID())
    expect(result.error?.code).toBe("P0002")
  })
})
