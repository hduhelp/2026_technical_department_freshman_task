import type { AiProviders, PhotoAdvice, VisionResult } from "@/lib/types"

// ============================================================
// 确定性 mock：同一组照片永远得到同一份名称与描述，零网络。
// ============================================================

function fnv1a(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 必须用无符号取模：seed 可能落在 int32 负半区，直接 % 会得到负下标 → undefined */
function pick<T>(pool: readonly T[], seed: number): T {
  return pool[(seed >>> 0) % pool.length]
}

/**
 * 只对「稳定部分」取哈希。
 * 图片传入的是带 token 的签名 URL，token 每次都变；
 * 若把整个 URL 纳入哈希，同一组照片会得到不同结果（破坏确定性契约）。
 */
function stableSeed(imageUrls: string[]): number {
  const stable = imageUrls.map((url) => url.split("?")[0]).sort()
  return fnv1a(stable.join("|"))
}

const TYPE_POOL = [
  "钱包",
  "水杯",
  "耳机",
  "钥匙",
  "雨伞",
  "书包",
  "手表",
  "手机",
  "书本",
  "眼镜",
] as const
const COLOR_POOL = [
  "黑色",
  "白色",
  "蓝色",
  "红色",
  "银色",
  "米色",
  "绿色",
  "棕色",
] as const
const SHAPE_POOL = ["方形", "长方形", "圆形", "圆柱形", "扁平", "细长"] as const
const MARK_POOL = [
  "贴纸",
  "logo",
  "手写名字",
  "挂饰",
  "划痕",
  "缝线补丁",
] as const

/**
 * 可选的确定性延时，只影响 mock。
 * E2E 通过 playwright.config.ts 的 MOCK_AI_DELAY_MS 打开它，
 * 才能稳定断言「加载态」这种转瞬即逝的中间状态（默认 0，不影响开发体验）。
 */
function mockDelayMs(): number {
  const raw = Number(process.env.MOCK_AI_DELAY_MS ?? 0)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.min(raw, 10_000)
}

async function pace(): Promise<void> {
  const ms = mockDelayMs()
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
}

export function createMockProviders(): AiProviders {
  return {
    vision: {
      async analyze({ imageUrls }): Promise<VisionResult> {
        await pace()
        const seed = stableSeed(imageUrls)
        const type = pick(TYPE_POOL, seed)
        const color = pick(COLOR_POOL, seed >>> 3)
        const shape = pick(SHAPE_POOL, seed >>> 7)
        const mark = pick(MARK_POOL, seed >>> 11)
        const tail = (seed % 9000) + 1000

        return {
          title: color + type,
          description:
            color +
            shape +
            type +
            "，整体保存完好，表面有一处" +
            mark +
            "（编号 " +
            tail +
            "）。照片共 " +
            imageUrls.length +
            " 张。",
        }
      },

      /**
       * 规则必须确定且可解释，否则离线测试没法断言「建议补拍」这条分支：
       * 只有 1 张 → 建议再拍一张；2 张及以上 → 通过。
       */
      async review({ imageUrls }): Promise<PhotoAdvice> {
        await pace()
        if (imageUrls.length < 2) {
          return { ok: false, reason: "只有一张，换个角度再拍一张" }
        }
        return { ok: true, reason: "照片够清楚，可以直接用" }
      },
    },
  }
}
