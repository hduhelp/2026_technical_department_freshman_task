import { NextResponse } from "next/server"

import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_BUCKET,
} from "@/lib/constants"
import { MISSING_CONFIG_MESSAGE } from "@/lib/env"
import { publicPhotoUrl } from "@/lib/storage"
import { tryCreateSupabaseServerClient } from "@/lib/supabase/server"

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status })
}

/**
 * 照片上传。这是全项目唯一保留的 API Route：
 * 先把图片落到 Storage，后续的「AI 生成描述」和「发布」都只传对象路径，
 * 于是 Server Action 永远不会收到大 body。
 * 用的是用户态客户端，所以 Storage 的 RLS（只能写自己目录）照样生效。
 */
export async function POST(request: Request) {
  const supabase = await tryCreateSupabaseServerClient()
  if (!supabase) return fail(MISSING_CONFIG_MESSAGE, 500)

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail("请先登录后再上传照片", 401)

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return fail("上传内容解析失败，请重试", 400)
  }

  const file = formData.get("file")
  if (!(file instanceof File)) return fail("没有收到图片文件", 400)

  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return fail("只支持 JPEG / PNG / WebP / GIF 格式的图片", 400)
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(
      "图片太大（超过 " + Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + "MB）",
      400
    )
  }

  const extension = EXTENSIONS[file.type] ?? "jpg"
  const path = user.id + "/" + crypto.randomUUID() + "." + extension

  const { error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
    })

  if (error) {
    console.error("[upload] Storage 上传失败", error.message)
    return fail("上传失败，请稍后重试", 500)
  }

  return NextResponse.json({ ok: true, path, url: publicPhotoUrl(path) })
}
