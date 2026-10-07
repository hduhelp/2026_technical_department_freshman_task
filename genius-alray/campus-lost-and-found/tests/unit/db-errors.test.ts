import type { PostgrestError } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createPickup, createUploads, publishItem } from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"
import {
  getItem,
  listWallItems,
  publishItem as dbPublishItem,
  revealContact,
  withdrawItem as dbWithdrawItem,
} from "@/lib/db/found-items"
import {
  createPickup as dbCreatePickup,
  listItemPickups,
} from "@/lib/db/pickups"
import { getMyProfile, updateMyProfile } from "@/lib/db/profiles"
import { DbError, toDbError, unwrap, unwrapMaybe } from "@/lib/db/types"

function pgError(code: string, message = "raw postgres error"): PostgrestError {
  // PostgrestError 是 class，测试只需要结构化字段
  return {
    code,
    message,
    details: "",
    hint: "",
    name: "PostgrestError",
  } as unknown as PostgrestError
}

describe("lib/db/types：错误映射（第 4 轮：中文业务提示原样透出）", () => {
  it("英文兜底：42501 / P0001 / P0002 / 22023 各自映射", () => {
    expect(toDbError(pgError("42501")).message).toBe("没有权限执行该操作")
    expect(toDbError(pgError("P0001")).message).toBe("当前状态不允许该操作")
    expect(toDbError(pgError("P0002")).message).toBe("记录不存在")
    expect(toDbError(pgError("22023")).message).toBe("参数不合法")
  })

  it("raise exception 的中文提示原样透出（不再被兜底吞掉）", () => {
    const claimed = toDbError(pgError("P0001", "该物品已被认领"))
    expect(claimed.message).toBe("该物品已被认领")
    expect(claimed.code).toBe("P0001")

    const mine = toDbError(pgError("42501", "不能认领自己发布的物品"))
    expect(mine.message).toBe("不能认领自己发布的物品")

    const withdraw = toDbError(pgError("P0001", "该物品已被认领，无法撤单"))
    expect(withdraw.message).toBe("该物品已被认领，无法撤单")
  })

  it("未知错误码 + 英文 message → 透传原文；null → 未知错误", () => {
    const unknown = toDbError(pgError("XX000", "some other failure"))
    expect(unknown.message).toBe("some other failure")
    expect(unknown.code).toBe("XX000")

    const none = toDbError(null)
    expect(none.message).toBe("未知错误")
    expect(none.code).toBeNull()
  })

  it("unwrap 抛 DbError；unwrapMaybe 允许 null", () => {
    expect(() => unwrap({ data: null, error: pgError("42501") })).toThrowError(
      "没有权限执行该操作"
    )
    expect(unwrap({ data: [{ id: "x" }], error: null })).toEqual([{ id: "x" }])
    expect(
      unwrapMaybe<{ id: string } | null>({ data: null, error: null })
    ).toBeNull()
  })
})

