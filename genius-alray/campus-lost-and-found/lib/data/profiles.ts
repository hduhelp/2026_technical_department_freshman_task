import type { User } from "@supabase/supabase-js"

import type { DbClient } from "@/lib/data/items"
import { normalizeUsername } from "@/lib/validation"

export async function getProfile(sb: DbClient, userId: string) {
  const { data, error } = await sb
    .from("profiles")
    .select("id, username")
    .eq("id", userId)
    .maybeSingle()
  if (error) return null
  return data
}

export async function isUsernameAvailable(
  sb: DbClient,
  username: string
): Promise<boolean> {
  const { data, error } = await sb.rpc("username_available", {
    p_username: normalizeUsername(username),
  })
  if (error) throw new Error("用户名查重失败：" + error.message)
  return data === true
}

/**
 * 登录后自愈：注册第二步（插 profile）如果失败过，这里补齐，
 * 避免出现「能登录但没有用户名」的坏状态。
 *
 * 注意：user_metadata 是用户可自行修改的，这里只把它当成**展示用昵称**的来源，
 * 绝不参与任何鉴权或 RLS 判断。
 */
export async function ensureProfile(sb: DbClient, user: User): Promise<void> {
  const existing = await getProfile(sb, user.id)
  if (existing) return

  const raw = user.user_metadata?.username
  if (typeof raw !== "string" || !raw.trim()) return

  await sb.from("profiles").insert({
    id: user.id,
    username: normalizeUsername(raw),
  })
}
