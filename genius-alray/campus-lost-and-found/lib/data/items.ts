import type { SupabaseClient } from "@supabase/supabase-js"

import { PAGE_SIZE } from "@/lib/constants"
import type {
  Database,
  ItemDetailRow,
  ItemKind,
  ItemListRow,
  ItemStatus,
  SimilarItemRow,
} from "@/lib/supabase/types"
import type { ItemDraft } from "@/lib/validation"

/** 数据层统一收这个类型，服务端客户端与 service_role 客户端都能传进来。 */
export type DbClient = SupabaseClient<Database>

export type ListItemsParams = {
  q?: string
  kind?: ItemKind | null
  includeResolved?: boolean
  onlyUser?: string | null
  page?: number
}

export type ListItemsResult = {
  rows: ItemListRow[]
  total: number
  page: number
  pageCount: number
}

export async function listItems(
  sb: DbClient,
  params: ListItemsParams = {}
): Promise<ListItemsResult> {
  const page = Math.max(1, params.page ?? 1)
  const { data, error } = await sb.rpc("search_items", {
    p_q: params.q?.trim() ?? "",
    // 传 undefined 而不是 null：生成的类型把可空参数标成可选，
    // 省略即走函数里的 DEFAULT NULL，语义完全一致。
    p_kind: params.kind ?? undefined,
    p_include_resolved: params.includeResolved ?? false,
    p_only_user: params.onlyUser ?? undefined,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  })

  if (error) throw new Error("查询帖子列表失败：" + error.message)

  const rows = (data ?? []) as ItemListRow[]
  const total = rows[0]?.total ?? 0
  return {
    rows,
    total: Number(total),
    page,
    pageCount: Math.max(1, Math.ceil(Number(total) / PAGE_SIZE)),
  }
}

export async function getItem(
  sb: DbClient,
  id: string
): Promise<ItemDetailRow | null> {
  const { data, error } = await sb.rpc("get_item", { p_id: id })
  if (error) throw new Error("查询帖子详情失败：" + error.message)
  const rows = (data ?? []) as ItemDetailRow[]
  return rows[0] ?? null
}

/** 联系方式单独一张表、单独一条策略：未登录查不到任何行。 */
export async function getItemContact(
  sb: DbClient,
  id: string
): Promise<string | null> {
  const { data, error } = await sb
    .from("item_contacts")
    .select("contact")
    .eq("item_id", id)
    .maybeSingle()
  if (error) return null
  return data?.contact ?? null
}

export type SimilarInput = {
  kind: ItemKind
  title: string
  description?: string
  location?: string
  happenedAt?: string | null
}

/** 相似检测：丢失帖子匹配拾获帖子，反之亦然。 */
export async function findSimilarItems(
  sb: DbClient,
  input: SimilarInput
): Promise<SimilarItemRow[]> {
  const { data, error } = await sb.rpc("similar_items", {
    p_kind: input.kind,
    p_title: input.title.trim(),
    p_description: input.description?.trim() ?? "",
    p_location: input.location?.trim() ?? "",
    p_happened_at: input.happenedAt ?? undefined,
    p_limit: 5,
  })
  if (error) throw new Error("相似检测失败：" + error.message)
  return (data ?? []) as SimilarItemRow[]
}

export async function insertItem(
  sb: DbClient,
  userId: string,
  draft: ItemDraft
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const { data, error } = await sb
    .from("items")
    .insert({
      user_id: userId,
      kind: draft.kind,
      title: draft.title,
      description: draft.description,
      location: draft.location,
      happened_at: draft.happenedAt,
      image_path: draft.imagePath || null,
    })
    .select("id")
    .single()

  if (error || !data) {
    return { ok: false, message: "发布失败：" + (error?.message ?? "未知错误") }
  }

  if (draft.contact) {
    const { error: contactError } = await sb
      .from("item_contacts")
      .insert({ item_id: data.id, contact: draft.contact })
    if (contactError) {
      // 联系方式写失败不应该让整条帖子丢失，只记录日志
      console.error("[items] 联系方式写入失败", contactError.message)
    }
  }

  return { ok: true, id: data.id }
}

export async function setItemStatus(
  sb: DbClient,
  id: string,
  status: ItemStatus
): Promise<{ ok: true } | { ok: false; message: string }> {
  // RLS 的 UPDATE 策略同时带 USING 与 WITH CHECK，
  // 越权时不会报错，只是影响行数为 0，所以这里要检查返回的数据。
  const { data, error } = await sb
    .from("items")
    .update({
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("id")

  if (error) return { ok: false, message: "更新状态失败：" + error.message }
  if (!data || data.length === 0) {
    return { ok: false, message: "没有权限修改这条帖子" }
  }
  return { ok: true }
}
