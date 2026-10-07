import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  DEFAULT_CONTACT,
  DEFAULT_DESCRIPTION,
  createUpload,
  createUploads,
  publishItem,
  publishItemRaw,
} from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 安全矩阵 9：publish_found_item 的服务端校验
 *
 * 第 9 轮：照片归属不再是「客户端传的路径前缀等于自己的 uid」，而是
 * **image_uploads 里那一行是不是你的** —— 客户端从头到尾只拿得到不透明 id，
 * 路径、'..'、'//' 这些花招也就无从谈起。
 *
 * 其余校验：数量 1..max_photos、同一张不能重复引用、已用过的不能再用、
 * kept 必须有联系方式、in_place 必须有位置详情（坐标只是补充）、名称/描述长度。
 */
describe("矩阵 9：发布 RPC 的校验", () => {
  let ctx: TestContext
  let owner: TestUser
  let other: TestUser

  beforeAll(async () => {
    ctx = createTestContext()
    owner = await ctx.user("owner")
    other = await ctx.user("other")
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("矩阵 9：anon 调用被拒", async () => {
    const result = await ctx.anon.rpc("publish_found_item", {
      p_title: "匿名发布",
      p_description: "匿名描述",
      p_custody: "kept",
      p_contact: DEFAULT_CONTACT,
    } as never)
    expect(result.error).not.toBeNull()
    expect(result.error?.code).toBe("42501")
  })

  it("矩阵 9：引用别人的照片 → 42501；不存在的 id → P0002；混入一张别人的 → 42501", async () => {
    const mine = await createUpload(owner.id)
    const theirs = await createUpload(other.id)

    const stolen = await publishItemRaw(owner, {
      title: "偷别人的照片",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: DEFAULT_CONTACT,
      uploadIds: [theirs.id],
    })
    expect(stolen.error?.code).toBe("42501")
    expect(stolen.data).toBeNull()

    const missing = await publishItemRaw(owner, {
      title: "不存在的照片",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: DEFAULT_CONTACT,
      uploadIds: [crypto.randomUUID()],
    })
    expect(missing.error?.code).toBe("P0002")
    expect(missing.data).toBeNull()

    // 混入一张别人的：整体失败，不是「能塞几张算几张」
    const mixed = await publishItemRaw(owner, {
      title: "混入别人的照片",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: DEFAULT_CONTACT,
      uploadIds: [mine.id, theirs.id],
    })
    expect(mixed.error?.code).toBe("42501")

    // 三次失败都不该留下物品
    const leaked = await ctx.admin
      .from("found_items")
      .select("id", { count: "exact", head: true })
      .in("title", ["偷别人的照片", "不存在的照片", "混入别人的照片"])
    expect(leaked.count).toBe(0)

    // 自己那张照片没有被失败请求吃掉，照常可用
    const usable = await publishItemRaw(owner, {
      title: "自己的照片照常可用",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: DEFAULT_CONTACT,
      uploadIds: [mine.id],
    })
    expect(usable.error).toBeNull()
  })

  it("矩阵 9：同一张照片重复引用 → 22023", async () => {
    const one = await createUpload(owner.id)
    const result = await publishItemRaw(owner, {
      title: "重复引用同一张",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: DEFAULT_CONTACT,
      uploadIds: [one.id, one.id],
    })
    expect(result.error?.code).toBe("22023")
    expect(result.error?.message).toContain("不能重复使用")
  })

  it("矩阵 9：已经用过的照片不能再次发布 → P0001", async () => {
    const one = await createUpload(owner.id)
    const first = await publishItemRaw(owner, {
      title: "先用一次",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: DEFAULT_CONTACT,
      uploadIds: [one.id],
    })
    expect(first.error).toBeNull()

    const again = await publishItemRaw(owner, {
      title: "再用一次",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: DEFAULT_CONTACT,
      uploadIds: [one.id],
    })
    expect(again.error?.code).toBe("P0001")
    expect(again.error?.message).toContain("已被使用")
  })

  it("矩阵 9：0 张或超过 max_photos → 22023", async () => {
    const config = await owner.client.rpc("get_app_config", {})
    const maxPhotos = config.data?.[0]?.max_photos ?? 3
    expect(maxPhotos).toBe(3)

    const none = await publishItemRaw(owner, {
      title: "没有照片",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: DEFAULT_CONTACT,
      photoCount: 0,
    })
    expect(none.error?.code).toBe("22023")

    const tooMany = await publishItemRaw(owner, {
      title: "照片太多",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: DEFAULT_CONTACT,
      photoCount: maxPhotos + 1,
    })
    expect(tooMany.error?.code).toBe("22023")
  })

  it("矩阵 9：kept 缺少联系方式 / 联系方式过短 → 22023", async () => {
    const missing = await publishItemRaw(owner, {
      title: "没有电话",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
    })
    expect(missing.error?.code).toBe("22023")

    const tooShort = await publishItemRaw(owner, {
      title: "电话太短",
      description: DEFAULT_DESCRIPTION,
      custody: "kept",
      contact: "1234",
    })
    expect(tooShort.error?.code).toBe("22023")
  })

  it("矩阵 9：in_place 没有位置详情 → 22023（无坐标、只有坐标都拒）", async () => {
    const noLocation = await publishItemRaw(owner, {
      title: "没有位置",
      description: DEFAULT_DESCRIPTION,
      custody: "in_place",
    })
    expect(noLocation.error?.code).toBe("22023")
    expect(noLocation.error?.message).toContain("位置详情")

    // 只有坐标不算填了位置详情：用户看不到「在哪」，也不该看到经纬度
    const onlyCoords = await publishItemRaw(owner, {
      title: "只有坐标",
      description: DEFAULT_DESCRIPTION,
      custody: "in_place",
      lat: 31.230416,
      lng: 121.473701,
    })
    expect(onlyCoords.error?.code).toBe("22023")
    expect(onlyCoords.data).toBeNull()
  })

  it("矩阵 9：名称/描述长度非法 → 22023", async () => {
    const cases: Array<{ title: string; description: string }> = [
      { title: "", description: DEFAULT_DESCRIPTION },
      { title: "x".repeat(61), description: DEFAULT_DESCRIPTION },
      { title: "正常名称", description: "" },
      { title: "正常名称", description: "x".repeat(601) },
    ]
    for (const item of cases) {
      const result = await publishItemRaw(owner, {
        title: item.title,
        description: item.description,
        custody: "kept",
        contact: DEFAULT_CONTACT,
      })
      expect(
        result.error?.code,
        item.title.length + "/" + item.description.length
      ).toBe("22023")
    }
  })

  it("矩阵 9：合法输入成功发布，照片按登记顺序落库并标记已使用", async () => {
    const seeds = await createUploads(owner.id, 3)
    const result = await publishItemRaw(owner, {
      title: "三张照片的水杯",
      description: "棕色圆柱形水杯。",
      custody: "kept",
      contact: DEFAULT_CONTACT,
      uploadIds: seeds.map((seed) => seed.id),
    })
    expect(result.error).toBeNull()
    expect(typeof result.data).toBe("string")

    const itemId = result.data as string
    const item = await ctx.admin
      .from("found_items")
      .select("title, status, custody, contact")
      .eq("id", itemId)
      .single()
    expect(item.data?.title).toBe("三张照片的水杯")
    expect(item.data?.status).toBe("published")
    expect(item.data?.contact).toBe(DEFAULT_CONTACT)

    const images = await ctx.admin
      .from("found_item_images")
      .select("storage_path, position")
      .eq("found_item_id", itemId)
      .order("position")
    expect(images.data?.length).toBe(3)
    expect(images.data?.map((row) => row.position)).toEqual([0, 1, 2])
    // storage_path 由服务端从登记行取出，与发布方给的 id 顺序一致
    expect(images.data?.map((row) => row.storage_path)).toEqual(
      seeds.map((seed) => seed.path)
    )

    const consumed = await ctx.admin
      .from("image_uploads")
      .select("consumed_at")
      .in(
        "id",
        seeds.map((seed) => seed.id)
      )
    expect(consumed.data?.length).toBe(3)
    expect(consumed.data?.every((row) => row.consumed_at !== null)).toBe(true)
  })

  it("矩阵 9：in_place 填了位置详情即可发布（坐标可选、联系方式不落库）", async () => {
    const byLabel = await publishItem(owner, {
      custody: "in_place",
      title: "填了位置详情",
      locationLabel: "图书馆 3 楼自习区",
    })
    const labelSecret = await ctx.admin
      .from("found_items")
      .select("contact, location_lat, location_label")
      .eq("id", byLabel.id)
      .single()
    expect(labelSecret.data?.contact).toBeNull()
    expect(labelSecret.data?.location_label).toBe("图书馆 3 楼自习区")
    expect(labelSecret.data?.location_lat).toBeNull()

    const withCoords = await publishItem(owner, {
      custody: "in_place",
      title: "位置详情 + 坐标",
      locationLabel: "图书馆 3 楼自习区",
      lat: 31.230416,
      lng: 121.473701,
    })
    const coordSecret = await ctx.admin
      .from("found_items")
      .select("contact, location_lat, location_lng, location_label")
      .eq("id", withCoords.id)
      .single()
    expect(coordSecret.data?.contact).toBeNull()
    expect(coordSecret.data?.location_label).toBe("图书馆 3 楼自习区")
    expect(coordSecret.data?.location_lat).toBeCloseTo(31.230416, 5)
    expect(coordSecret.data?.location_lng).toBeCloseTo(121.473701, 5)
  })
})
