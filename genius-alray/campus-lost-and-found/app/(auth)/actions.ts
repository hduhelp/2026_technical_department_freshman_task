"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { phoneToEmail } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"
import { signInSchema, signUpSchema } from "@/lib/validation/schemas"

import { safeNextPath } from "./next-path"

export type AuthState = {
  formError?: string
  fieldErrors?: Record<string, string[] | undefined>
}

const ERROR_MESSAGES: Array<[RegExp, string]> = [
  [
    /already registered|already exists|user already/i,
    "该手机号已注册，请直接登录",
  ],
  [/invalid login credentials/i, "手机号或密码不正确"],
  [/password should be at least|password is too short/i, "密码至少 6 位"],
  // Supabase 开启 CAPTCHA 保护后，缺 token / token 过期都会走到这里
  [/captcha|turnstile/i, "人机校验未通过，请重新完成校验后再试"],
  [/duplicate key|profiles_phone/i, "该手机号已注册，请直接登录"],
  [/注册需要真实姓名与手机号/, "注册需要真实姓名与手机号"],
]

/**
 * 取出 Turnstile 令牌。
 * 没配 sitekey 时（本地开发、自动化测试）表单里根本没有这个字段，返回 undefined ——
 * 不能传空串：Supabase 会把空字符串当成一个「无效令牌」直接拒绝。
 */
function readCaptchaToken(formData: FormData): string | undefined {
  const raw = formData.get("captchaToken")
  const token = typeof raw === "string" ? raw.trim() : ""
  return token.length > 0 ? token : undefined
}

function translateAuthError(message: string): string {
  for (const [pattern, text] of ERROR_MESSAGES) {
    if (pattern.test(message)) return text
  }
  return message
}

/**
 * 注册：真实姓名 + 手机号 + 密码。
 * 手机号映射成内部邮箱（不做短信验证码），姓名与手机号通过 options.data
 * 交给 handle_new_user 触发器写进 profiles。
 */
export async function signUp(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    realName: formData.get("realName"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    agree: formData.get("agree") === "on",
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const nextPath = safeNextPath(formData.get("next"))
  const captchaToken = readCaptchaToken(formData)
  const supabase = await createClient()

  let formError: string | undefined
  try {
    const { data, error } = await supabase.auth.signUp({
      email: phoneToEmail(parsed.data.phone),
      password: parsed.data.password,
      options: {
        data: { real_name: parsed.data.realName, phone: parsed.data.phone },
        captchaToken,
      },
    })
    if (error) {
      formError = translateAuthError(error.message)
    } else if (!data.session) {
      // 账号是「手机号派生的内部邮箱」，@campus.local 收不到确认信。
      // 走到这里只有一种可能：云端的 Confirm email 还开着 —— 用户会看到「注册成功」，
      // 却永远登不进去。这是部署配置问题，不是用户操作问题，所以在日志里指出来，
      // 别让下一个人从「注册明明成功了」开始猜。
      console.error(
        "[auth] signUp 没有返回 session：请到 Supabase 控制台关掉 " +
          "Authentication → Sign In / Providers → Email → Confirm email"
      )
      formError = "注册暂未完成，请联系管理员"
    }
  } catch (error) {
    formError = error instanceof Error ? error.message : "注册失败，请重试"
  }

  if (formError) return { formError }
  redirect(nextPath)
}

/** 登录：手机号 + 密码，成功后回到 next（站内）或首页 */
export async function signIn(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    phone: formData.get("phone"),
    password: formData.get("password"),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const nextPath = safeNextPath(formData.get("next"))
  const captchaToken = readCaptchaToken(formData)
  const supabase = await createClient()

  let formError: string | undefined
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: phoneToEmail(parsed.data.phone),
      password: parsed.data.password,
      options: { captchaToken },
    })
    if (error) formError = translateAuthError(error.message)
  } catch (error) {
    formError = error instanceof Error ? error.message : "登录失败，请重试"
  }

  if (formError) return { formError }
  redirect(nextPath)
}
