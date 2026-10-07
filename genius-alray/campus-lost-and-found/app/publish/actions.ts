"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getAiProviders } from "@/lib/ai"
import { consumeAiQuota, type AiQuota } from "@/lib/db/ai-usage"
import {
  detachDraftPhoto,
  saveDraft,
  type PublishDraftInput,
} from "@/lib/db/drafts"
import { publishItem } from "@/lib/db/found-items"
import { listMyUploads } from "@/lib/db/uploads"
import { createSignedUrlMap } from "@/lib/storage/signed"
import { IMAGE_BUCKET } from "@/lib/storage/validate"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import type { DbClient, PhotoAdvice, VisionResult } from "@/lib/types"
import { publishDraftSchema, publishItemSchema } from "@/lib/validation/schemas"

// ============================================================
// 发布招领的 Server Actions（单页流程，无草稿）
// 每个 action 都是不可信入口：先 getCurrentUser() 鉴权，再 zod 校验。
// 照片一律用 upload id 引用，归属由 image_uploads 的 RLS 判定 —— 不再有
// 「客户端传路径、服务端比对前缀」这种脆弱写法。
// ============================================================

export type AnalyzeResult =
  | { ok: true; result: VisionResult }
  | { ok: false; error: string; quotaExceeded: boolean }

export type ReviewResult =
  | { ok: true; advice: PhotoAdvice }
  | { ok: false; error: string; quotaExceeded: boolean }

export type PublishResult =
  | { ok: true; itemId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export type PublishInput = z.infer<typeof publishItemSchema>

/** 识别用：允许一批最多 20 个 upload id，真正的张数上限由发布 RPC 按 app_config 把关 */
const analyzeUploadsSchema = z
  .array(z.string().uuid("照片参数不合法"))
  .min(1, "请至少上传一张照片")
  .max(20, "照片数量过多")

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return "操作失败，请重试"
}

type AuthorizedUploads =
  | { ok: true; supabase: DbClient; paths: string[] }
  | { ok: false; error: string }

/**
 * 识别与建议共用的入场逻辑：鉴权 → zod 校验 → 取回「自己名下」的上传登记。
 *
 * 归属完全由 image_uploads 的 RLS（uploader_id = auth.uid()）决定：
 * 别人的 id 查不出来，与「id 不存在」表现完全一致，也就不是一个可探测的接口。
 */
async function authorizeUploads(
  uploadIds: string[]
): Promise<AuthorizedUploads> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "登录已过期，请重新登录" }

  const parsed = analyzeUploadsSchema.safeParse(uploadIds)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "照片参数不合法",
    }
  }

  const supabase = await createClient()
  const uploads = await listMyUploads(supabase, parsed.data)
  if (uploads.length !== parsed.data.length) {
    return { ok: false, error: "照片不存在或不属于当前账号，请重新上传" }
  }

  return {
    ok: true,
    supabase,
    paths: uploads.map((upload) => upload.storage_path),
  }
}

/** 私有桶签名：按 path 顺序返回可用 URL，签不出来的 path 直接丢掉 */
async function signedImageUrls(paths: string[]): Promise<string[]> {
  const urlMap = await createSignedUrlMap(paths)
  return paths
    .map((path) => urlMap[path])
    .filter((url): url is string => Boolean(url))
}

/**
 * 取一次 AI 配额。RPC 自身出错时返回 null —— 调用方按「AI 不可用」降级，
 * 而不是放行。宁可少用一次，也不要让计数在异常路径上失守。
 */
async function takeAiQuota(supabase: DbClient): Promise<AiQuota | null> {
  try {
    return await consumeAiQuota(supabase)
  } catch {
    return null
  }
}

function quotaMessage(quota: AiQuota): string {
  return (
    "AI 识别已达上限（每小时 " + quota.limit + " 次），请手动填写名称与描述"
  )
}

// ============================================================
// 1. 识别：签名 URL → 视觉模型 → 名称 + 描述
// ============================================================
export async function analyzeItemAction(
  uploadIds: string[]
): Promise<AnalyzeResult> {
  const auth = await authorizeUploads(uploadIds)
  if (!auth.ok) return { ok: false, error: auth.error, quotaExceeded: false }

  // 先签名再扣配额：读不出照片属于基础设施故障，不该烧掉用户的次数
  let imageUrls: string[]
  try {
    imageUrls = await signedImageUrls(auth.paths)
  } catch {
    return {
      ok: false,
      error: "照片读取失败，请重新上传后再试",
      quotaExceeded: false,
    }
  }
  if (imageUrls.length === 0) {
    return {
      ok: false,
      error: "照片读取失败，请重新上传后再试",
      quotaExceeded: false,
    }
  }

  const quota = await takeAiQuota(auth.supabase)
  if (quota === null) {
    return {
      ok: false,
      error: "AI 识别暂时不可用，请手动填写名称与描述",
      quotaExceeded: false,
    }
  }
  if (!quota.allowed) {
    return { ok: false, error: quotaMessage(quota), quotaExceeded: true }
  }

  try {
    const raw = await getAiProviders().vision.analyze({ imageUrls })
    const title =
      typeof raw?.title === "string" ? raw.title.trim().slice(0, 60) : ""
    const description =
      typeof raw?.description === "string"
        ? raw.description.trim().slice(0, 600)
        : ""

    if (!title && !description) {
      return {
        ok: false,
        error: "识别结果为空，请手动填写名称与描述",
        quotaExceeded: false,
      }
    }
    return { ok: true, result: { title, description } }
  } catch {
    // 识别失败不阻塞发布：用户可以手填名称与描述
    return {
      ok: false,
      error: "识别失败，请手动填写名称与描述后发布",
      quotaExceeded: false,
    }
  }
}

