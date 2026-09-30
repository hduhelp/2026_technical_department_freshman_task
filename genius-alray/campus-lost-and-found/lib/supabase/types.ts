/**
 * 类型入口。
 *
 * - database.types.ts 由 CLI 生成（supabase gen types typescript --project-id ...），不要手改；
 *   数据库结构变了就重新生成一次。
 * - 本文件把生成类型收敛成项目里使用的窄类型，保持对外名称稳定。
 */
import type { Database } from "./database.types"

export type { Database, Json } from "./database.types"

export type ItemKind = Database["public"]["Enums"]["item_kind"]
export type ItemStatus = Database["public"]["Enums"]["item_status"]

type PublicFunctions = Database["public"]["Functions"]

/** similar_items RPC 的一行 */
export type SimilarItemRow = PublicFunctions["similar_items"]["Returns"][number]

/** search_items RPC 的一行（带窗口函数算出的 total） */
export type ItemListRow = PublicFunctions["search_items"]["Returns"][number]

/** get_item RPC 的一行 */
export type ItemDetailRow = PublicFunctions["get_item"]["Returns"][number]

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
export type ItemRow = Database["public"]["Tables"]["items"]["Row"]
export type ItemContactRow =
  Database["public"]["Tables"]["item_contacts"]["Row"]
