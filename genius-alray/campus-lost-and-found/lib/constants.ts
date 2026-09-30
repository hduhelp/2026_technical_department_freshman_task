import type { ItemKind, ItemStatus } from "@/lib/supabase/types"

export const PAGE_SIZE = 12

export const KIND_LABELS: Record<ItemKind, string> = {
  lost: "丢失",
  found: "拾获",
}

export const STATUS_LABELS: Record<ItemStatus, string> = {
  open: "寻找中",
  resolved: "已找回",
}

/** 地点快捷选项，减少同一地点被写成不同字符串，提升相似匹配命中率。 */
export const LOCATION_SUGGESTIONS = [
  "图书馆",
  "食堂",
  "教学楼",
  "操场",
  "宿舍",
  "体育馆",
  "校门口",
  "快递点",
]

/** 允许上传的图片格式（与 DeepSeek 视觉接口支持的一致） */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 原图上限 10MB
export const MAX_COMPRESSED_EDGE = 1600 // 压缩后长边
export const COMPRESSED_QUALITY = 0.82
export const UPLOAD_BUCKET = "item-photos"

export const SITE_NAME = "校园失物招领"
