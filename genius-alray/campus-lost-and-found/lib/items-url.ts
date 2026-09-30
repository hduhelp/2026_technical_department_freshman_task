import type { ItemKind } from "@/lib/supabase/types"

export type ItemsQuery = {
  q: string
  kind: ItemKind | null
  page: number
  includeResolved: boolean
  mine: boolean
}

export const DEFAULT_ITEMS_QUERY: ItemsQuery = {
  q: "",
  kind: null,
  page: 1,
  includeResolved: false,
  mine: false,
}

export type RawSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ""
  return value ?? ""
}

/** 搜索、筛选、分页全部走 URL，服务端渲染即可，不需要客户端状态。 */
export function parseItemsQuery(params: RawSearchParams): ItemsQuery {
  const q = first(params.q).trim().slice(0, 60)
  const kindRaw = first(params.kind)
  const kind: ItemKind | null =
    kindRaw === "lost" || kindRaw === "found" ? kindRaw : null

  const pageRaw = Number.parseInt(first(params.page), 10)
  const page =
    Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 100) : 1

  return {
    q,
    kind,
    page,
    includeResolved: first(params.resolved) === "1",
    mine: first(params.mine) === "1",
  }
}

/** 只把「非默认值」写进 query，保持链接干净、可分享。 */
export function toItemsHref(
  query: Partial<ItemsQuery>,
  base: ItemsQuery = DEFAULT_ITEMS_QUERY
): string {
  const merged: ItemsQuery = { ...base, ...query }
  const params = new URLSearchParams()
  if (merged.q) params.set("q", merged.q)
  if (merged.kind) params.set("kind", merged.kind)
  if (merged.page > 1) params.set("page", String(merged.page))
  if (merged.includeResolved) params.set("resolved", "1")
  if (merged.mine) params.set("mine", "1")
  const search = params.toString()
  return search ? "/items?" + search : "/items"
}
