"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { toLoginEmail } from "@/lib/auth/identity"
import { safeNextPath } from "@/lib/navigation"
import { ensureProfile, isUsernameAvailable } from "@/lib/data/profiles"
import { MISSING_CONFIG_MESSAGE, supabaseConfig } from "@/lib/env"
import {
  createSupabaseServerClient,
  tryCreateSupabaseServerClient,
} from "@/lib/supabase/server"
import {
  normalizeUsername,
  validatePassword,
  validateUsername,
} from "@/lib/validation"
import type { AuthFormState } from "@/lib/actions/state"

export async function registerAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  if (!supabaseConfig()) {
    return { fieldErrors: {}, formError: MISSING_CONFIG_MESSAGE }
  }

  const username = normalizeUsername(String(formData.get("username") ?? ""))
  const password = String(formData.get("password") ?? "")
  const confirm = String(formData.get("confirm") ?? "")

  const fieldErrors: Record<string, string> = {}
  const usernameError = validateUsername(username)
  if (usernameError) fieldErrors.username = usernameError
  const passwordError = validatePassword(password)
  if (passwordError) fieldErrors.password = passwordError
  if (password !== confirm) fieldErrors.confirm = "两次输入的密码不一致"
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const supabase = await createSupabaseServerClient()

  try {
    const available = await isUsernameAvailable(supabase, username)
    if (!available) {
      return { fieldErrors: { username: "这个用户名已经被占用了" } }
    }
  } catch {
    return { fieldErrors: {}, formError: "暂时无法校验用户名，请稍后重试" }
  }

  // 邮箱确认已在 Supabase 后台关闭，signUp 会直接返回可用的 session
  const { data, error } = await supabase.auth.signUp({
    email: toLoginEmail(username),
    password,
    options: { data: { username } },
  })

  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      return { fieldErrors: { username: "这个用户名已经被占用了" } }
    }
    return { fieldErrors: {}, formError: "注册失败：" + error.message }
  }

  if (!data.user || !data.session) {
    return {
      fieldErrors: {},
      formError: "注册成功但没有拿到登录态，请直接登录",
    }
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .insert({ id: data.user.id, username })

  if (profileError) {
    await supabase.auth.signOut()
    if (/duplicate|unique/i.test(profileError.message)) {
      return { fieldErrors: { username: "这个用户名已经被占用了" } }
    }
    return { fieldErrors: {}, formError: "创建用户资料失败，请稍后重试" }
  }

  revalidatePath("/", "layout")
  redirect("/")
}

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  if (!supabaseConfig()) {
    return { fieldErrors: {}, formError: MISSING_CONFIG_MESSAGE }
  }

  const username = normalizeUsername(String(formData.get("username") ?? ""))
  const password = String(formData.get("password") ?? "")
  const next = safeNextPath(String(formData.get("next") ?? ""))

  const fieldErrors: Record<string, string> = {}
  if (!username) fieldErrors.username = "请填写用户名"
  if (!password) fieldErrors.password = "请填写密码"
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: toLoginEmail(username),
    password,
  })

  if (error || !data.user) {
    return { fieldErrors: {}, formError: "用户名或密码不正确" }
  }

  await ensureProfile(supabase, data.user)

  revalidatePath("/", "layout")
  redirect(next)
}

export async function logoutAction(): Promise<void> {
  const supabase = await tryCreateSupabaseServerClient()
  if (supabase) await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/")
}
