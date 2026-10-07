import type { DbClient, Pickup } from "@/lib/types"
import { unwrap, unwrapMaybe } from "@/lib/db/types"

/**
 * 领取：只提交物品 id。
 * 实名信息（姓名 + 手机号）由 create_pickup 在服务端从 profiles 取，
 * 频率限制也由该 RPC 强制（见 app_config.claim_per_hour / claim_per_day）。
 */
export async function createPickup(
  supabase: DbClient,
  itemId: string
): Promise<string> {
  return unwrap(await supabase.rpc("create_pickup", { p_item_id: itemId }))
}

/**
 * 我提交过的领取记录（只算还在认领的）。
 * 【必须显式过滤 picker_id】pickups 的 RLS 是「picker_id = 我 或 该物品的 owner 是我」，
 * 不加过滤会把**别人在我的物品上提交的领取记录**也一起返回 —— 与 listMyItems 是同一类坑。
 * 【只算还在认领的】released_at is null；撤回过的记录保留在库里（审计 + 可再认领），
 * 但不再显示为「我的认领」。
 */
export async function listMyPickups(
  supabase: DbClient,
  pickerId: string
): Promise<Pickup[]> {
  return unwrap(
    await supabase
      .from("pickups")
      .select(
        "id, found_item_id, picker_id, picker_name, picker_phone, created_at"
      )
      .eq("picker_id", pickerId)
      .is("released_at", null)
      .order("created_at", { ascending: false })
  )
}

/**
 * 我对某个物品的认领记录（认领信息屏要用）。RLS：picker_id = 我 可见。
 * 已撤回（released_at 非空）返回 null —— 认领信息屏据此把撤回的人送回详情页。
 */
export async function getMyPickup(
  supabase: DbClient,
  itemId: string,
  pickerId: string
): Promise<Pickup | null> {
  return unwrapMaybe(
    await supabase
      .from("pickups")
      .select(
        "id, found_item_id, picker_id, picker_name, picker_phone, created_at"
      )
      .eq("found_item_id", itemId)
      .eq("picker_id", pickerId)
      .is("released_at", null)
      .maybeSingle()
  )
}

/**
 * 某物品的全部认领人（含自己）。
 * 【为什么走 RPC】pickups 的 RLS 只放行「我自己」和「我是拾主」两种行，
 * 认领人看不到别的认领人；多人认领冲突时前端需要展示其他人，所以由
 * `list_found_item_claimers`（SECURITY DEFINER，校验「拾主或已认领者」）返回。
 */
export async function listItemClaimers(
  supabase: DbClient,
  itemId: string
): Promise<
  Array<{
    picker_id: string
    picker_name: string
    picker_phone: string
    created_at: string
  }>
> {
  const rows = unwrap(
    await supabase.rpc("list_found_item_claimers", { p_item_id: itemId })
  )
  return rows.map((row) => ({
    picker_id: row.out_picker_id,
    picker_name: row.out_picker_name,
    picker_phone: row.out_picker_phone,
    created_at: row.out_created_at,
  }))
}

/**
 * 撤回认领（「拿错了，不是我的」）。
 * 记录保留（released_at 打时间戳），只有**没有其他人还在认领**时物品才回到待认领；
 * 否则物品保持已认领，撤回的人只是退出认领人名单。返回物品的最终状态。
 */
export async function releaseClaim(supabase: DbClient, itemId: string) {
  return unwrap(
    await supabase.rpc("release_found_item_claim", { p_item_id: itemId })
  )
}

/** 拾主查看某个物品的认领人名单（RLS：物品 owner 可见；只列还在认领的人） */
export async function listItemPickups(
  supabase: DbClient,
  itemId: string
): Promise<Pickup[]> {
  return unwrap(
    await supabase
      .from("pickups")
      .select(
        "id, found_item_id, picker_id, picker_name, picker_phone, created_at"
      )
      .eq("found_item_id", itemId)
      .is("released_at", null)
      .order("created_at", { ascending: false })
  )
}
