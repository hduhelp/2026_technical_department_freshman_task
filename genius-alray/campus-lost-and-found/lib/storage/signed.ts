import "server-only"

import { IMAGE_BUCKET } from "@/lib/storage/validate"
import { createAdminClient } from "@/lib/supabase/admin"

export { IMAGE_BUCKET }
export const SIGNED_URL_TTL_SECONDS = 3600

/**
 * 私有桶的图片只能由服务端签发短时效 URL。
 * 返回 path → 签名 URL 的映射，调用方自行按 path 取用。
 */
export async function createSignedUrlMap(
  paths: string[],
  expiresIn = SIGNED_URL_TTL_SECONDS
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)))
  if (unique.length === 0) return {}

  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(IMAGE_BUCKET)
    .createSignedUrls(unique, expiresIn)

  if (error || !data) return {}

  const map: Record<string, string> = {}
  for (const item of data) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl
  }
  return map
}

/** 按输入顺序返回 (path, url) 列表，保持与图片顺序一致 */
export async function signPathsInOrder(
  paths: string[]
): Promise<Array<{ path: string; url: string }>> {
  const map = await createSignedUrlMap(paths)
  return paths.map((path) => ({ path, url: map[path] ?? "" }))
}