// ============================================================
// 1.5 建议：同一组照片，AI 判断能不能直接用（只是建议，不阻塞发布）
//     任何失败都返回 { ok: false }，UI 侧静默降级为「没有建议」。
// ============================================================
export async function reviewPhotosAction(
  uploadIds: string[]
): Promise<ReviewResult> {
  const auth = await authorizeUploads(uploadIds)
  if (!auth.ok) return { ok: false, error: auth.error, quotaExceeded: false }

  let imageUrls: string[]
  try {
    imageUrls = await signedImageUrls(auth.paths)
  } catch {
    return {
      ok: false,
      error: "照片读取失败，请重新上传后再试",
      quotaExceeded: false,
    }
  }
  if (imageUrls.length === 0) {
    return {
      ok: false,
      error: "照片读取失败，请重新上传后再试",
      quotaExceeded: false,
    }
  }

  const quota = await takeAiQuota(auth.supabase)
  if (quota === null) {
    return { ok: false, error: "AI 建议暂时不可用", quotaExceeded: false }
  }
  if (!quota.allowed) {
    return { ok: false, error: quotaMessage(quota), quotaExceeded: true }
  }

  try {
    const advice = await getAiProviders().vision.review({ imageUrls })
    return {
      ok: true,
      advice: {
        ok: advice.ok === true,
        reason: advice.reason.trim().slice(0, 30),
      },
    }
  } catch {
    return { ok: false, error: "AI 建议暂时不可用", quotaExceeded: false }
  }
}

// ============================================================
// 2. 发布：zod 校验 → publish_found_item RPC（照片按 upload id 引用）
// ============================================================
export async function publishItemAction(
  input: PublishInput
): Promise<PublishResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "登录已过期，请重新登录" }

  const parsed = publishItemSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "form"
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "请检查填写内容",
      fieldErrors,
    }
  }

  const data = parsed.data

  try {
    const supabase = await createClient()
    const itemId = await publishItem(supabase, {
      title: data.title,
      description: data.description,
      custody: data.custody,
      contact: data.contact,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      locationLabel: data.locationLabel,
      uploadIds: data.uploadIds,
    })

    revalidatePath("/")
    revalidatePath("/me")
    return { ok: true, itemId }
  } catch (error) {
    return { ok: false, error: toMessage(error) }
  }
}

// ============================================================
// 3. 草稿
//    每个用户只有一份（数据库层用 user_id 主键保证），所以这里没有任何
//    「草稿 id」参数 —— 发布页永远操作自己那唯一一份。
// ============================================================
export type SaveDraftResult = { ok: true } | { ok: false; error: string }

/** 保存草稿（整体覆盖）：客户端在每次离开一步时提交当前快照 */
export async function saveDraftAction(
  input: PublishDraftInput
): Promise<SaveDraftResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "登录已过期，请重新登录" }

  const parsed = publishDraftSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "草稿保存失败",
    }
  }

  try {
    const supabase = await createClient()
    await saveDraft(supabase, parsed.data)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: toMessage(error) }
  }
}

/**
 * 从草稿里移除一张照片 —— **连存储对象一起删**。
 *
 * 这就是「不再留桶内孤儿」落地的地方：RPC 删掉登记行并把存储路径交回来，
 * 这里再用 service_role 把对象删掉。
 */
export async function removeDraftPhotoAction(
  uploadId: string
): Promise<SaveDraftResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "登录已过期，请重新登录" }

  const parsed = z.string().uuid().safeParse(uploadId)
  if (!parsed.success) return { ok: false, error: "参数不合法" }

  try {
    const supabase = await createClient()
    const storagePath = await detachDraftPhoto(supabase, parsed.data)

    // 登记行已经删了；对象删失败只影响占用空间，不影响正确性，所以不往上抛
    const admin = createAdminClient()
    await admin.storage.from(IMAGE_BUCKET).remove([storagePath])

    return { ok: true }
  } catch (error) {
    return { ok: false, error: toMessage(error) }
  }
}
