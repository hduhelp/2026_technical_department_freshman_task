import { createAdminClient, IMAGE_BUCKET, PNG_BYTES } from "./supabase"
import type { TestContext, TestUser } from "./supabase"
import { publishItem as dbPublishItem } from "@/lib/db/found-items"

// ============================================================
// 简化版模型的测试夹具
//   found_items / found_item_images / pickups 对客户端只有 SELECT，
//   写入一律走 SECURITY DEFINER RPC，因此夹具也走真实 RPC（不是 admin 直插），
//   这样测到的就是产品代码实际会走的路径。
//
// 第 9 轮起照片不再用「路径」引用：归属是 image_uploads 表里的一行。
// 夹具先用 service_role 造登记行（与 /api/upload 落库那一步等价），再拿 id 去发布。
// ============================================================

export const DEFAULT_CONTACT = "13800138000"
export const DEFAULT_TITLE = "测试物品"
export const DEFAULT_DESCRIPTION =
  "这是一段测试用的物品描述，长度满足 1-600 字要求。"

export type UploadSeed = { id: string; path: string }

/**
 * 造一条上传登记（等价于 /api/upload 成功之后落下的那一行）。
 * 可指定 storage_path，便于和 uploadObject 造的真实对象对上。
 */
export async function createUpload(
  uploaderId: string,
  options: { path?: string; consumed?: boolean } = {}
): Promise<UploadSeed> {
  const admin = createAdminClient()
  const id = crypto.randomUUID()
  const path = options.path ?? uploaderId + "/" + id + ".jpg"
  const result = await admin.from("image_uploads").insert({
    id,
    uploader_id: uploaderId,
    storage_path: path,
    consumed_at: options.consumed ? new Date().toISOString() : null,
  })
  if (result.error) {
    throw new Error("造上传登记失败：" + result.error.message)
  }
  return { id, path }
}

/** 批量造登记（顺序稳定，便于断言 position 与 storage_path 的对应关系） */
export async function createUploads(
  uploaderId: string,
  count: number
): Promise<UploadSeed[]> {
  return Promise.all(
    Array.from({ length: count }, () => createUpload(uploaderId))
  )
}

/** 用指定的 storage_path 批量造登记（E2E 里配合真实对象使用） */
export async function createUploadsForPaths(
  uploaderId: string,
  paths: string[]
): Promise<UploadSeed[]> {
  const seeds: UploadSeed[] = []
  for (const path of paths) {
    seeds.push(await createUpload(uploaderId, { path }))
  }
  return seeds
}

export type PublishOptions = {
  title?: string
  description?: string
  custody?: "kept" | "in_place"
  contact?: string
  lat?: number | null
  lng?: number | null
  locationLabel?: string
  /** 直接指定 upload id（用于「别人的照片」「不存在的照片」等用例） */
  uploadIds?: string[]
  /** 未指定 uploadIds 时造几条登记（默认 1；传 0 用于「没有照片」） */
  photoCount?: number
}

export type PublishedItem = {
  id: string
  title: string
  description: string
  uploadIds: string[]
}

type RpcResult<T> = {
  data: T | null
  error: { code?: string; message: string } | null
}

/** 走 publish_found_item RPC 发布一个物品 */
export async function publishItem(
  owner: TestUser,
  options: PublishOptions = {}
): Promise<PublishedItem> {
  const custody = options.custody ?? "kept"
  const title = options.title ?? DEFAULT_TITLE
  const description = options.description ?? DEFAULT_DESCRIPTION
  const uploadIds =
    options.uploadIds ??
    (await createUploads(owner.id, options.photoCount ?? 1)).map(
      (upload) => upload.id
    )

  // 走产品自己的封装（lib/db/found-items.ts）而不是手写 RPC 参数：
  // 这样 PostgREST 的函数匹配语义（参数是否有 DEFAULT）一旦漂移，测试会直接失败。
  const id = await dbPublishItem(owner.client, {
    title,
    description,
    custody,
    contact: custody === "kept" ? (options.contact ?? DEFAULT_CONTACT) : "",
    lat: options.lat ?? null,
    lng: options.lng ?? null,
    locationLabel: options.locationLabel ?? "",
    uploadIds,
  })

  return { id, title, description, uploadIds }
}

