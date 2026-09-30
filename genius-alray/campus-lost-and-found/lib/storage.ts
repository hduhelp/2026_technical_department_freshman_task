import "server-only"

import { UPLOAD_BUCKET } from "@/lib/constants"
import { supabaseConfig } from "@/lib/env"

/** 把 Storage 对象路径拼成公开可访问的 URL。没有配置环境变量时返回 null。 */
export function publicPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const config = supabaseConfig()
  if (!config) return null
  return (
    config.url.replace(/\/+$/, "") +
    "/storage/v1/object/public/" +
    UPLOAD_BUCKET +
    "/" +
    path
  )
}
