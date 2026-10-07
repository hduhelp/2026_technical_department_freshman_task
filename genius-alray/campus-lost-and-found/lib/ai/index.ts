import { createAiSdkProviders } from "@/lib/ai/ai-sdk"
import { createMockProviders } from "@/lib/ai/mock"
import type { AiProviders } from "@/lib/types"

/**
 * AI 供应商工厂。
 *
 * 简化后整套 AI 能力只剩「拍照 → 物品名称 + 描述」，
 * 出题 / 判分 / 标签 / 相似度匹配都随答题、审核、寻物帖的取消而移除。
 * 因此环境变量里仍然只需要一个视觉多模态模型：AI_MODEL。
 *
 * - AI_PROVIDER=mock（默认）：完全确定性、零网络，供开发与自动化测试使用。
 * - AI_PROVIDER=ai-sdk：经 Vercel AI SDK 以 OpenAI 兼容协议接入真实模型。
 */
export function getAiProviders(): AiProviders {
  const provider = process.env.AI_PROVIDER ?? "mock"

  if (provider === "ai-sdk") {
    return createAiSdkProviders({
      baseUrl: process.env.AI_BASE_URL ?? "",
      apiKey: process.env.AI_API_KEY ?? "",
      model: process.env.AI_MODEL ?? "",
    })
  }

  return createMockProviders()
}
