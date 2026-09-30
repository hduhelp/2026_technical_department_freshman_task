// 视觉模型契约验证：真实图片 → Supabase Storage 公开 URL → DeepSeek → 中文描述。
// 用法：node scripts/verify-vision.mjs [图片 URL 或本地路径]
// 需要 .env.local 里的 Supabase 配置与 DEEPSEEK_API_KEY。

import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"

import { createClient } from "@supabase/supabase-js"

function loadEnv(path = ".env.local") {
  const result = {}
  let raw = ""
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    console.error("找不到 " + path)
    process.exit(1)
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

const env = loadEnv()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const apiKey = env.DEEPSEEK_API_KEY
const baseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "")
const model = env.DEEPSEEK_VISION_MODEL || "deepseek-flash"

if (!url || !serviceKey || !apiKey) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DEEPSEEK_API_KEY")
  process.exit(1)
}

// 默认用一张 Wikimedia 上的实物照片；也可以传自己的图片 URL 或本地路径
const DEFAULT_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Umbrella_-_closed.jpg/640px-Umbrella_-_closed.jpg"

const source = process.argv[2] || DEFAULT_IMAGE

async function loadImage(target) {
  if (/^https?:\/\//.test(target)) {
    const response = await fetch(target)
    if (!response.ok) throw new Error("下载测试图片失败：" + response.status)
    const type = response.headers.get("content-type") || "image/jpeg"
    return { buffer: Buffer.from(await response.arrayBuffer()), type }
  }
  return { buffer: readFileSync(target), type: "image/jpeg" }
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  console.log("\n图片源：" + source)
  const image = await loadImage(source)
  console.log("图片大小：" + Math.round(image.buffer.length / 1024) + " KB")

  const path = "vision-check/" + randomUUID() + ".jpg"
  const { error: uploadError } = await admin.storage
    .from("item-photos")
    .upload(path, image.buffer, { contentType: image.type, upsert: false })
  if (uploadError) throw new Error("上传测试图失败：" + uploadError.message)

  const publicUrl =
    url.replace(/\/+$/, "") + "/storage/v1/object/public/item-photos/" + path
  const probe = await fetch(publicUrl)
  console.log("公开 URL 状态：" + probe.status)
  if (!probe.ok) throw new Error("公开 URL 不可访问，DeepSeek 也拿不到图")

  try {
    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "请用简体中文一句话描述这张照片里的物品，50 到 90 个字，只描述物品本身。",
              },
              { type: "image_url", image_url: { url: publicUrl, detail: "low" } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!response.ok) {
      throw new Error(
        "DeepSeek 返回 " + response.status + "：" + (await response.text()).slice(0, 300)
      )
    }

    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content?.trim()

    console.log("\n模型（" + model + "）返回：\n" + (text || "(空)"))
    const hasChinese = /[\u4e00-\u9fa5]/.test(text ?? "")
    if (!text || !hasChinese) {
      console.error("\n✗ 期望非空的中文描述")
      process.exitCode = 1
    } else {
      console.log("\n✓ 视觉模型契约验证通过（长度 " + text.length + "）")
    }
  } finally {
    await admin.storage.from("item-photos").remove([path])
  }
}

main().catch((error) => {
  console.error("\n脚本异常：" + (error?.stack ?? error))
  process.exit(1)
})