/** 直接调用 publish RPC 并返回原始结果（用于断言错误码） */
export async function publishItemRaw(
  owner: TestUser,
  input: {
    title: string
    description: string
    custody: "kept" | "in_place"
    contact?: string
    lat?: number
    lng?: number
    locationLabel?: string
    /** 不传就按 photoCount 造登记；传了就按给定的 id 引用 */
    uploadIds?: string[]
    photoCount?: number
  }
): Promise<RpcResult<string>> {
  const uploadIds =
    input.uploadIds ??
    (await createUploads(owner.id, input.photoCount ?? 1)).map(
      (upload) => upload.id
    )

  return (await owner.client.rpc("publish_found_item", {
    p_title: input.title,
    p_description: input.description,
    p_custody: input.custody,
    p_contact: input.contact === undefined ? null : input.contact,
    p_location_lat: input.lat === undefined ? null : input.lat,
    p_location_lng: input.lng === undefined ? null : input.lng,
    p_location_label:
      input.locationLabel === undefined ? null : input.locationLabel,
    p_upload_ids: uploadIds,
  } as never)) as unknown as RpcResult<string>
}

/** 真的往私有桶写一个对象（service_role），用于签名 URL / 直读权限用例 */
export async function uploadObject(
  ctx: TestContext,
  path: string,
  bytes: Buffer = PNG_BYTES,
  contentType = "image/png"
): Promise<void> {
  const upload = await ctx.admin.storage
    .from(IMAGE_BUCKET)
    .upload(path, bytes, { contentType, upsert: true })
  if (upload.error) {
    throw new Error("上传测试对象失败：" + upload.error.message)
  }
  ctx.trackStoragePath(path)
}

// ---------- 运行期配置（限流阈值等） ----------

export type AppConfig = {
  max_photos: number
  page_size: number
  claim_per_hour: number
  claim_per_day: number
  ai_per_hour: number
  publish_per_day: number
  publish_per_week: number
}

export async function readAppConfig(): Promise<AppConfig> {
  const admin = createAdminClient()
  const result = await admin
    .from("app_config")
    .select(
      "max_photos, page_size, claim_per_hour, claim_per_day, ai_per_hour, publish_per_day, publish_per_week"
    )
    .single()
  if (result.error || !result.data) {
    throw new Error(
      "读取 app_config 失败：" + (result.error?.message ?? "unknown")
    )
  }
  return result.data as unknown as AppConfig
}

// ---------- 读取（service_role oracle，用于断言“页面上不该出现什么”） ----------

export type ItemSecret = {
  id: string
  owner_id: string
  status: string
  custody: string
  contact: string | null
  location_lat: number | null
  location_lng: number | null
  location_label: string | null
}

export async function readSecret(
  ctx: TestContext,
  itemId: string
): Promise<ItemSecret> {
  const result = await ctx.admin
    .from("found_items")
    .select(
      "id, owner_id, status, custody, contact, location_lat, location_lng, location_label"
    )
    .eq("id", itemId)
    .single()
  if (result.error || !result.data) {
    throw new Error(
      "读取物品机密列失败：" + (result.error?.message ?? "unknown")
    )
  }
  return result.data as unknown as ItemSecret
}

export async function itemStatus(
  ctx: TestContext,
  itemId: string
): Promise<string> {
  const result = await ctx.admin
    .from("found_items")
    .select("status")
    .eq("id", itemId)
    .single()
  if (result.error || !result.data) {
    throw new Error("读取物品状态失败：" + (result.error?.message ?? "unknown"))
  }
  return result.data.status
}

export async function pickupCount(
  ctx: TestContext,
  itemId: string
): Promise<number> {
  const result = await ctx.admin
    .from("pickups")
    .select("id", { count: "exact", head: true })
    .eq("found_item_id", itemId)
  if (result.error) {
    throw new Error("统计领取记录失败：" + result.error.message)
  }
  return result.count ?? 0
}

