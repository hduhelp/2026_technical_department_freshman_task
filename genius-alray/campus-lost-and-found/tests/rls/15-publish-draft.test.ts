import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createUpload, publishItem, readAppConfig } from "../helpers/fixtures"
import {
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 矩阵 15：发布草稿（第 10 轮）
 *
 * - **一个用户只有一份草稿**：`user_id` 就是主键，数据库层不可能出现第二份；
 * - 客户端只能读自己的草稿，写入一律走 RPC（attach / detach / save）；
 * - 照片在上传成功时就挂到草稿上：移除它会**同时删掉登记行**（对象由服务端删）；
 * - 发布成功后草稿被清空。
 */
describe("矩阵 15：发布草稿", () => {
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

  async function attach(user: TestUser, uploadId: string) {
    return await user.client.rpc("attach_draft_photo", {
      p_upload_id: uploadId,
    })
  }

  async function saveDraftText(user: TestUser, title: string) {
    return await user.client.rpc("save_publish_draft", { p_title: title })
  }

  it("一个用户只有一份草稿：反复保存仍然只有一行", async () => {
    const first = await saveDraftText(owner, "第一次")
    expect(first.error).toBeNull()
    const second = await saveDraftText(owner, "第二次")
    expect(second.error).toBeNull()

    const rows = await ctx.admin
      .from("publish_drafts")
      .select("user_id, title")
      .eq("user_id", owner.id)
    expect(rows.data?.length).toBe(1)
    // 是覆盖而不是新增
    expect(rows.data?.[0]?.title).toBe("第二次")

    // 再直接插一行会被主键挡住 —— 「不能同时拥有多个草稿」是数据库保证的
    const duplicate = await ctx.admin
      .from("publish_drafts")
      .insert({ user_id: owner.id, title: "第二份" })
    expect(duplicate.error?.code).toBe("23505")
  })

  it("RLS：读不到别人的草稿；客户端没有任何写权限", async () => {
    await saveDraftText(other, "别人的草稿")

    const peek = await owner.client
      .from("publish_drafts")
      .select("user_id, title")
    expect(peek.error).toBeNull()
    expect(peek.data?.some((row) => row.user_id === other.id)).toBe(false)

    const forgedWrite = await owner.client
      .from("publish_drafts")
      .insert({ user_id: owner.id, title: "客户端直写" })
    expect(forgedWrite.error).not.toBeNull()
  })

  it("照片挂进草稿：按挂载顺序编号，重复挂同一张是幂等", async () => {
    const user = await ctx.user("attach")
    const first = await createUpload(user.id)
    const second = await createUpload(user.id)

    expect((await attach(user, first.id)).data).toBe(1)
    expect((await attach(user, second.id)).data).toBe(2)
    // 幂等：重试同一次上传不该占两张名额
    expect((await attach(user, first.id)).data).toBe(2)

    const links = await user.client
      .from("publish_draft_images")
      .select("upload_id, position")
      .order("position")
    expect(links.data?.map((row) => row.upload_id)).toEqual([
      first.id,
      second.id,
    ])
    expect(links.data?.map((row) => row.position)).toEqual([0, 1])
  })

  it("挂载/移除照片也算「草稿有活动」（清理脚本据此判断僵尸草稿）", async () => {
    const user = await ctx.user("touch")
    const upload = await createUpload(user.id)
    expect((await saveDraftText(user, "活动草稿")).error).toBeNull()

    const readUpdatedAt = async () => {
      const row = await ctx.admin
        .from("publish_drafts")
        .select("updated_at")
        .eq("user_id", user.id)
        .single()
      return row.data?.updated_at
    }

    // 两次调用各在一个事务里，now() 精度到微秒 —— 直接比字符串即可，不需要 sleep
    const before = await readUpdatedAt()
    expect((await attach(user, upload.id)).error).toBeNull()
    const afterAttach = await readUpdatedAt()
    expect(afterAttach).not.toBe(before)

    expect(
      (
        await user.client.rpc("detach_draft_photo", {
          p_upload_id: upload.id,
        })
      ).error
    ).toBeNull()
    expect(await readUpdatedAt()).not.toBe(afterAttach)
  })

  it("照片张数上限由 app_config.max_photos 把关", async () => {
    const user = await ctx.user("cap")
    const config = await readAppConfig()

    const uploads = []
    for (let index = 0; index < config.max_photos; index += 1) {
      uploads.push(await createUpload(user.id))
    }
    for (const upload of uploads) {
      expect((await attach(user, upload.id)).error).toBeNull()
    }

    // 第 max_photos + 1 张被拒
    const overflow = await createUpload(user.id)
    const rejected = await attach(user, overflow.id)
    expect(rejected.error?.code).toBe("22023")
    expect(rejected.error?.message).toContain("最多")
  })

  it("不能把别人的照片挂进自己的草稿", async () => {
    const mine = await ctx.user("mine")
    const theirs = await createUpload(other.id)
    const result = await attach(mine, theirs.id)
    expect(result.error?.code).toBe("42501")
  })

  it("已发布的照片不能再挂进草稿", async () => {
    const user = await ctx.user("consumed")
    const upload = await createUpload(user.id)
    await publishItem(user, { title: "先用掉这张", uploadIds: [upload.id] })

    const result = await attach(user, upload.id)
    expect(result.error?.code).toBe("P0001")
  })

  it("从草稿移除照片：返回存储路径，登记行与草稿关联一起消失", async () => {
    const user = await ctx.user("detach")
    const upload = await createUpload(user.id)
    expect((await attach(user, upload.id)).error).toBeNull()

    const detached = await user.client.rpc("detach_draft_photo", {
      p_upload_id: upload.id,
    })
    expect(detached.error).toBeNull()
    // 路径交回给服务端去删对象
    expect(detached.data).toBe(upload.path)

    const uploadRow = await ctx.admin
      .from("image_uploads")
      .select("id")
      .eq("id", upload.id)
    expect(uploadRow.data).toEqual([])

    const links = await user.client
      .from("publish_draft_images")
      .select("upload_id")
    expect(links.data).toEqual([])

    // 再删一次：草稿里已经没有它了
    const again = await user.client.rpc("detach_draft_photo", {
      p_upload_id: upload.id,
    })
    expect(again.error?.code).toBe("P0002")
  })

  it("发布成功后草稿被清空（草稿就是「用完即弃」）", async () => {
    const user = await ctx.user("publish")
    const upload = await createUpload(user.id)
    expect((await attach(user, upload.id)).error).toBeNull()
    expect((await saveDraftText(user, "待发布的草稿")).error).toBeNull()

    await publishItem(user, {
      title: "草稿发布出来的物品",
      uploadIds: [upload.id],
    })

    const drafts = await user.client.from("publish_drafts").select("user_id")
    expect(drafts.data).toEqual([])
    const links = await user.client
      .from("publish_draft_images")
      .select("upload_id")
    expect(links.data).toEqual([])
  })

  it("anon 不能碰草稿相关 RPC", async () => {
    const upload = await createUpload(owner.id)
    for (const call of [
      ctx.anon.rpc("save_publish_draft", { p_title: "匿名" }),
      ctx.anon.rpc("attach_draft_photo", { p_upload_id: upload.id }),
      ctx.anon.rpc("detach_draft_photo", { p_upload_id: upload.id }),
    ]) {
      const result = await call
      expect(result.error).not.toBeNull()
      expect(["42501", "PGRST202"]).toContain(result.error?.code)
    }
  })
})
