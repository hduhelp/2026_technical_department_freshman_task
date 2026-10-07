import type { PostgrestError } from "@supabase/supabase-js"

export class DbError extends Error {
  readonly code: string | null
  constructor(message: string, code: string | null = null) {
    super(message)
    this.name = "DbError"
    this.code = code
  }
}

/** 兜底提示：只在服务端没有给出可读消息时使用 */
const MESSAGE_MAP: Record<string, string> = {
  "42501": "没有权限执行该操作",
  P0001: "当前状态不允许该操作",
  P0002: "记录不存在",
  "22023": "参数不合法",
}

const HAS_CJK = /[\u4e00-\u9fff]/

/**
 * 把 PostgREST 的错误转成可读中文提示。
 *
 * 【关键】RPC 里用 `raise exception '中文提示'` 主动抛出的业务错误，
 * PostgREST 会把原文放进 error.message。这类提示必须**原样透出**
 * （例如「该物品已被认领」「不能认领自己发布的物品」「该物品已被认领，无法撤单」），
 * 否则用户只会看到笼统的「当前状态不允许该操作」，不知道到底发生了什么。
 * 只有 Postgres 自己抛的英文错误（permission denied for function … 等）才走兜底映射。
 */
export function toDbError(error: PostgrestError | null): DbError {
  if (!error) return new DbError("未知错误")
  const fallback = MESSAGE_MAP[error.code] ?? error.message
  const raised = error.message ?? ""
  return new DbError(HAS_CJK.test(raised) ? raised : fallback, error.code)
}

/** 用于「必然有结果」的调用；类型系统里 supabase 的数据可能为 null，这里显式收窄 */
export function unwrap<T>(result: {
  data: T
  error: PostgrestError | null
}): NonNullable<T> {
  if (result.error) throw toDbError(result.error)
  return result.data as NonNullable<T>
}

/** 用于 maybeSingle 这类允许未命中的读取 */
export function unwrapMaybe<T>(result: {
  data: T
  error: PostgrestError | null
}): T {
  if (result.error) throw toDbError(result.error)
  return result.data
}
