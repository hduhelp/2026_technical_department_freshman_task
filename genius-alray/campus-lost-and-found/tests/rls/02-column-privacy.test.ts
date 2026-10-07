import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DEFAULT_CONTACT, publishItem, readSecret } from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 安全矩阵 2（本轮最关键）：列级保密
 * contact / location_lat / location_lng / location_label 对客户端 REVOKE，
 * 任何查询碰这些列（包括星号 select）都必须 42501。
 */
const SECRET_COLUMNS = [
  "contact",
  "location_lat",
  "location_lng",
  "location_label",
]

describe("矩阵 2：contact / location_* 列级 REVOKE", () => {
  let ctx: TestContext
  let owner: TestUser
  let viewer: TestUser
  let keptId = ""
  let inPlaceId = ""

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("owner")
    viewer = await ctx.user("viewer")

    keptId = (
      await publishItem(owner, {
        title: "机密的黑色钱包",
        contact: DEFAULT_CONTACT,
      })
    ).id
    inPlaceId = (
      await publishItem(owner, {
        custody: "in_place",
        title: "机密的雨伞",
        locationLabel: "图书馆 3 楼自习区靠窗第三排",
        lat: 31.230416,
        lng: 121.473701,
      })
    ).id
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("前提：机密列在数据库里确实有值（service_role oracle）", async () => {
    const secret = await readSecret(ctx, keptId)
    expect(secret.contact).toBe(DEFAULT_CONTACT)
    const inPlace = await readSecret(ctx, inPlaceId)
    expect(inPlace.location_label).toBe("图书馆 3 楼自习区靠窗第三排")
    expect(inPlace.location_lat).toBeCloseTo(31.230416, 5)
  })

  it("矩阵 2：物品 owner 自己也无法直接读这些列", async () => {
    for (const column of SECRET_COLUMNS) {
      const result = await owner.client
        .from("found_items")
        .select("id, " + column)
        .eq("id", keptId)
      expect(result.error, column + " 不应可读").not.toBeNull()
      expect(result.error?.code).toBe("42501")
      expect(result.data).toBeNull()
    }
  })

  it("矩阵 2：其他登录用户读这些列同样 42501", async () => {
    for (const column of SECRET_COLUMNS) {
      const result = await viewer.client
        .from("found_items")
        .select("id, " + column)
        .eq("id", keptId)
      expect(result.error?.code).toBe("42501")
      expect(result.data).toBeNull()
    }
  })

  it("矩阵 2：星号 select 同样 42501（不能靠 * 绕过列级权限）", async () => {
    const ownerStar = await owner.client
      .from("found_items")
      .select("*")
      .eq("id", keptId)
    expect(ownerStar.error).not.toBeNull()
    expect(ownerStar.error?.code).toBe("42501")
    expect(ownerStar.data).toBeNull()

    const viewerStar = await viewer.client
      .from("found_items")
      .select("*")
      .eq("id", keptId)
    expect(viewerStar.error?.code).toBe("42501")

    const anonStar = await ctx.anon.from("found_items").select("*")
    expect(anonStar.data ?? []).toEqual([])
    if (anonStar.error) expect(anonStar.error.code).toBe("42501")
  })

  it("矩阵 2：公开列的 select 仍然正常，且返回对象里没有机密键", async () => {
    const result = await viewer.client
      .from("found_items")
      .select(
        "id, owner_id, title, description, custody, status, created_at, updated_at, claimed_at, withdrawn_at"
      )
      .eq("id", keptId)
      .single()

    expect(result.error).toBeNull()
    const row = (result.data ?? {}) as Record<string, unknown>
    for (const column of SECRET_COLUMNS) {
      expect(Object.keys(row)).not.toContain(column)
    }
    expect(row.title).toBe("机密的黑色钱包")
  })

  it("矩阵 2：留在原地的物品，位置列同样不可读", async () => {
    for (const column of ["location_lat", "location_lng", "location_label"]) {
      const result = await viewer.client
        .from("found_items")
        .select("id, " + column)
        .eq("id", inPlaceId)
      expect(result.error?.code).toBe("42501")
    }
  })
})
