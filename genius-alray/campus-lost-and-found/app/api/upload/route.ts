import { toDbError } from "@/lib/db/types"
import { registerUpload } from "@/lib/db/uploads"
import {
  IMAGE_BUCKET,
  ImageValidationError,
  MAX_IMAGE_BYTES,
  assertImageMatchesDeclaredType,
  assertValidImage,
  buildStoragePath,
} from "@/lib/storage/validate"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient, getCurrentUser } from "@/lib/supabase/server"

// 唯一允许的 REST endpoint：Server Actions 默认请求体上限 1MB，
// 图片字节必须绕开它，因此单独提供 multipart 上传。
// 落库由发布 RPC publish_found_item 按 upload id 完成：这里只把对象写进私有桶，
// 并在 image_uploads 里登记一行 —— 客户端拿到的自始至终只有一个不透明 id。
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type UploadErrorCode =
  | "unauthorized"
  | "invalid_body"
  | "missing_file"
  | "file_too_large"
  | "unsupported_type"
  | "storage_error"
  | "draft_error"

function fail(status: number, code: UploadErrorCode, message: string) {
  return Response.json({ error: message, code }, { status })
}

export async function POST(request: Request) {
  // 1. 鉴权：不可信入口
  const user = await getCurrentUser()
  if (!user) return fail(401, "unauthorized", "请先登录")

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, "invalid_body", "请求体必须是 multipart/form-data")
  }

  const file = form.get("file")
  if (!(file instanceof File)) return fail(400, "missing_file", "缺少图片文件")

  // 2. 先校验声明：类型 + 2MB（张数上限由发布 RPC 按 app_config 把关）
  try {
    assertValidImage(file)
  } catch (error) {
    if (error instanceof ImageValidationError) {
      const tooLarge = file.size > MAX_IMAGE_BYTES
      return fail(
        tooLarge ? 413 : 415,
        tooLarge ? "file_too_large" : "unsupported_type",
        error.message
      )
    }
    throw error
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // 3. 再校验内容：声明的 MIME 必须与文件头魔数一致。
  //    只看 file.type 等于信任客户端随便写的字符串（桶的 allowed_mime_types 校验的
  //    也是这个声明值），任意字节都能被声明成 image/jpeg 存进来。
  try {
    assertImageMatchesDeclaredType(bytes, file.type)
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return fail(415, "unsupported_type", error.message)
    }
    throw error
  }

  // 4. 路径完全由服务端决定：{userId}/{uploadId}.{ext}，uploadId 就是登记行的主键
  const uploadId = crypto.randomUUID()
  const storagePath = buildStoragePath(user.id, uploadId, file.type)

  const admin = createAdminClient()
  const { error: uploadError } = await admin.storage
    .from(IMAGE_BUCKET)
    .upload(storagePath, bytes, { contentType: file.type, upsert: false })
  if (uploadError) return fail(500, "storage_error", "图片上传失败，请重试")

  try {
    await registerUpload(admin, {
      id: uploadId,
      uploaderId: user.id,
      storagePath,
    })
  } catch {
    // 对象进桶了但登记失败：删掉对象，别留下谁也引用不到的孤儿
    await admin.storage.from(IMAGE_BUCKET).remove([storagePath])
    return fail(500, "storage_error", "图片上传失败，请重试")
  }

  // 5. 立刻挂到草稿上：照片从落桶那一刻起就属于草稿，
  //    于是「从草稿移除照片」可以连对象一起删，不用事后去猜哪张是孤儿。
  const supabase = await createClient()
  const attached = await supabase.rpc("attach_draft_photo", {
    p_upload_id: uploadId,
  })
  if (attached.error) {
    // 挂不上（例如草稿已经满 max_photos）：登记行与对象一起回滚
    await admin.from("image_uploads").delete().eq("id", uploadId)
    await admin.storage.from(IMAGE_BUCKET).remove([storagePath])
    return fail(409, "draft_error", toDbError(attached.error).message)
  }

  return Response.json({ uploadId }, { status: 201 })
}
