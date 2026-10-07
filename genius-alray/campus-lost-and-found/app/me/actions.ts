"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { syncLoginPhone } from "@/lib/auth/login-phone"
import { withdrawItem } from "@/lib/db/found-items"
import { getMyProfile, updateMyProfile } from "@/lib/db/profiles"
import { DbError } from "@/lib/db/types"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import { profileSchema } from "@/lib/validation/schemas"
import type { Profile } from "@/lib/types"

export type WithdrawItemResult = { ok: boolean; message: string }

export type ProfileState = {
  ok?: boolean
  formError?: string
  fieldErrors?: Record<string, string[] | undefined>
}

const itemIdSchema = z.object({ itemId: z.string().uuid("物品不存在") })

/** 拾主撤单：只在物品还没被认领时可用（数据库侧强制）。内部重做鉴权与校验。 */
export async function withdrawItemAction(
  itemId: string
): Promise<WithdrawItemResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, message: "登录状态已失效，请重新登录" }

  const parsed = itemIdSchema.safeParse({ itemId })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "参数不合法",
    }
  }

  try {
    const supabase = await createClient()
    await withdrawItem(supabase, parsed.data.itemId)
    revalidatePath("/me")
    revalidatePath("/me/items/" + parsed.data.itemId + "/pickups")
    revalidatePath("/")
    return { ok: true, message: "已撤单" }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DbError ? error.message : "操作失败，请重试",
    }
  }
}

/** 只接受站内相对路径（认领流程会把 /items/xxx 传进来） */
function safeNext(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : ""
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/me"
  return raw
}

/**
 * 保存「我的信息」（真实姓名 + 手机号）。
 * 成功后**在服务端 redirect** 回来源页（认领流程会带 ?next=/items/xxx），
 * 不依赖客户端的 router.replace —— 之前就是因为放在客户端 effect 里，
 * 偶尔会被别处的导航打断，用户看到的是「我的」页。
 */
export async function saveProfileAction(
  _prevState: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const parsed = profileSchema.safeParse({
    realName: formData.get("realName"),
    phone: formData.get("phone"),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const nextPath = safeNext(formData.get("next"))
  const supabase = await createClient()

  let current: Profile | null = null
  try {
    current = await getMyProfile(supabase, user.id)
  } catch {
    // 读不到当前资料就不去动登录账号：宁可让用户重试，也不留下半成品状态
    return { formError: "读取个人信息失败，请重试" }
  }

  // 手机号即账号（内部邮箱 <手机号>@<域名>），所以改手机号必须同步改 auth 的邮箱，
  // 否则用户只能继续用**旧**手机号登录 —— 新号永远登不进来。
  //
  // 顺序是关键：**先改登录账号**。auth 的邮箱同样有唯一约束，顺便就挡住了
  // 「换成别人已注册的手机号」；反过来先写 profiles 再改邮箱的话，邮箱那一步一旦
  // 失败，留下的是「资料里是新号、登录还得用旧号」的死局。
  const phoneChanged = current?.phone !== parsed.data.phone
  if (phoneChanged) {
    const synced = await syncLoginPhone(
      createAdminClient(),
      user.id,
      parsed.data.phone
    )
    if (!synced.ok) return { formError: synced.error }
  }

  try {
    await updateMyProfile(supabase, user.id, parsed.data)
    revalidatePath("/me")
  } catch (error) {
    // 资料没写成 → 把登录账号也退回原样，绝不留下两处不一致
    if (phoneChanged && current) {
      await syncLoginPhone(createAdminClient(), user.id, current.phone).catch(
        () => {}
      )
    }
    return {
      formError: error instanceof DbError ? error.message : "保存失败，请重试",
    }
  }

  redirect(nextPath)
}

/** 退出登录 */
export async function signOutAction(): Promise<void> {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/login")
}
