import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/database.types"
import { phoneToEmail } from "@/lib/env"

export type SyncLoginPhoneResult = { ok: true } | { ok: false; error: string }

/** 管理端返回的英文错误翻成能给用户看的话（不要把 Postgres / GoTrue 原文漏到界面上） */
function describe(error: string): string {
  if (/already|exists|registered|duplicate/i.test(error)) {
    return "该手机号已被注册，请换一个"
  }
  return "手机号更新失败，请稍后重试"
}

/**
 * 把「登录账号」同步到新手机号。
 *
 * 【为什么必须有这一步】账号内部是 `<手机号>@<域名>` 的邮箱（见 lib/env.ts 的
 * phoneToEmail）。注册之后如果只改 profiles.phone 而不改 auth 的邮箱，用户下次
 * 输入**新**手机号时会映射到一个不存在的邮箱 —— 结果是「资料里写着新号，
 * 却只能用旧号登录」，等同于把自己锁在门外。
 *
 * 【为什么走 Admin API 而不是当前会话的 updateUser】当前会话改邮箱是否立即生效，
 * 取决于 Auth 的邮箱确认策略（enable_confirmations / double_confirm_changes）；
 * 内部域名（campus.local）收不到确认信，一旦落到「待确认」状态，改号就永远不会
 * 真正生效。Admin API 的 `email_confirm: true` 是确定性的：直接写入并标记已确认，
 * 与确认策略无关。
 *
 * 【为什么要再核对一次返回值】不信任「没报错 = 已生效」：若返回的用户邮箱不是目标值
 * （例如落进了待确认状态），宁可返回失败让调用方回滚，也不能留下
 * 「profiles 是新号、登录账号是旧号」的半成品状态。
 */
export async function syncLoginPhone(
  admin: SupabaseClient<Database>,
  userId: string,
  phone: string
): Promise<SyncLoginPhoneResult> {
  const email = phoneToEmail(phone)

  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  })
  if (error) return { ok: false, error: describe(error.message) }
  if (data.user?.email !== email) {
    return { ok: false, error: "手机号更新失败，请稍后重试" }
  }

  return { ok: true }
}
