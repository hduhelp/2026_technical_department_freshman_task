import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { publishItem } from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 安全矩阵 4：客户端对三张业务表没有任何写权限（insert / update / delete 全部被拒）。
 * 所有写入必须经 SECURITY DEFINER RPC。
 */
describe("矩阵 4：客户端写权限被完全收回", () => {
  let ctx: TestContext
  let owner: TestUser
  let other: TestUser
  let itemId = ""
  let imageId = ""

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("owner")
    other = await ctx.user("other")
    itemId = (await publishItem(owner, { photoCount: 1 })).id
    const image = await ctx.admin
      .from("found_item_images")
      .select("id")
      .eq("found_item_id", itemId)
      .limit(1)
      .single()
    imageId = image.data?.id ?? ""
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("矩阵 4：found_items 无法 insert / update / delete", async () => {
    const insert = await owner.client
      .from("found_items")
      .insert({
        owner_id: owner.id,
        title: "偷偷插入",
        description: "x",
        custody: "kept",
        contact: "13800138000",
      } as never)
      .select("id")
    expect(insert.error).not.toBeNull()
    expect(insert.error?.code).toBe("42501")

    const update = await owner.client
      .from("found_items")
      .update({ title: "偷偷改名" })
      .eq("id", itemId)
      .select("id")
    expect(update.error).not.toBeNull()
    expect(update.error?.code).toBe("42501")

    const remove = await owner.client
      .from("found_items")
      .delete()
      .eq("id", itemId)
      .select("id")
    expect(remove.error).not.toBeNull()
    expect(remove.error?.code).toBe("42501")
  })

  it("矩阵 4：found_item_images 无法 insert / delete", async () => {
    const insert = await owner.client.from("found_item_images").insert({
      found_item_id: itemId,
      storage_path: owner.id + "/sneaky.jpg",
      position: 1,
    } as never)
    expect(insert.error).not.toBeNull()
    expect(insert.error?.code).toBe("42501")

    const remove = await owner.client
      .from("found_item_images")
      .delete()
      .eq("id", imageId)
    expect(remove.error).not.toBeNull()
    expect(remove.error?.code).toBe("42501")

    const update = await owner.client
      .from("found_item_images")
      .update({ position: 3 })
      .eq("id", imageId)
    expect(update.error).not.toBeNull()
    expect(update.error?.code).toBe("42501")
  })

  it("矩阵 4：pickups 无法 insert / update / delete", async () => {
    const insert = await other.client.from("pickups").insert({
      found_item_id: itemId,
      picker_id: other.id,
      picker_name: "李四",
      picker_phone: "13900139000",
    } as never)
    expect(insert.error).not.toBeNull()
    expect(insert.error?.code).toBe("42501")

    const update = await other.client
      .from("pickups")
      .update({ picker_phone: "000" })
      .eq("found_item_id", itemId)
    expect(update.error).not.toBeNull()
    expect(update.error?.code).toBe("42501")

    const remove = await other.client
      .from("pickups")
      .delete()
      .eq("found_item_id", itemId)
    expect(remove.error).not.toBeNull()
    expect(remove.error?.code).toBe("42501")
  })

  it("矩阵 4：anon 同样没有任何写权限", async () => {
    const insert = await ctx.anon.from("found_items").insert({
      owner_id: owner.id,
      title: "anon 插入",
      description: "x",
      custody: "kept",
      contact: "13800138000",
    } as never)
    expect(insert.error).not.toBeNull()
    expect(insert.error?.code).toBe("42501")
  })

  it("矩阵 4：上述尝试都没有真的改动数据库", async () => {
    const item = await ctx.admin
      .from("found_items")
      .select("title, status")
      .eq("id", itemId)
      .single()
    expect(item.data?.title).toBe("测试物品")
    expect(item.data?.status).toBe("published")

    const images = await ctx.admin
      .from("found_item_images")
      .select("id", { count: "exact", head: true })
      .eq("found_item_id", itemId)
    expect(images.count).toBe(1)
  })
})
