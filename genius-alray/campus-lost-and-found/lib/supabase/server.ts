import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { cache } from "react"

import { MISSING_CONFIG_MESSAGE, supabaseConfig } from "@/lib/env"
import type { Database } from "@/lib/supabase/types"

async function buildClient(url: string, anonKey: string) {
  const cookieStore = await cookies()

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Component 里不能写 cookie。
          // 这里静默忽略即可：读取会话仍然正常，写入由 proxy.ts 负责刷新。
        }
      },
    },
  })
}

export type SupabaseServerClient = Awaited<ReturnType<typeof buildClient>>

/** 需要数据时用这个；没配置环境变量会抛出带中文指引的错误。 */
export async function createSupabaseServerClient(): Promise<SupabaseServerClient> {
  const config = supabaseConfig()
  if (!config) throw new Error(MISSING_CONFIG_MESSAGE)
  return buildClient(config.url, config.anonKey)
}

/** 允许「没配置环境变量」这种情况的页面用这个，自行渲染提示。 */
export async function tryCreateSupabaseServerClient(): Promise<SupabaseServerClient | null> {
  const config = supabaseConfig()
  if (!config) return null
  return buildClient(config.url, config.anonKey)
}

/**
 * 只认 getUser()：它会拿 token 去 Auth 服务校验，getSession() 只解 cookie，不能用于鉴权。
 * 用 React cache 包一层，同一个请求里头部和页面各调一次也只走一次网络。
 */
export const getCurrentUser = cache(async () => {
  const supabase = await tryCreateSupabaseServerClient()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user ?? null
})