export async function imageCount(
  ctx: TestContext,
  itemId: string
): Promise<number> {
  const result = await ctx.admin
    .from("found_item_images")
    .select("id", { count: "exact", head: true })
    .eq("found_item_id", itemId)
  if (result.error) {
    throw new Error("统计图片失败：" + result.error.message)
  }
  return result.count ?? 0
}

// ---------- 领取 ----------

export type PickupRow = { id: string }

/** 认领：只提交物品 id，实名信息由服务端从 profiles 取 */
export async function createPickup(
  picker: TestUser,
  itemId: string
): Promise<string> {
  const result = (await picker.client.rpc("create_pickup", {
    p_item_id: itemId,
  })) as unknown as RpcResult<string>
  if (result.error || !result.data) {
    throw new Error(
      "创建领取记录失败：" +
        result.error?.code +
        " " +
        (result.error?.message ?? "unknown")
    )
  }
  return result.data
}

/** 直接调用 create_pickup 返回原始结果（用于断言错误码/限流） */
export function createPickupRaw(
  picker: TestUser,
  itemId: string
): PromiseLike<RpcResult<string>> {
  return picker.client.rpc("create_pickup", {
    p_item_id: itemId,
  }) as unknown as PromiseLike<RpcResult<string>>
}

export function revealRaw(
  viewer: TestUser,
  itemId: string
): PromiseLike<
  RpcResult<
    Array<{
      out_custody: string
      out_contact: string | null
      out_location_lat: number | null
      out_location_lng: number | null
      out_location_label: string | null
    }>
  >
> {
  return viewer.client.rpc("reveal_found_item_contact", {
    p_item_id: itemId,
  }) as unknown as PromiseLike<
    RpcResult<
      Array<{
        out_custody: string
        out_contact: string | null
        out_location_lat: number | null
        out_location_lng: number | null
        out_location_label: string | null
      }>
    >
  >
}

/** 拾主撤单（只有 status = published 时才能成功） */
export async function withdrawItem(
  owner: TestUser,
  itemId: string
): Promise<void> {
  const result = (await owner.client.rpc("withdraw_found_item", {
    p_item_id: itemId,
  })) as unknown as RpcResult<string>
  if (result.error) {
    throw new Error("撤单失败：" + result.error.message)
  }
}

/** 直接调用 withdraw_found_item，返回原始结果（用于断言错误码/中文提示） */
export function withdrawItemRaw(
  owner: TestUser,
  itemId: string
): PromiseLike<RpcResult<string>> {
  return owner.client.rpc("withdraw_found_item", {
    p_item_id: itemId,
  }) as unknown as PromiseLike<RpcResult<string>>
}

/**
 * 撤回认领（本人）。
 * 只有没有其他人还在认领时物品才回到 published，否则保持 claimed。
 */
export async function releaseClaim(
  picker: TestUser,
  itemId: string
): Promise<void> {
  const result = (await picker.client.rpc("release_found_item_claim", {
    p_item_id: itemId,
  })) as unknown as RpcResult<string>
  if (result.error) {
    throw new Error("撤回认领失败：" + result.error.message)
  }
}

/** 直接调用 release_found_item_claim，返回原始结果（用于断言错误码/最终状态） */
export function releaseClaimRaw(
  picker: TestUser,
  itemId: string
): PromiseLike<RpcResult<string>> {
  return picker.client.rpc("release_found_item_claim", {
    p_item_id: itemId,
  }) as unknown as PromiseLike<RpcResult<string>>
}

/** 用 service_role 直接种入历史条目（构造「今天/本周已经发过 N 条」的等价状态） */
export async function seedPublishedItems(
  ownerId: string,
  count: number,
  createdAt: string
): Promise<void> {
  const admin = createAdminClient()
  const rows = Array.from({ length: count }, (_, index) => ({
    owner_id: ownerId,
    title: "历史条目 " + index,
    description: DEFAULT_DESCRIPTION,
    custody: "in_place" as const,
    location_label: "测试点位",
    status: "published" as const,
    created_at: createdAt,
  }))
  const result = await admin.from("found_items").insert(rows)
  if (result.error) {
    throw new Error("种入历史条目失败：" + result.error.message)
  }
}
