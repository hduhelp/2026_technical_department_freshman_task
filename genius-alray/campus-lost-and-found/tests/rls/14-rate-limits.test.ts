import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  createPickupRaw,
  publishItem,
  publishItemRaw,
  readAppConfig,
  seedPublishedItems,
} from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 矩阵 14：频率限制（第 9 轮建，第 14 轮补发布）
 * - 认领：1 小时 2 次、24 小时 5 次
 * - AI：每小时 10 次
 * - 发布：24 小时 10 条、7 天 30 条
 *
 * 阈值都在 app_config（唯一真源），而且**由 RPC 强制**：这里直接打 PostgREST，
 * 不走应用层 —— 限流只写在 Server Action 里的话，直连数据库就能绕过。
 *
 * 【为什么不改 app_config】vitest 并行跑测试文件，改全局单行配置会踩到别的文件
 * （实测：另一个文件把阈值放大后，这里就测不出限流了）。所以日阈值改用
 * 「直接种入 2 小时前 / 3 天前的历史行」来构造，等价且互不干扰。
 *
 * 【为什么每个用例单独发 owner】第 14 轮起发布也有配额，一个 owner 连着
 * 发布十几个物品的话，后面的用例会先撞上发布上限 —— 测出来的就不是它想测的东西。
 */
