import { describe, expect, it } from "vitest"
import { createMockProviders } from "@/lib/ai/mock"

/**
 * 视觉 mock 的确定性契约：
 * - 同一组照片（忽略签名 URL 的 token）→ 同一份 title/description
 * - 任何输入都不允许出现 undefined / 空串 / 脏字符串
 * - 输出必须满足发布侧的字段长度约束（title<=60、description<=600）
 */
const PATHS = [
  "https://example.test/storage/v1/object/sign/item-images/u/a.jpg",
  "https://example.test/storage/v1/object/sign/item-images/u/b.jpg",
]

function signed(path: string, token: string): string {
  return path + "?token=" + token
}

function expectClean(result: { title: string; description: string }): void {
  expect(typeof result.title).toBe("string")
  expect(typeof result.description).toBe("string")
  expect(result.title.trim().length).toBeGreaterThan(0)
  expect(result.description.trim().length).toBeGreaterThan(0)
  expect(result.title).not.toContain("undefined")
  expect(result.description).not.toContain("undefined")
  expect(result.title).not.toContain("[object Object]")
  expect(result.description).not.toContain("[object Object]")
  expect(result.title.length).toBeLessThanOrEqual(60)
  expect(result.description.length).toBeLessThanOrEqual(600)
}

describe("lib/ai/mock：确定性", () => {
  it("同一 imageUrls 连续两次调用结果相同（含跨实例）", async () => {
    const first = await createMockProviders().vision.analyze({
      imageUrls: PATHS,
    })
    const second = await createMockProviders().vision.analyze({
      imageUrls: PATHS,
    })
    expect(second).toEqual(first)
  })

  it("只有签名 token 不同（路径相同）时结果仍相同", async () => {
    const providers = createMockProviders()
    const base = await providers.vision.analyze({ imageUrls: PATHS })
    const a = await providers.vision.analyze({
      imageUrls: PATHS.map((path) => signed(path, "AAA")),
    })
    const b = await providers.vision.analyze({
      imageUrls: PATHS.map((path) => signed(path, "BBB")),
    })
    const c = await providers.vision.analyze({
      imageUrls: PATHS.map((path) => signed(path, "token-" + Math.random())),
    })
    expect(a).toEqual(base)
    expect(b).toEqual(base)
    expect(c).toEqual(base)
  })

  it("照片顺序不影响结果（哈希前会排序）", async () => {
    const providers = createMockProviders()
    const forward = await providers.vision.analyze({ imageUrls: PATHS })
    const reversed = await providers.vision.analyze({
      imageUrls: [...PATHS].reverse(),
    })
    expect(reversed).toEqual(forward)
  })

  it("不同照片组会得到不同结果（不是常量）", async () => {
    const providers = createMockProviders()
    const titles = new Set<string>()
    for (let i = 0; i < 20; i += 1) {
      const result = await providers.vision.analyze({
        imageUrls: ["https://example.test/p/" + i + "/" + i + ".jpg"],
      })
      titles.add(result.title)
    }
    expect(titles.size).toBeGreaterThan(1)
  })
})

describe("lib/ai/mock：数百个输入都干净", () => {
  it("600 组输入：title / description 均非空、无 undefined、长度合规", async () => {
    const providers = createMockProviders()
    for (let i = 0; i < 600; i += 1) {
      const count = (i % 3) + 1
      const imageUrls = Array.from(
        { length: count },
        (_, index) =>
          "https://example.test/run/" +
          i +
          "/photo-" +
          index +
          "-" +
          i +
          ".jpg?token=" +
          i
      )
      const result = await providers.vision.analyze({ imageUrls })
      expectClean(result)
      // 描述里会带上照片数量，验证它确实用到了输入
      expect(result.description).toContain("照片共 " + count + " 张")
    }
  }, 60_000)

  it("单张照片也能得到可用结果（发布最低要求是 1 张）", async () => {
    const result = await createMockProviders().vision.analyze({
      imageUrls: ["https://example.test/only.jpg"],
    })
    expectClean(result)
    expect(result.description).toContain("照片共 1 张")
  })
})

/**
 * 第 3 轮新增：vision.review 的拍照建议契约（E2E 的断言依据）
 *   < 2 张 → { ok: false, reason: "只有一张，换个角度再拍一张" }
 *   >= 2 张 → { ok: true,  reason: "照片够清楚，可以直接用" }
 */
describe("lib/ai/mock：拍照建议 review", () => {
  it("只有 1 张 → ok=false + 建议补拍（reason 契约文案）", async () => {
    const advice = await createMockProviders().vision.review({
      imageUrls: ["https://example.test/only.jpg"],
    })
    expect(advice.ok).toBe(false)
    expect(advice.reason).toBe("只有一张，换个角度再拍一张")
  })

  it("2 张与 3 张 → ok=true + 可以直接用", async () => {
    for (const count of [2, 3, 5]) {
      const advice = await createMockProviders().vision.review({
        imageUrls: Array.from(
          { length: count },
          (_, index) => "https://example.test/p/" + index + ".jpg"
        ),
      })
      expect(advice.ok, count + " 张").toBe(true)
      expect(advice.reason).toBe("照片够清楚，可以直接用")
    }
  })

  it("确定性：同输入两次相同；签名 token 不同也相同", async () => {
    const providers = createMockProviders()
    const first = await providers.vision.review({ imageUrls: PATHS })
    const second = await providers.vision.review({ imageUrls: PATHS })
    expect(second).toEqual(first)

    const withTokens = await providers.vision.review({
      imageUrls: PATHS.map((path) => signed(path, "token-" + Math.random())),
    })
    expect(withTokens).toEqual(first)
  })

  it("reason 是短句（<=30 字）且非空", async () => {
    for (const urls of [[PATHS[0]], PATHS]) {
      const advice = await createMockProviders().vision.review({
        imageUrls: urls,
      })
      expect(advice.reason.trim().length).toBeGreaterThan(0)
      expect(advice.reason.length).toBeLessThanOrEqual(30)
    }
  })
})
