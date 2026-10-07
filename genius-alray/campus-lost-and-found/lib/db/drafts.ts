import { toDbError, unwrap, unwrapMaybe } from "@/lib/db/types"
import { listMyUploads, type ImageUpload } from "@/lib/db/uploads"
import type { CustodyKind, DbClient } from "@/lib/types"

export type PublishDraft = {
  user_id: string
  title: string
  description: string
  custody: CustodyKind | null
  contact: string | null
  location_lat: number | null
  location_lng: number | null
  location_label: string | null
  created_at: string
  updated_at: string
}

/** 草稿的整体快照：客户端每次都提交完整一份，避免「哪些字段没传」的歧义 */
export type PublishDraftInput = {
  title: string
  description: string
  custody: CustodyKind | null
  contact: string
  locationLabel: string
  lat: number | null
  lng: number | null
}

const DRAFT_COLUMNS =
  "user_id, title, description, custody, contact, location_lat, location_lng, location_label, created_at, updated_at"

/**
 * 我的草稿。一个用户最多一份（`user_id` 是主键），所以这里不需要也不接受 id 参数。
 * RLS 只放行自己那一行，读不到就是「还没有草稿」。
 */
export async function getMyDraft(
  supabase: DbClient,
  userId: string
): Promise<PublishDraft | null> {
  return unwrapMaybe(
    await supabase
      .from("publish_drafts")
      .select(DRAFT_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle()
  )
}

/** 草稿里的照片（按 position 顺序）连同上传登记 */
export async function listDraftPhotos(
  supabase: DbClient,
  userId: string
): Promise<ImageUpload[]> {
  const links = unwrap(
    await supabase
      .from("publish_draft_images")
      .select("upload_id, position")
      .eq("user_id", userId)
      .order("position", { ascending: true })
  )
  return listMyUploads(
    supabase,
    links.map((link) => link.upload_id)
  )
}

/** 保存草稿的文本字段（可写不完整的内容，草稿本来就允许只填一半） */
export async function saveDraft(
  supabase: DbClient,
  input: PublishDraftInput
): Promise<void> {
  const result = await supabase.rpc("save_publish_draft", {
    p_title: input.title,
    p_description: input.description,
    p_custody: input.custody ?? undefined,
    p_contact: input.contact ? input.contact : undefined,
    p_location_lat: input.lat ?? undefined,
    p_location_lng: input.lng ?? undefined,
    p_location_label: input.locationLabel ? input.locationLabel : undefined,
  })
  if (result.error) throw toDbError(result.error)
}

/**
 * 从草稿里移除一张照片，返回它的存储路径 —— 调用方拿到路径后要把对象也删掉，
 * 这正是「不再留桶内孤儿」的那一步。
 */
export async function detachDraftPhoto(
  supabase: DbClient,
  uploadId: string
): Promise<string> {
  return unwrap(
    await supabase.rpc("detach_draft_photo", { p_upload_id: uploadId })
  )
}
