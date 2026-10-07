import type { ListedItem, RevealedContact } from "@/lib/types"

/** 「加载更多」的结果 */
export type LoadMoreResult =
  | { ok: true; items: ListedItem[]; hasMore: boolean }
  | { ok: false; error: string }

/** 只需要「成功/失败 + 一句话」的操作结果 */
export type SimpleResult =
  { ok: true; message: string } | { ok: false; message: string }

/** 提交认领信息后的结果：成功即携带已揭晓的联系方式或位置 */
export type PickupResult =
  { ok: true; revealed: RevealedContact | null } | { ok: false; error: string }
