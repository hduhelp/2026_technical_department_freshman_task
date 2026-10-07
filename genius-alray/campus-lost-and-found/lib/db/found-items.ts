import type {
  DbClient,
  ListedItem,
  PublicItem,
  RevealedContact,
} from "@/lib/types"
import { unwrap, unwrapMaybe } from "@/lib/db/types"

const PUBLIC_COLUMNS =
  "id, owner_id, title, description, custody, status, created_at, updated_at, claimed_at, withdrawn_at"

/**
 * 失物墙列表：未撤单的全部物品（**含已认领**，带标签展示）。
 * contact / location_* 在列级被 REVOKE，这里拿不到。
 */
export async function listWallItems(
  supabase: DbClient,
  options: { limit: number; offset: number }
): Promise<PublicItem[]> {
  return unwrap(
    await supabase
      .from("found_items")
      .select(PUBLIC_COLUMNS)
      .in("status", ["published", "claimed"])
      .order("created_at", { ascending: false })
      .range(options.offset, options.offset + options.limit - 1)
  )
}

export async function countWallItems(supabase: DbClient): Promise<number> {
  const result = await supabase
    .from("found_items")
    .select("id", { count: "exact", head: true })
    .in("status", ["published", "claimed"])
  if (result.error) return 0
  return result.count ?? 0
}

export async function getItem(
  supabase: DbClient,
  itemId: string
): Promise<PublicItem | null> {
  return unwrapMaybe(
    await supabase
      .from("found_items")
      .select(PUBLIC_COLUMNS)
      .eq("id", itemId)
      .maybeSingle()
  )
}

/** 为一组物品取图片（RLS 允许读未撤单物品的图片） */
export async function listImagesForItems(
  supabase: DbClient,
  itemIds: string[]
): Promise<
  Array<{
    id: string
    found_item_id: string
    storage_path: string
    position: number
  }>
> {
  if (itemIds.length === 0) return []
  return unwrap(
    await supabase
      .from("found_item_images")
      .select("id, found_item_id, storage_path, position")
      .in("found_item_id", itemIds)
      .order("position", { ascending: true })
  )
}

/**
 * 我的发布：自己发布且**未被撤单**的物品（含已认领）。
 * 撤单后卡片会从这个列表里消失（UI 上还有一次淡出反馈），
 * 与「撤单 = 从我的发布里撤回」的直觉一致。
 * 【必须显式过滤 owner_id】RLS 是「未撤单全体可读 或 owner_id = 我」，
 * 不加过滤会返回**所有人的**物品 —— 这里曾经踩过。
 */
export async function listMyItems(
  supabase: DbClient,
  ownerId: string
): Promise<PublicItem[]> {
  return unwrap(
    await supabase
      .from("found_items")
      .select(PUBLIC_COLUMNS)
      .eq("owner_id", ownerId)
      .in("status", ["published", "claimed"])
      .order("created_at", { ascending: false })
  )
}

/** 把物品与已签名图片合并成列表项 */
export function mergeImages(
  items: PublicItem[],
  images: Array<{ found_item_id: string; storage_path: string }>,
  urlByPath: Record<string, string>
): ListedItem[] {
  return items.map((item) => ({
    ...item,
    images: images
      .filter((image) => image.found_item_id === item.id)
      .map((image) => ({
        path: image.storage_path,
        url: urlByPath[image.storage_path] ?? "",
      })),
  }))
}

export async function publishItem(
  supabase: DbClient,
  input: {
    title: string
    description: string
    custody: "kept" | "in_place"
    contact: string
    lat: number | null
    lng: number | null
    locationLabel: string
    /** image_uploads.id 列表：照片归属由 RPC 按登记行校验，不再传路径 */
    uploadIds: string[]
  }
): Promise<string> {
  return unwrap(
    await supabase.rpc("publish_found_item", {
      p_title: input.title,
      p_description: input.description,
      p_custody: input.custody,
      p_contact: input.contact ? input.contact : undefined,
      p_location_lat: input.lat ?? undefined,
      p_location_lng: input.lng ?? undefined,
      p_location_label: input.locationLabel ? input.locationLabel : undefined,
      p_upload_ids: input.uploadIds,
    })
  )
}

/** 拾主撤单：只有在还没被认领时才能成功（数据库侧强制） */
export async function withdrawItem(supabase: DbClient, itemId: string) {
  return unwrap(
    await supabase.rpc("withdraw_found_item", { p_item_id: itemId })
  )
}

/** 揭晓联系方式或位置：仅拾主本人或已认领的人能拿到 */
export async function revealContact(
  supabase: DbClient,
  itemId: string
): Promise<RevealedContact | null> {
  const rows = unwrap(
    await supabase.rpc("reveal_found_item_contact", { p_item_id: itemId })
  )
  const row = rows[0]
  if (!row) return null
  return {
    custody: row.out_custody,
    contact: row.out_contact,
    location_lat: row.out_location_lat,
    location_lng: row.out_location_lng,
    location_label: row.out_location_label,
  }
}

export async function getAppConfig(supabase: DbClient) {
  const rows = unwrap(await supabase.rpc("get_app_config", {}))
  return rows[0] ?? null
}
