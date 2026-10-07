import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  DEFAULT_CONTACT,
  createPickup,
  itemStatus,
  publishItem,
  readSecret,
  revealRaw,
  withdrawItem,
} from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 安全矩阵 5（第 4 轮）：揭晓授权不变 —— 仅「拾主本人」或「已认领的人」可取得。
 * 新增验证：认领即归属后，认领人仍可回看；未认领的第三人依然被拒。
 */
describe("矩阵 5：揭晓联系方式的授权边界", () => {
  let ctx: TestContext
  let owner: TestUser
  let picker: TestUser
  let stranger: TestUser
  let keptId = ""
  let inPlaceId = ""
  let withdrawnId = ""

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("owner")
    picker = await ctx.user("picker")
    stranger = await ctx.user("stranger")

    keptId = (
      await publishItem(owner, {
        title: "揭晓用钱包",
        contact: DEFAULT_CONTACT,
      })
    ).id
    inPlaceId = (
      await publishItem(owner, {
        custody: "in_place",
        title: "揭晓用雨伞",
        locationLabel: "图书馆 3 楼自习区靠窗第三排",
        lat: 31.230416,
        lng: 121.473701,
      })
    ).id
    withdrawnId = (await publishItem(owner, { title: "未认领就撤单的钥匙" })).id
    await withdrawItem(owner, withdrawnId)
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("矩阵 5：anon 调用被拒（函数未授予 anon）", async () => {
    const result = await ctx.anon.rpc("reveal_found_item_contact", {
      p_item_id: keptId,
    })
    expect(result.error).not.toBeNull()
    expect(result.error?.code).toBe("42501")
  })

  it("矩阵 5：未认领的第三人被拒（42501）", async () => {
    const result = await revealRaw(stranger, keptId)
    expect(result.error).not.toBeNull()
    expect(result.error?.code).toBe("42501")
    expect(result.error?.message).toContain("请先提交领取信息")
    expect(result.data).toBeNull()
  })

  it("矩阵 5：拾主本人无需认领记录即可取得联系方式", async () => {
    const result = await revealRaw(owner, keptId)
    expect(result.error).toBeNull()
    expect(result.data?.[0]?.out_custody).toBe("kept")
    expect(result.data?.[0]?.out_contact).toBe(DEFAULT_CONTACT)
  })

  it("矩阵 5：拾主本人可取得位置分支的坐标与位置描述", async () => {
    const result = await revealRaw(owner, inPlaceId)
    expect(result.error).toBeNull()
    expect(result.data?.[0]?.out_location_label).toBe(
      "图书馆 3 楼自习区靠窗第三排"
    )
    expect(result.data?.[0]?.out_location_lat).toBeCloseTo(31.230416, 5)
    expect(result.data?.[0]?.out_location_lng).toBeCloseTo(121.473701, 5)
  })

  it("矩阵 5：认领前被拒，认领后即可揭晓（认领同时把物品置为 claimed）", async () => {
    const before = await revealRaw(picker, keptId)
    expect(before.error?.code).toBe("42501")

    await createPickup(picker, keptId)
    expect(await itemStatus(ctx, keptId)).toBe("claimed")

    const after = await revealRaw(picker, keptId)
    expect(after.error).toBeNull()
    const secret = await readSecret(ctx, keptId)
    expect(after.data?.[0]?.out_contact).toBe(secret.contact)

    // 认领之后，未认领的第三人依然被拒
    const strangerAfter = await revealRaw(stranger, keptId)
    expect(strangerAfter.error?.code).toBe("42501")

    // 拾主也能继续回看
    const ownerAfter = await revealRaw(owner, keptId)
    expect(ownerAfter.error).toBeNull()
    expect(ownerAfter.data?.[0]?.out_contact).toBe(DEFAULT_CONTACT)
  })

  it("矩阵 5：一个物品的认领记录不能解锁另一个物品", async () => {
    const result = await revealRaw(picker, inPlaceId)
    expect(result.error?.code).toBe("42501")
  })

  it("矩阵 5：已撤单（且没人认领）的物品，只有拾主能回看", async () => {
    const ownerView = await revealRaw(owner, withdrawnId)
    expect(ownerView.error).toBeNull()
    expect(ownerView.data?.[0]?.out_contact).toBe(DEFAULT_CONTACT)

    const strangerView = await revealRaw(stranger, withdrawnId)
    expect(strangerView.error?.code).toBe("42501")
  })
})
