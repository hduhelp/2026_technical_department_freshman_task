import { unwrap } from "@/lib/db/types"
import type { DbClient } from "@/lib/types"

export type AiQuota = {
  /** false = 已到上限，调用方必须跳过 AI 调用并降级提示 */
  allowed: boolean
  used: number
  limit: number
}

/**
 * 消耗一次 AI 配额（每小时 app_config.ai_per_hour 次）。
 *
 * 计数放在数据库里，而不是进程内存：应用可以多实例，内存计数挡不住
 * 「换个实例继续刷」；数据库是唯一真源，和其余限流口径一致。
 */
export async function consumeAiQuota(supabase: DbClient): Promise<AiQuota> {
  const rows = unwrap(await supabase.rpc("consume_ai_quota", {}))
  const row = rows[0]
  if (!row) return { allowed: false, used: 0, limit: 0 }
  return { allowed: row.out_allowed, used: row.out_used, limit: row.out_limit }
}
