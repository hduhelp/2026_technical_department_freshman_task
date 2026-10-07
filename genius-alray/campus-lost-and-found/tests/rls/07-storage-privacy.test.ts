import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { uploadObject } from "../helpers/fixtures"
import {
  ANON_KEY,
  IMAGE_BUCKET,
  PNG_BYTES,
  SUPABASE_URL,
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * 安全矩阵 8：私有桶
 * 匿名与 authenticated 都无法直接读取对象，客户端也无法签发签名 URL；
 * 只有服务端（service_role）签发的短时效 URL 能读。
 */
describe("矩阵 8：私有图片桶访问控制", () => {
  let ctx: TestContext
  let reader: TestUser
  let objectPath = ""
  let signedUrl = ""

  beforeAll(async () => {
    ctx = createTestContext()
    reader = await ctx.user("reader")
    objectPath = reader.id + "/" + crypto.randomUUID() + ".png"
    await uploadObject(ctx, objectPath)
  }, 60_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("矩阵 8：匿名与 authenticated 直接 GET 对象均被拒绝", async () => {
    const objectUrl =
      SUPABASE_URL + "/storage/v1/object/" + IMAGE_BUCKET + "/" + objectPath

    const anonResponse = await fetch(objectUrl, {
      headers: { apikey: ANON_KEY },
    })
    expect(anonResponse.status).toBeGreaterThanOrEqual(400)
    expect(anonResponse.status).not.toBe(200)

    const token = await reader.token()
    expect(token.length).toBeGreaterThan(0)
    const authedResponse = await fetch(objectUrl, {
      headers: { apikey: ANON_KEY, Authorization: "Bearer " + token },
    })
    expect(authedResponse.status).toBeGreaterThanOrEqual(400)
    expect(authedResponse.status).not.toBe(200)
  })

  it("矩阵 8：public URL 路径同样不可读（桶非公开）", async () => {
    const response = await fetch(
      SUPABASE_URL +
        "/storage/v1/object/public/" +
        IMAGE_BUCKET +
        "/" +
        objectPath
    )
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).not.toBe(200)
  })

  it("矩阵 8：客户端无法签发签名 URL，仅服务端可以", async () => {
    const anonSigned = await ctx.anon.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(objectPath, 60)
    expect(anonSigned.error).not.toBeNull()
    expect(anonSigned.data?.signedUrl ?? "").toBe("")

    const authedSigned = await reader.client.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(objectPath, 60)
    expect(authedSigned.error).not.toBeNull()

    const adminSigned = await ctx.admin.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(objectPath, 3600)
    expect(adminSigned.error).toBeNull()
    signedUrl = adminSigned.data?.signedUrl ?? ""
    expect(signedUrl).toContain("token=")
  })

  it("矩阵 8：服务端签名 URL 能读回同一份字节", async () => {
    expect(signedUrl).not.toBe("")
    const response = await fetch(signedUrl)
    expect(response.status).toBe(200)
    const buffer = Buffer.from(await response.arrayBuffer())
    expect(buffer.equals(PNG_BYTES)).toBe(true)
  })

  it("矩阵 8：匿名/他人无法 list 到桶内对象", async () => {
    const anonListed = await ctx.anon.storage
      .from(IMAGE_BUCKET)
      .list("", { limit: 100 })
    expect(anonListed.data ?? []).toEqual([])

    const authedListed = await reader.client.storage
      .from(IMAGE_BUCKET)
      .list("", { limit: 100 })
    expect((authedListed.data ?? []).map((entry) => entry.name)).toEqual([])
  })

  it("矩阵 8：客户端也无法直传对象（无写入策略）", async () => {
    const upload = await reader.client.storage
      .from(IMAGE_BUCKET)
      .upload(
        reader.id + "/direct-" + crypto.randomUUID() + ".png",
        PNG_BYTES,
        {
          contentType: "image/png",
        }
      )
    expect(upload.error).not.toBeNull()
  })
})
