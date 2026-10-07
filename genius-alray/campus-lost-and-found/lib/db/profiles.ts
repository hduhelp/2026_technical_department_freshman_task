import { unwrap, unwrapMaybe } from "@/lib/db/types"
import type { DbClient, Profile } from "@/lib/types"

const PROFILE_COLUMNS = "id, real_name, phone, created_at, updated_at"

/**
 * 读取「我的信息」。
 * RLS 是 profiles_select_own（id = auth.uid()），客户端只能读到/改到自己那一行。
 */
export async function getMyProfile(
  supabase: DbClient,
  userId: string
): Promise<Profile | null> {
  return unwrapMaybe(
    await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle()
  )
}

/** 保存「我的信息」（真实姓名 + 手机号）。 */
export async function updateMyProfile(
  supabase: DbClient,
  userId: string,
  input: { realName: string; phone: string }
): Promise<Profile> {
  return unwrap(
    await supabase
      .from("profiles")
      .update({ real_name: input.realName, phone: input.phone })
      .eq("id", userId)
      .select(PROFILE_COLUMNS)
      .single()
  )
}
