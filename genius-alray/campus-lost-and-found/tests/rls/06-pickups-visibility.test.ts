import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createPickup, publishItem } from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 矩阵 7（第 4 轮）：pickups 可见性
 * 认领即归属后，一件物品只能有一个认领人，因此「拾主看到全部记录」用两件物品覆盖。
 */
describe("矩阵 7：领取记录的可见性", () => {
  let ctx: TestContext
  let owner: TestUser
  let otherOwner: TestUser
  let pickerB: TestUser
  let pickerC: TestUser
  let stranger: TestUser
  let itemA1 = ""
  let itemA2 = ""
  let itemOther = ""

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("owner")
    otherOwner = await ctx.user("otherown")
    pickerB = await ctx.user("pickerb")
    pickerC = await ctx.user("pickerc")
    stranger = await ctx.user("stranger")

    itemA1 = (await publishItem(owner, { title: "甲的物品一" })).id
    itemA2 = (await publishItem(owner, { title: "甲的物品二" })).id
    itemOther = (await publishItem(otherOwner, { title: "乙的物品" })).id

    await createPickup(pickerB, itemA1)
    await createPickup(pickerC, itemA2)
    await createPickup(pickerB, itemOther)
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("矩阵 7：认领人本人能看到自己的记录（含姓名与手机号）", async () => {
    const result = await pickerB.client
      .from("pickups")
      .select("id, found_item_id, picker_id, picker_name, picker_phone")
      .order("created_at")

    expect(result.error).toBeNull()
    expect(result.data?.length).toBe(2)
    expect(
      (result.data ?? []).every((row) => row.picker_id === pickerB.id)
    ).toBe(true)
    const forItemA1 = (result.data ?? []).find(
      (row) => row.found_item_id === itemA1
    )
    // 第 9 轮：实名来自 profiles，不再等于调用方传进来的值
    expect(forItemA1?.picker_name).toBe(pickerB.realName)
    expect(forItemA1?.picker_phone).toBe(pickerB.phone)
  })

  it("矩阵 7：认领人看不到别人的认领记录", async () => {
    const result = await pickerB.client
      .from("pickups")
      .select("id, picker_id")
      .eq("picker_id", pickerC.id)
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it("矩阵 7：物品 owner 能看到自己物品的全部认领记录", async () => {
    const result = await owner.client
      .from("pickups")
      .select("id, found_item_id, picker_name, picker_phone")
      .in("found_item_id", [itemA1, itemA2])
      .order("created_at")

    expect(result.error).toBeNull()
    expect(result.data?.length).toBe(2)
    const names = (result.data ?? []).map((row) => row.picker_name).sort()
    expect(names).toEqual([pickerB.realName, pickerC.realName].sort())
  })

  it("矩阵 7：owner 的列表只包含自己物品的记录", async () => {
    const result = await owner.client
      .from("pickups")
      .select("id, found_item_id")
    expect(result.error).toBeNull()
    expect(result.data?.length).toBe(2)
    expect(
      (result.data ?? []).every(
        (row) => row.found_item_id === itemA1 || row.found_item_id === itemA2
      )
    ).toBe(true)
  })

  it("矩阵 7：无关第三人看不到任何 pickups 行", async () => {
    const result = await stranger.client
      .from("pickups")
      .select("id, picker_name, picker_phone")
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it("矩阵 7：anon 看不到任何 pickups 行", async () => {
    const result = await ctx.anon.from("pickups").select("id")
    expect(result.data ?? []).toEqual([])
    if (result.error) expect(result.error.code).toBe("42501")
  })
})
