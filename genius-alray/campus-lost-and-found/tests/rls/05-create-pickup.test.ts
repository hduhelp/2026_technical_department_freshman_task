import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  createPickupRaw,
  itemStatus,
  pickupCount,
  publishItem,
  withdrawItem,
} from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 矩阵 6：create_pickup —— 认领即归属 + 服务端实名
 * - 成功即把物品置为 claimed
 * - 别人**也可以**认领同一物品（多人认领）；拾主认领自己的 → 42501
 * - 同一认领人重复提交 = 更新同一条记录（行数不增加）
 * - 第 9 轮：姓名/手机号由 RPC 从 profiles 取，调用方提交不了、也伪造不了
 * - 已撤单 → P0001；不存在 → P0002
 *
 * 频率限制（1 小时 2 次 / 24 小时 5 次）在 14-rate-limits.test.ts 里单独验。
 * 本文件要反复认领同一个 picker，所以每个用例之后清掉这两个人的认领行 ——
 * 限流按 pickups 行数算，删掉即等价于「配额重置」。
 * 【不要改 app_config】那是全局单行，而 vitest 并行跑测试文件，改了会影响别的文件。
 */
describe("矩阵 6：create_pickup（认领即归属）", () => {
  let ctx: TestContext
  let owner: TestUser
  let picker: TestUser
  let second: TestUser

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("owner")
    picker = await ctx.user("picker")
    second = await ctx.user("second")
  }, 120_000)

  afterEach(async () => {
    const reset = await ctx.admin
      .from("pickups")
      .delete()
      .in("picker_id", [picker.id, second.id])
    if (reset.error) {
      throw new Error("重置认领配额失败：" + reset.error.message)
    }
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  /** 每个用例用一件全新的物品，避免「已被认领」污染后续断言 */
  async function freshItem(title = "可认领的物品") {
    return publishItem(owner, { title })
  }

  async function pickupRow(id: string) {
    const row = await ctx.admin
      .from("pickups")
      .select("picker_name, picker_phone")
      .eq("id", id)
      .single()
    if (row.error || !row.data) {
      throw new Error("读取认领记录失败：" + (row.error?.message ?? "unknown"))
    }
    return row.data
  }

  it("矩阵 6：anon 调用被拒", async () => {
    const item = await freshItem()
    const result = await ctx.anon.rpc("create_pickup", { p_item_id: item.id })
    expect(result.error).not.toBeNull()
    expect(result.error?.code).toBe("42501")
  })

  it("矩阵 6：拾主认领自己的物品 → 42501（中文提示原样透出）", async () => {
    const item = await freshItem()
    const result = await createPickupRaw(owner, item.id)
    expect(result.error?.code).toBe("42501")
    expect(result.error?.message).toContain("不能认领自己发布的物品")
    expect(await itemStatus(ctx, item.id)).toBe("published")
    expect(await pickupCount(ctx, item.id)).toBe(0)
  })

  it("矩阵 6：首次认领成功 → 物品被置为 claimed，生成 1 条记录", async () => {
    const item = await freshItem()
    const result = await createPickupRaw(picker, item.id)
    expect(result.error).toBeNull()
    expect(typeof result.data).toBe("string")
    expect(await itemStatus(ctx, item.id)).toBe("claimed")
    expect(await pickupCount(ctx, item.id)).toBe(1)

    const row = await ctx.admin
      .from("found_items")
      .select("claimed_at")
      .eq("id", item.id)
      .single()
    expect(row.data?.claimed_at).not.toBeNull()
  })

  it("第 9 轮：实名来自服务端 —— 调用方传姓名/手机号只会直接失败", async () => {
    const item = await freshItem("伪造实名")

    // RPC 现在只有 p_item_id 一个参数：多塞键 → PostgREST 按「键集合」匹配，
    // 直接找不到函数（PGRST202），根本进不到业务逻辑
    const forged = await picker.client.rpc("create_pickup", {
      p_item_id: item.id,
      p_name: "张警官",
      p_phone: "13800138000",
    } as never)
    expect(forged.error).not.toBeNull()
    expect(forged.error?.code).toBe("PGRST202")
    expect(await pickupCount(ctx, item.id)).toBe(0)

    // 正常路径落库的就是 profiles 里的姓名与手机号
    const ok = await createPickupRaw(picker, item.id)
    expect(ok.error).toBeNull()
    const row = await pickupRow(ok.data as string)
    expect(row.picker_name).toBe(picker.realName)
    expect(row.picker_phone).toBe(picker.phone)
  })

  it("矩阵 6（第 7 轮）：别人也能认领已被认领的物品（多人认领，线下协商）", async () => {
    const item = await freshItem()
    const first = await createPickupRaw(picker, item.id)
    expect(first.error).toBeNull()

    const secondAttempt = await createPickupRaw(second, item.id)
    expect(secondAttempt.error).toBeNull()
    expect(await pickupCount(ctx, item.id)).toBe(2)
    expect(await itemStatus(ctx, item.id)).toBe("claimed")
  })

  it("矩阵 6：同一认领人重复提交 = 更新同一条记录（行数不增加）", async () => {
    const item = await freshItem()
    const first = await createPickupRaw(picker, item.id)
    expect(first.error).toBeNull()

    const again = await createPickupRaw(picker, item.id)
    expect(again.error).toBeNull()
    expect(again.data).toBe(first.data)
    expect(await pickupCount(ctx, item.id)).toBe(1)
    expect(await itemStatus(ctx, item.id)).toBe("claimed")

    // 重复提交也改不动实名：值始终等于账号资料
    const row = await pickupRow(first.data as string)
    expect(row.picker_name).toBe(picker.realName)
    expect(row.picker_phone).toBe(picker.phone)
  })

  it("矩阵 6：已撤单物品 → P0001「该物品已撤单，无法认领」", async () => {
    const item = await freshItem("待撤单的物品")
    await withdrawItem(owner, item.id)

    const result = await createPickupRaw(picker, item.id)
    expect(result.error?.code).toBe("P0001")
    expect(result.error?.message).toContain("该物品已撤单")
    expect(await pickupCount(ctx, item.id)).toBe(0)
  })

  it("矩阵 6：不存在的物品 → P0002", async () => {
    const result = await createPickupRaw(picker, crypto.randomUUID())
    expect(result.error?.code).toBe("P0002")
  })
})
