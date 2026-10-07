import { toDbError, unwrap } from "@/lib/db/types"
import type { DbClient } from "@/lib/types"

export type ImageUpload = {
  id: string
  uploader_id: string
  storage_path: string
  created_at: string
  consumed_at: string | null
}

const UPLOAD_COLUMNS = "id, uploader_id, storage_path, created_at, consumed_at"

/**
 * 登记一次上传。**只由 /api/upload 用 service_role 调用** —— 客户端对
 * image_uploads 没有任何写权限，storage_path 也就永远不经过客户端。
 */
export async function registerUpload(
  admin: DbClient,
  input: { id: string; uploaderId: string; storagePath: string }
): Promise<void> {
  const result = await admin.from("image_uploads").insert({
    id: input.id,
    uploader_id: input.uploaderId,
    storage_path: input.storagePath,
  })
  if (result.error) throw toDbError(result.error)
}

/**
 * 按传入顺序取「我名下」的上传登记。
 *
 * 归属由 RLS（uploader_id = auth.uid()）兜底：别人的 id 直接查不出来，
 * 所以这里不需要、也不应该再用路径前缀去猜归属 —— 这正是第 9 轮要拆掉的东西。
 * 查不到的 id 会被丢掉，由调用方比对数量判断「有没有混进不属于自己的照片」。
 */
export async function listMyUploads(
  supabase: DbClient,
  ids: string[]
): Promise<ImageUpload[]> {
  if (ids.length === 0) return []

  const rows = unwrap(
    await supabase.from("image_uploads").select(UPLOAD_COLUMNS).in("id", ids)
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is ImageUpload => row !== undefined)
}
