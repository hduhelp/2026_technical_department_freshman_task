import { redirect } from "next/navigation"

import { getMyDraft, listDraftPhotos } from "@/lib/db/drafts"
import { getAppConfig } from "@/lib/db/found-items"
import { getMyProfile } from "@/lib/db/profiles"
import { createSignedUrlMap } from "@/lib/storage/signed"
import { createClient, getCurrentUser } from "@/lib/supabase/server"

import { PublishClient } from "./publish-client"

export const dynamic = "force-dynamic"

/**
 * AI 识别是这一页里的 Server Action，而 lib/ai/ai-sdk.ts 给模型端设了 60s 硬超时。
 * 不显式声明就吃平台默认值：Vercel 启用 Fluid Compute 时是 300s（够用），
 * 没启用时 Hobby 只有 10s —— 会在识别到一半时被平台掐断。
 */
export const maxDuration = 60

export default async function PublishPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const supabase = await createClient()
  const [config, profile, draft, draftPhotos] = await Promise.all([
    getAppConfig(supabase),
    getMyProfile(supabase, user.id),
    getMyDraft(supabase, user.id),
    listDraftPhotos(supabase, user.id),
  ])
  const urlByPath = await createSignedUrlMap(
    draftPhotos.map((upload) => upload.storage_path)
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-6">
      <PublishClient
        maxPhotos={config?.max_photos ?? 3}
        defaultContact={profile?.phone ?? ""}
        // 草稿是单例：这里读到什么，用户看到的就是什么；下次回来还是同一份
        draft={{
          title: draft?.title ?? "",
          description: draft?.description ?? "",
          custody: draft?.custody ?? "",
          locationLabel: draft?.location_label ?? "",
          lat: draft?.location_lat ?? null,
          lng: draft?.location_lng ?? null,
          photos: draftPhotos.map((upload) => ({
            uploadId: upload.id,
            url: urlByPath[upload.storage_path] ?? "",
          })),
        }}
      />
    </div>
  )
}
