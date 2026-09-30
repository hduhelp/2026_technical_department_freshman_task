import "server-only"

import { createClient } from "@supabase/supabase-js"

import { serviceRoleKey, supabaseConfig } from "@/lib/env"
import type { Database } from "@/lib/supabase/types"

/**
 * service_role 客户端：会绕过 RLS，**只能**在本地验证脚本或可信的服务端任务里使用。
 * 应用运行时（页面与 Server Action）一律用 lib/supabase/server.ts 里的用户态客户端。
 */
export function createSupabaseAdminClient() {
  const config = supabaseConfig()
  const key = serviceRoleKey()
  if (!config || !key) return null

  return createClient<Database>(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
