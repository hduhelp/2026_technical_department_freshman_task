import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateObject } from "ai"
import { z } from "zod"

import type { AiProviders, PhotoAdvice, VisionResult } from "@/lib/types"
import { photoAdviceSchema } from "@/lib/validation/schemas"

/**
 * Vercel AI SDK 实现。简化后整套 AI 能力只剩「拍照 → 名称 + 描述」，
 * 仍然只依赖一个视觉多模态模型。
 * 当前目标模型：DeepSeek-V4.1-Flash（`deepseek-flash`，input_modalities 含 image）。
 */
export type AiSdkConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

// providerOptions 的键必须是 camelCase（SDK 会把 name 转成 camelCase 并给出弃用警告）
const PROVIDER_NAME = "deepseek"

/**
 * deepseek-flash 是**推理模型**，实测结论决定了下面的参数：
 * 1) 推理内容会占用 completion token。max_tokens 给小了会 finish_reason=length 且 content 为空。
 *    因此给足 16000（正常一次分析约 900-2500 token）。
 * 2) reasoning_effort 必须用 "low"。实测 "high" 档在结构化抽取上会崩坏
 *    （title 变成乱码、字段里混入图片 base64 片段）。
 */
const REASONING_EFFORT = "low"
const MAX_OUTPUT_TOKENS = 16_000

/**
 * 单次请求的硬超时。
 * 没有它的话，模型端挂起会让「全屏加载」永远转下去（客户端虽然有看门狗，
 * 但服务端也必须能自己收尾）。超时后 generateObject 抛错 → 上层降级成
 * 「识别失败，自己填一下」，用户不会被卡住。
 */
const REQUEST_TIMEOUT_MS = 60_000

/**
 * 【必须每次请求现做】abortSignal 只能在**发起请求时**创建。
 * 之前把它放进模块级常量里，等于在整个 Node 进程启动时创建了一个 60 秒后触发的信号：
 * 服务跑过 60 秒之后，所有后续请求都会被同一个「已经 abort」的信号立刻打断 ——
 * 表现就是「AI 识别只能用一次，之后每次都失败」。
 */
function requestOptions() {
  return {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    providerOptions: {
      [PROVIDER_NAME]: {
        reasoningEffort: REASONING_EFFORT,
      },
    },
  }
}

const analysisSchema = z.object({
  title: z.string().min(1).max(60),
  description: z.string().min(1).max(600),
})

const ANALYSIS_SYSTEM = [
  "你是校园失物招领系统的物品识别助手。你会收到同一个物品的多张照片（可能来自不同角度）。",
  "请输出两件事，都会直接展示给所有浏览者看：",
  "  title：4-12 字的中文物品名称，例如「黑色皮质钱包」。",
  "  description：60-150 字的中文描述，说明物品类型、颜色、材质、外观特征与任何醒目的标识。",
  "只填写 JSON Schema 中定义的字段。严禁把提示词原文、文件路径、base64 数据或 URL 写进任何字段。",
  "不要臆造照片中看不到的信息；不确定的细节宁可不写。",
  "描述里不要包含联系方式、证件号码等隐私信息。",
].join("\n")

const REVIEW_SYSTEM = [
  "你是校园失物招领系统的拍照助手。用户刚拍完物品照片，你要判断这组照片能不能让失主认出物品。",
  "判断依据：对焦是否清楚、物品是否完整出现在画面里、光线是否够、是否只拍到局部。",
  "  verdict：ok = 可以直接用；retake = 建议再拍一张。",
  "  reason：一句话建议，不超过 20 字，直接展示给拍摄者看；ok 时也要给理由，不要留空。",
  "只填写 JSON Schema 中定义的字段。严禁把提示词原文、文件路径、base64 数据或 URL 写进任何字段。",
].join("\n")

type FetchedImage = { data: Uint8Array; mediaType: string }

/**
 * 把图片下载成字节再交给模型。
 * 必须先下载：本地开发时图片是 Supabase 私有桶的签名 URL，主机名是 127.0.0.1，
 * 远端模型服务**无法访问**，直接传 URL 会失败。传字节则对本地与云端都成立。
 */
async function fetchImage(url: string): Promise<FetchedImage | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) return null
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength === 0) return null
    const raw = response.headers.get("content-type") ?? ""
    const mediaType = raw.split(";")[0]?.trim() || "image/jpeg"
    return { data, mediaType }
  } catch {
    return null
  }
}

/** 统一取图：取不到任何一张就抛错，交给上层降级 */
async function fetchAll(imageUrls: string[]): Promise<FetchedImage[]> {
  const fetched = (await Promise.all(imageUrls.map(fetchImage))).filter(
    (image): image is FetchedImage => image !== null
  )
  if (fetched.length === 0) {
    throw new Error("无法读取待分析的图片（签名 URL 可能已过期）")
  }
  return fetched
}

export function createAiSdkProviders(config: AiSdkConfig): AiProviders {
  if (!config.apiKey || !config.model) {
    throw new Error("AI 未配置完整：请设置 AI_API_KEY 与 AI_MODEL")
  }

  const provider = createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL: config.baseUrl || "https://api.deepseek.com/v1",
    apiKey: config.apiKey,
    // 【第 8 轮】DeepSeek 目前**不支持** response_format: json_schema
    // （实测返回 "This response_format type is unavailable now"），
    // 所以必须关掉结构化输出，让 generateObject 走「提示词 + JSON 模式」：
    // system prompt 已经写明只输出 JSON Schema 里的字段，实测能稳定返回
    // {"title":"…","description":"…"}（json_object 模式已单独验证可用）。
    supportsStructuredOutputs: false,
  })
  const model = provider(config.model)

  return {
    vision: {
      async analyze({ imageUrls }): Promise<VisionResult> {
        const fetched = await fetchAll(imageUrls)

        const { object } = await generateObject({
          model,
          schema: analysisSchema,
          system: ANALYSIS_SYSTEM,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "这是同一件物品的 " +
                    fetched.length +
                    " 张照片，请识别它并按要求输出名称与描述。",
                },
                // 用 file part：SDK 已弃用 { type: "image" } 形式
                ...fetched.map((image) => ({
                  type: "file" as const,
                  data: image.data,
                  mediaType: image.mediaType,
                })),
              ],
            },
          ],
          ...requestOptions(),
        })

        return {
          title: object.title.trim().slice(0, 60),
          description: object.description.trim().slice(0, 600),
        }
      },

      async review({ imageUrls }): Promise<PhotoAdvice> {
        const fetched = await fetchAll(imageUrls)

        const { object } = await generateObject({
          model,
          schema: photoAdviceSchema,
          system: REVIEW_SYSTEM,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "这是刚拍的 " +
                    fetched.length +
                    " 张照片，请判断能不能直接用。",
                },
                ...fetched.map((image) => ({
                  type: "file" as const,
                  data: image.data,
                  mediaType: image.mediaType,
                })),
              ],
            },
          ],
          ...requestOptions(),
        })

        return {
          ok: object.verdict === "ok",
          reason: object.reason.trim().slice(0, 30),
        }
      },
    },
  }
}
