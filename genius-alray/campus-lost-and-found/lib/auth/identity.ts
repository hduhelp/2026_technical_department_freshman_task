import "server-only"

import { createHash } from "node:crypto"

import { authEmailDomain } from "@/lib/env"
import { normalizeUsername } from "@/lib/validation"

/**
 * 用户名 → 登录标识 的映射策略。
 *
 * ⚠️ 这只是一众可行实现中的一种，不是唯一正确做法。
 * Supabase Auth 没有原生的「用户名 + 密码」登录，只能借一个登录标识（这里是邮箱）。
 * 本文件是整个项目里唯一做这个映射的地方，要在下面几种方案之间切换，只改这个文件：
 *   - 真实邮箱：直接把用户填的邮箱当作登录标识，不再需要推导
 *   - 手机号：用 supabase.auth.signInWithOtp({ phone }) + 短信验证码
 *   - magic link：用 signInWithOtp({ email }) 发登录链接
 *   - 自建 users 表 + 自签 JWT：完全绕开 Supabase Auth
 *
 * 当前实现：用户名做归一化和小写化后取 sha256 前 32 位十六进制，拼上 AUTH_EMAIL_DOMAIN。
 * 好处是确定性（登录时能重新算出来，不需要额外存表）、不可路由（.invalid 是保留 TLD）。
 */
export function toLoginEmail(username: string): string {
  const normalized = normalizeUsername(username).toLowerCase()
  const digest = createHash("sha256").update(normalized).digest("hex")
  return digest.slice(0, 32) + "@" + authEmailDomain()
}

/** 界面上的展示用邮箱（只在「账号设置」类页面需要时用，目前没有这类页面）。 */
export function loginEmailHint(username: string): string {
  const normalized = normalizeUsername(username).toLowerCase()
  return normalized + "@" + authEmailDomain()
}
