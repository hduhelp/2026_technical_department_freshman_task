import "server-only"

import { deepseekConfig } from "@/lib/env"

export type DescribeResult =
  { ok: true; description: string } | { ok: false; message: string }

const PROMPT = [
  "你是校园失物招领平台的助手。请用简体中文描述这张物品照片，供失主辨认。",
  "要求：",
  "1. 只描述照片中确实能看到的信息，不要臆造品牌、人名或地点。",
  "2. 依次说明：这是什么物品、颜色、材质或外观特征、任何可见的文字或标识、明显磨损或配件。",
  "3. 50 到 90 个字，一段话，不要分点，不要加标题。",
  "4. 不要出现「这张图片」「照片中」这类措辞，直接描述物品本身。",
].join("\n")

const TIMEOUT_MS = 30_000

/**
 * 调用 DeepSeek 的视觉模型生成中文描述。
 * 传公开可访问的图片 URL，由 DeepSeek 侧下载（单图上限 32MiB、60 秒内下完）。
 * 注意：图片只能出现在 user 消息里，放进 system/assistant 会返回 400。
 */
export async function describePhoto(imageUrl: string): Promise<DescribeResult> {
  const config = deepseekConfig()
  if (!config) {
    return { ok: false, message: "尚未配置视觉模型（缺少 DEEPSEEK_API_KEY）" }
  }

  let response: Response
  try {
    response = await fetch(config.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              // detail: low 会先把图缩到 512x512，够用来描述物品且更省 token
              {
                type: "image_url",
                image_url: { url: imageUrl, detail: "low" },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ""
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, message: "视觉模型响应超时，请稍后重试" }
    }
    return { ok: false, message: "无法连接视觉模型服务，请稍后重试" }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    console.error(
      "[vision] DeepSeek 返回错误",
      response.status,
      detail.slice(0, 500)
    )
    return {
      ok: false,
      message: "视觉模型调用失败（HTTP " + response.status + "），请稍后重试",
    }
  }

  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null } }[]
  } | null

  const text = payload?.choices?.[0]?.message?.content?.trim()
  if (!text) {
    return { ok: false, message: "视觉模型没有返回内容，请重试或手动填写描述" }
  }

  return {
    ok: true,
    description: text.replace(/^["「『]|[」』"]$/g, "").trim(),
  }
}