describe("lib/db 封装在真实 RPC 错误上的表现（第 4 轮语义）", () => {
  let ctx: TestContext
  let owner: TestUser
  let picker: TestUser
  let other: TestUser
  let itemId = ""

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("owner")
    picker = await ctx.user("picker")
    other = await ctx.user("other")
    itemId = (await publishItem(owner, { title: "错误映射测试物品" })).id
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("createPickup 对不存在的物品 → 「物品不存在」（P0002 中文透出）", async () => {
    try {
      await dbCreatePickup(other.client, crypto.randomUUID())
      throw new Error("本应失败")
    } catch (error) {
      expect(error).toBeInstanceOf(DbError)
      expect((error as DbError).code).toBe("P0002")
      expect((error as DbError).message).toBe("物品不存在")
    }
  })

  it("拾主认领自己的物品 → 「不能认领自己发布的物品」（42501 中文透出）", async () => {
    try {
      await dbCreatePickup(owner.client, itemId)
      throw new Error("本应失败")
    } catch (error) {
      expect((error as DbError).code).toBe("42501")
      expect((error as DbError).message).toBe("不能认领自己发布的物品")
    }
  })

  it("第 7 轮：别人也能认领已被认领的物品（多人认领，靠线下协商）", async () => {
    await createPickup(picker, itemId)
    // 不再抛错：第二个认领人登记成功，物品保持 claimed
    await dbCreatePickup(other.client, itemId)
    const rows = await listItemPickups(owner.client, itemId)
    expect(rows.length).toBe(2)
  })

  it("已认领后撤单 → 「该物品已被认领，无法撤单」", async () => {
    try {
      await dbWithdrawItem(owner.client, itemId)
      throw new Error("本应失败")
    } catch (error) {
      expect((error as DbError).code).toBe("P0001")
      expect((error as DbError).message).toBe("该物品已被认领，无法撤单")
    }
  })

  it("非 owner 撤单 → 「无权操作该物品」", async () => {
    const mine = await publishItem(owner, { title: "撤单权限测试" })
    try {
      await dbWithdrawItem(other.client, mine.id)
      throw new Error("本应失败")
    } catch (error) {
      expect((error as DbError).code).toBe("42501")
      expect((error as DbError).message).toBe("无权操作该物品")
    }
  })

  it("revealContact 对未认领者 → 「请先提交领取信息」", async () => {
    const fresh = await publishItem(owner, { title: "未认领的物品" })
    try {
      await revealContact(other.client, fresh.id)
      throw new Error("本应被拒绝")
    } catch (error) {
      expect((error as DbError).code).toBe("42501")
      expect((error as DbError).message).toBe("请先提交领取信息")
    }
  })

  it("revealContact 对拾主本人 / 已认领者 → 拿到真实联系方式", async () => {
    const ownerView = await revealContact(owner.client, itemId)
    expect(ownerView?.contact).toBe("13800138000")

    const pickerView = await revealContact(picker.client, itemId)
    expect(pickerView?.contact).toBe("13800138000")
  })

  it("publishItem 参数不合法 → 「代为保管需要填写联系方式（至少 5 个字符）」", async () => {
    // 用真实登记行：这条用例考的是参数校验，不该先被「照片不存在」拦下
    const uploads = await createUploads(owner.id, 1)
    try {
      await dbPublishItem(owner.client, {
        title: "缺少联系方式",
        description: "kept 但没有电话。",
        custody: "kept",
        contact: "",
        lat: null,
        lng: null,
        locationLabel: "",
        uploadIds: uploads.map((upload) => upload.id),
      })
      throw new Error("本应失败")
    } catch (error) {
      expect((error as DbError).code).toBe("22023")
      expect((error as DbError).message).toBe(
        "代为保管需要填写联系方式（至少 5 个字符）"
      )
    }
  })

  it("getItem 对不存在的 id 返回 null（unwrapMaybe 语义）", async () => {
    const item = await getItem(owner.client, crypto.randomUUID())
    expect(item).toBeNull()
  })

  it("listWallItems 含已认领物品；listItemPickups 拿得到记录", async () => {
    const wall = await listWallItems(owner.client, { limit: 100, offset: 0 })
    const found = wall.find((entry) => entry.id === itemId)
    expect(found?.status).toBe("claimed")
    expect(found?.claimed_at).not.toBeNull()

    const pickups = await listItemPickups(owner.client, itemId)
    expect(pickups.length).toBeGreaterThanOrEqual(1)
    expect(pickups.some((row) => row.picker_name === picker.realName)).toBe(
      true
    )
  })

  it("withdrawItem 成功撤单后从墙上消失", async () => {
    const id = (await publishItem(owner, { title: "待撤单物品" })).id
    await dbWithdrawItem(owner.client, id)
    const wall = await listWallItems(owner.client, { limit: 100, offset: 0 })
    expect(wall.some((entry) => entry.id === id)).toBe(false)
  })

  it("第 7 轮：getMyProfile / updateMyProfile 走通，非法手机号被 CHECK 拒绝（23514）", async () => {
    // 注册即必填：初始就有姓名与手机号
    // （注意：上面的认领会按第 6 轮的行为把「认领用的手机号」写回个人信息）
    const initial = await getMyProfile(other.client, other.id)
    expect(initial?.real_name).toBeTruthy()
    expect(initial?.phone).toMatch(/^1[3-9][0-9]{9}$/)

    // 换一个没被占用的手机号（手机号唯一）
    const nextPhone = "13500000001"
    const saved = await updateMyProfile(other.client, other.id, {
      realName: "李四",
      phone: nextPhone,
    })
    expect(saved.real_name).toBe("李四")
    expect(saved.phone).toBe(nextPhone)

    const readBack = await getMyProfile(other.client, other.id)
    expect(readBack?.real_name).toBe("李四")
    expect(readBack?.phone).toBe(nextPhone)

    try {
      await updateMyProfile(other.client, other.id, {
        realName: "李四",
        phone: "abc",
      })
      throw new Error("本应失败")
    } catch (error) {
      expect((error as DbError).code).toBe("23514")
    }
  })
})
