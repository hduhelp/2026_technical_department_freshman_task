import type { Database } from "@/lib/database.types"

export type DbClient = ReturnType<
  typeof import("@supabase/supabase-js").createClient<Database>
>

// ============================================================
// 领域枚举（与数据库保持一致）
// ============================================================
export type CustodyKind = Database["public"]["Enums"]["custody_kind"]
export type ItemStatus = Database["public"]["Enums"]["item_status"]

export const CUSTODY_LABEL: Record<CustodyKind, string> = {
  kept: "代为保管",
  in_place: "指定存放位置",
}

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  published: "寻找失主中",
  claimed: "已认领",
  withdrawn: "已撤单",
}

/**
 * 是否还在失物墙上。
 * 认领即归属：**已认领的物品仍然留在墙上**（带「已认领」标签），只有拾主撤单才消失。
 */
export function isOnWall(status: ItemStatus): boolean {
  return status !== "withdrawn"
}

// ============================================================
// 列表 / 详情用的公开字段（不含联系方式与位置）
// ============================================================
export type PublicItem = {
  id: string
  owner_id: string
  title: string
  description: string
  custody: CustodyKind
  status: ItemStatus
  created_at: string
  updated_at: string
  claimed_at: string | null
  withdrawn_at: string | null
}

export type ItemImage = {
  id: string
  found_item_id: string
  storage_path: string
  position: number
}

/** 列表页用的合并结果：物品 + 已签名的图片 URL */
export type ListedItem = PublicItem & {
  images: Array<{ path: string; url: string }>
}

/** 个人信息：注册时必填，手机号即账号（登录用手机号 + 密码） */
export type Profile = {
  id: string
  real_name: string
  phone: string
  created_at: string
  updated_at: string
}

export type Pickup = {
  id: string
  found_item_id: string
  picker_id: string
  picker_name: string
  picker_phone: string
  created_at: string
}

/** 领取后揭晓的联系方式或位置 */
export type RevealedContact = {
  custody: CustodyKind
  contact: string | null
  location_lat: number | null
  location_lng: number | null
  location_label: string | null
}

// ============================================================
// AI 适配层：简化后只保留「拍照 → 名称 + 描述」
// 出题、判分、标签、相似度匹配全部随答题/审核/寻物帖的取消而移除。
// ============================================================
export type VisionResult = {
  /** 物品名称，可直接展示 */
  title: string
  /** 物品描述，可直接展示（不含联系方式等隐私） */
  description: string
}

/** 拍完照片后 AI 对「当前这组照片」的可用性判断 */
export type PhotoAdvice = {
  /** true = 可以直接用；false = 建议补拍 */
  ok: boolean
  /** 一句话建议（≤30 字），直接展示给拍摄者 */
  reason: string
}

export interface VisionProvider {
  analyze(input: { imageUrls: string[] }): Promise<VisionResult>
  /**
   * 每拍完一张就给一次建议：这组照片能不能让失主认出物品。
   * 只是建议，不阻塞流程 —— 用户可以坚持用现有照片继续。
   */
  review(input: { imageUrls: string[] }): Promise<PhotoAdvice>
}

export type AiProviders = {
  vision: VisionProvider
}
