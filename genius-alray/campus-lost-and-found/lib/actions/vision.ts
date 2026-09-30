"use server"

import { MISSING_CONFIG_MESSAGE } from "@/lib/env"
import { publicPhotoUrl } from "@/lib/storage"
import { tryCreateSupabaseServerClient } from "@/lib/supabase/server"
import { describePhoto } from "@/lib/vision"

export type DescribeActionResult =
  { ok: true; description: string } | { ok: false; message: string }

/** 照片已经先上传到 Storage，这里只接收对象路径，把公开 URL 交给视觉模型。 */
export async function describePhotoAction(
  formData: FormData
): Promise<DescribeActionResult> {
  const path = String(formData.get("image_path") ?? "").trim()
  if (!path) return { ok: false, message: "请先上传照片" }

  const supabase = await tryCreateSupabaseServerClient()
  if (!supabase) return { ok: false, message: MISSING_CONFIG_MESSAGE }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "请先登录后再使用 AI 生成描述" }

  // 只能对自己目录下的图片调用，避免替别人的图片花 token
  if (!path.startsWith(user.id + "/")) {
    return { ok: false, message: "图片路径不合法，请重新上传" }
  }

  const url = publicPhotoUrl(path)
  if (!url) return { ok: false, message: MISSING_CONFIG_MESSAGE }

  return describePhoto(url)
}
