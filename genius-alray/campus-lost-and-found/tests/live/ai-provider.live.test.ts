import { deflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"

import { getAiProviders } from "@/lib/ai"
import {
  AUTH_EMAIL_DOMAIN,
  createAdminClient,
  IMAGE_BUCKET,
  TEST_PASSWORD,
} from "../helpers/supabase"

/**
 * 真实模型联通性测试（默认跳过）。
 * 只有 AI_PROVIDER=ai-sdk 且配好 AI_API_KEY 时才运行；运行方式：pnpm test:live。
 * 离线基线（test:unit / test:rls / test:e2e）一律用 mock，不受此文件影响。
 *
 * 简化后的 AI 能力只有一件事：拍照 → title + description。
 * 这里覆盖关键链路：本地私有桶签名 URL（host=127.0.0.1，远端模型访问不到）
 * → provider 在服务端下载成字节 → 远端多模态模型 → 结构化输出。
 */

const enabled = process.env.AI_PROVIDER === "ai-sdk"

// ---------- 最小 PNG 编码器：造一张有辨识度的测试图 ----------
const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf: Buffer): number {
  let c = -1
  for (let i = 0; i < buf.length; i += 1)
    c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function makePng(
  size: number,
  pixel: (x: number, y: number) => [number, number, number]
): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  let o = 0
  for (let y = 0; y < size; y += 1) {
    raw[o] = 0
    o += 1
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y)
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      o += 3
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

const BAD_MARKERS = [/[A-Za-z0-9+/]{40,}={0,2}/, /https?:\/\//, /data:image/]
function looksClean(value: string): boolean {
  return !BAD_MARKERS.some((re) => re.test(value))
}

/** 第 7 轮起 profiles.real_name / phone 是 NOT NULL，建临时账号必须带上这两项 */
function liveAccount() {
  const phone =
    "13" +
    Math.floor(Math.random() * 1_000_000_000)
      .toString()
      .padStart(9, "0")
  return { phone, email: phone + "@" + AUTH_EMAIL_DOMAIN }
}

describe.skipIf(!enabled)("真实 AI provider：拍照 → 名称 + 描述", () => {
  it("signed URL（127.0.0.1）经服务端下载后能产出干净的 title/description", async () => {
    const admin = createAdminClient()
    const { phone, email } = liveAccount()

    const created = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { real_name: "联通性测试", phone },
    })
    expect(created.error).toBeNull()
    const userId = created.data.user!.id

    let storagePath = ""
    try {
      const png = makePng(200, (x, y) =>
        y > 70 && y < 110 ? [255, 255, 255] : [25, 70, 200]
      )
      storagePath = userId + "/" + crypto.randomUUID() + ".png"
      const upload = await admin.storage
        .from(IMAGE_BUCKET)
        .upload(storagePath, png, { contentType: "image/png", upsert: true })
      expect(upload.error).toBeNull()

      const signed = await admin.storage
        .from(IMAGE_BUCKET)
        .createSignedUrl(storagePath, 600)
      expect(signed.error).toBeNull()
      const signedUrl = signed.data!.signedUrl
      // 关键前提：本地签名 URL 指向 127.0.0.1，远端模型访问不到，
      // 必须由 provider 在服务端下载成字节后再发送。
      expect(signedUrl).toContain("127.0.0.1")

      const result = await getAiProviders().vision.analyze({
        imageUrls: [signedUrl],
      })
      console.log("[live] vision =", JSON.stringify(result).slice(0, 500))

      expect(typeof result.title).toBe("string")
      expect(result.title.trim().length).toBeGreaterThan(0)
      expect(result.title.length).toBeLessThanOrEqual(60)
      expect(looksClean(result.title)).toBe(true)

      expect(typeof result.description).toBe("string")
      expect(result.description.trim().length).toBeGreaterThan(0)
      expect(result.description.length).toBeLessThanOrEqual(600)
      expect(looksClean(result.description)).toBe(true)
    } finally {
      if (storagePath) {
        await admin.storage.from(IMAGE_BUCKET).remove([storagePath])
      }
      await admin.auth.admin.deleteUser(userId)
    }
  }, 420_000)

  it("拍完就给建议：review 能返回结构化的通过/补拍判断", async () => {
    const admin = createAdminClient()
    const { phone, email } = liveAccount()

    const created = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { real_name: "联通性测试", phone },
    })
    expect(created.error).toBeNull()
    const userId = created.data.user!.id

    let storagePath = ""
    try {
      const png = makePng(200, (x, y) =>
        y > 70 && y < 110 ? [255, 255, 255] : [200, 120, 40]
      )
      storagePath = userId + "/" + crypto.randomUUID() + ".png"
      const upload = await admin.storage
        .from(IMAGE_BUCKET)
        .upload(storagePath, png, { contentType: "image/png", upsert: true })
      expect(upload.error).toBeNull()

      const signed = await admin.storage
        .from(IMAGE_BUCKET)
        .createSignedUrl(storagePath, 600)
      const advice = await getAiProviders().vision.review({
        imageUrls: [signed.data!.signedUrl],
      })
      console.log("[live] review =", JSON.stringify(advice))

      // 合成色块图本身没有语义，判 ok 还是 retake 由模型决定，这里只锁定契约：
      // 必须是布尔 + 一句干净、够短、非空的中文建议。
      expect(typeof advice.ok).toBe("boolean")
      expect(typeof advice.reason).toBe("string")
      expect(advice.reason.trim().length).toBeGreaterThan(0)
      expect(advice.reason.length).toBeLessThanOrEqual(30)
      expect(looksClean(advice.reason)).toBe(true)
    } finally {
      if (storagePath) {
        await admin.storage.from(IMAGE_BUCKET).remove([storagePath])
      }
      await admin.auth.admin.deleteUser(userId)
    }
  }, 420_000)

  it("多张照片同样可用（一次分析全部照片）", async () => {
    const admin = createAdminClient()
    const { phone, email } = liveAccount()

    const created = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { real_name: "联通性测试", phone },
    })
    expect(created.error).toBeNull()
    const userId = created.data.user!.id

    const paths: string[] = []
    try {
      for (const [index, color] of (
        [
          [220, 40, 40],
          [40, 180, 90],
        ] as const
      ).entries()) {
        const path = userId + "/" + crypto.randomUUID() + ".png"
        const png = makePng(160, () => [color[0], color[1], color[2]])
        const upload = await admin.storage
          .from(IMAGE_BUCKET)
          .upload(path, png, { contentType: "image/png", upsert: true })
        expect(upload.error).toBeNull()
        paths.push(path)
        void index
      }

      const urls: string[] = []
      for (const path of paths) {
        const signed = await admin.storage
          .from(IMAGE_BUCKET)
          .createSignedUrl(path, 600)
        urls.push(signed.data!.signedUrl)
      }

      const result = await getAiProviders().vision.analyze({ imageUrls: urls })
      console.log("[live] vision(2) =", JSON.stringify(result).slice(0, 500))
      expect(result.title.trim().length).toBeGreaterThan(0)
      expect(looksClean(result.title)).toBe(true)
      expect(result.description.trim().length).toBeGreaterThan(0)
      expect(looksClean(result.description)).toBe(true)
    } finally {
      if (paths.length > 0) {
        await admin.storage.from(IMAGE_BUCKET).remove(paths)
      }
      await admin.auth.admin.deleteUser(userId)
    }
  }, 420_000)
})