describe("矩阵 14：频率限制", () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = createTestContext()
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  /** 2 小时前：落在 24 小时窗口内、1 小时窗口外 → 只可能命中日阈值 */
  function twoHoursAgo(): string {
    return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  }

  /** 3 天前：落在 7 天窗口内、24 小时窗口外 → 只可能命中周阈值 */
  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  }

  /** 直接调用发布 RPC（走真实参数形态），返回原始结果便于断言限流文案 */
  function publishRaw(owner: TestUser, title: string) {
    return publishItemRaw(owner, {
      title,
      description: "这是一段测试用的物品描述，长度满足 1-600 字要求。",
      custody: "kept",
      contact: "13800138000",
    })
  }

  async function seedPickup(owner: TestUser, picker: TestUser, index: number) {
    const item = await publishItem(owner, { title: "日限流底料 " + index })
    const row = await ctx.admin.from("pickups").insert({
      found_item_id: item.id,
      picker_id: picker.id,
      picker_name: picker.realName,
      picker_phone: picker.phone,
      created_at: twoHoursAgo(),
    })
    if (row.error) {
      throw new Error("种入历史认领失败：" + row.error.message)
    }
  }

  it("默认阈值就是需求里的数字（认领 2/5、AI 10、发布 10/30）", async () => {
    const config = await readAppConfig()
    expect(config.claim_per_hour).toBe(2)
    expect(config.claim_per_day).toBe(5)
    expect(config.ai_per_hour).toBe(10)
    expect(config.publish_per_day).toBe(10)
    expect(config.publish_per_week).toBe(30)
  })

  it("认领：1 小时内第 3 次被拒", async () => {
    const owner = await ctx.user("owner")
    const picker = await ctx.user("hourly")
    const items = [
      await publishItem(owner, { title: "限流物品一" }),
      await publishItem(owner, { title: "限流物品二" }),
      await publishItem(owner, { title: "限流物品三" }),
    ]

    expect((await createPickupRaw(picker, items[0].id)).error).toBeNull()
    expect((await createPickupRaw(picker, items[1].id)).error).toBeNull()

    const third = await createPickupRaw(picker, items[2].id)
    expect(third.error?.code).toBe("P0001")
    expect(third.error?.message).toContain("1 小时内最多认领 2 件")
  })

  it("认领：同一件物品重复提交不计入次数（改资料不该被挡）", async () => {
    const owner = await ctx.user("owner")
    const picker = await ctx.user("resubmit")
    const item = await publishItem(owner, { title: "重复提交的物品" })

    // 提交 4 次，但只有 1 次是「新增认领」
    for (let index = 0; index < 4; index += 1) {
      expect(
        (await createPickupRaw(picker, item.id)).error,
        "第 " + (index + 1) + " 次"
      ).toBeNull()
    }
  })

  it("认领：24 小时内第 6 次被拒", async () => {
    const owner = await ctx.user("owner")
    const picker = await ctx.user("daily")
    for (let index = 0; index < 5; index += 1) {
      await seedPickup(owner, picker, index)
    }

    const sixth = await createPickupRaw(
      picker,
      (await publishItem(owner, { title: "第 6 件" })).id
    )
    expect(sixth.error?.code).toBe("P0001")
    expect(sixth.error?.message).toContain("24 小时内最多认领 5 件")
  })

  it("认领：24 小时内第 5 次仍然放行（阈值边界）", async () => {
    const owner = await ctx.user("owner")
    const picker = await ctx.user("edge")
    for (let index = 0; index < 4; index += 1) {
      await seedPickup(owner, picker, index)
    }

    const fifth = await createPickupRaw(
      picker,
      (await publishItem(owner, { title: "第 5 件" })).id
    )
    expect(fifth.error).toBeNull()
  })

  it("发布：第 10 条放行、第 11 条被拒", async () => {
    const owner = await ctx.user("pubday")
    // 等价于「今天已经发过 9 条」
    await seedPublishedItems(owner.id, 9, twoHoursAgo())

    const tenth = await publishRaw(owner, "今天第 10 条")
    expect(tenth.error).toBeNull()

    const eleventh = await publishRaw(owner, "今天第 11 条")
    expect(eleventh.error?.code).toBe("P0001")
    expect(eleventh.error?.message).toContain("24 小时内最多发布 10 条")
  })

  it("发布：7 天内第 31 条被拒（当天额度没用完也一样）", async () => {
    const owner = await ctx.user("pubweek")
    // 3 天前：落在 7 天窗口内、24 小时窗口外
    await seedPublishedItems(owner.id, 30, daysAgo(3))

    const thirtyFirst = await publishRaw(owner, "本周第 31 条")
    expect(thirtyFirst.error?.code).toBe("P0001")
    expect(thirtyFirst.error?.message).toContain("7 天内最多发布 30 条")
  })

  it("发布：撤单不释放额度（否则「发完就撤」就是免费通道）", async () => {
    const owner = await ctx.user("pubwd")
    await seedPublishedItems(owner.id, 10, twoHoursAgo())

    const withdrawn = await ctx.admin
      .from("found_items")
      .update({ status: "withdrawn" })
      .eq("owner_id", owner.id)
    expect(withdrawn.error).toBeNull()

    const blocked = await publishRaw(owner, "撤单之后仍然受限")
    expect(blocked.error?.code).toBe("P0001")
    expect(blocked.error?.message).toContain("24 小时内最多发布 10 条")
  })

  it("发布：限流按账号隔离", async () => {
    const blocked = await ctx.user("puba")
    await seedPublishedItems(blocked.id, 10, twoHoursAgo())
    expect((await publishRaw(blocked, "已满")).error?.code).toBe("P0001")

    const other = await ctx.user("pubb")
    expect((await publishRaw(other, "别人不受影响")).error).toBeNull()
  })

  it("AI 配额：每人每小时 10 次，超限返回 allowed=false 且按用户隔离", async () => {
    const first = await ctx.user("ai")
    const second = await ctx.user("ai2")

    const allowed: boolean[] = []
    for (let index = 0; index < 12; index += 1) {
      const result = await first.client.rpc("consume_ai_quota", {})
      expect(result.error).toBeNull()
      allowed.push(result.data?.[0]?.out_allowed === true)
    }
    expect(allowed.slice(0, 10).every(Boolean)).toBe(true)
    expect(allowed.slice(10)).toEqual([false, false])

    // 另一个人不受影响
    const other = await second.client.rpc("consume_ai_quota", {})
    expect(other.error).toBeNull()
    expect(other.data?.[0]?.out_allowed).toBe(true)
    expect(other.data?.[0]?.out_used).toBe(1)
    expect(other.data?.[0]?.out_limit).toBe(10)
  })

  it("AI 配额：anon 不可调用", async () => {
    const result = await ctx.anon.rpc("consume_ai_quota", {})
    expect(result.error).not.toBeNull()
    expect(["42501", "PGRST202"]).toContain(result.error?.code)
  })
})
