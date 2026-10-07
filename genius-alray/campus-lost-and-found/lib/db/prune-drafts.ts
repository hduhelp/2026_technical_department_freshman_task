import "server-only"

import { IMAGE_BUCKET } from "@/lib/storage/validate"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * 默认回收「超过 30 天没动过」的草稿。
 * 用户回来时草稿还在的期望值是「下次打开还有」，30 天足够宽松；
 * 而免费版 Supabase 只有 1GB 存储，放任不管会先被草稿照片填满。
 */
export const DRAFT_TTL_DAYS = 30

export type PruneResult = {
  /** 成功回收的草稿份数 */
  drafts: number
  /** 成功删除的存储对象数 */
  objects: number
  /** 中途出错被跳过的草稿份数（下次运行会再试，不会卡住整批） */
  skipped: number
}

/**
 * 回收被放弃的发布草稿：照片对象 + 上传登记行 + 草稿本身。
 *
 * 【为什么按「草稿」回收，而不是扫孤儿对象】草稿是有边界的清理单位 ——
 * 照片从上传成功那一刻就挂在草稿上，草稿有明确的活动时间（updated_at，）
 * 按「多久没动过」整体回收即可，不用去猜哪张对象是孤儿、也不用扫全桶。
 *
 * 与 scripts/prune-drafts.mjs（本地手动 dry-run 工具）口径一致：
 * **先删对象再删登记行** —— 反过来一旦中途失败，就变成「有行无对象」的假账，
 * 再想找回这些路径就没有线索了。
 */
export async function pruneAbandonedDrafts(
  olderThanDays: number = DRAFT_TTL_DAYS
): Promise<PruneResult> {
  const admin = createAdminClient()
  const cutoff = new Date(
    Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  ).toISOString()

  const stale = await admin
    .from("publish_drafts")
    .select("user_id, updated_at")
    .lt("updated_at", cutoff)
  if (stale.error) {
    throw new Error("读取草稿失败：" + stale.error.message)
  }

  const result: PruneResult = { drafts: 0, objects: 0, skipped: 0 }

  for (const draft of stale.data ?? []) {
    const links = await admin
      .from("publish_draft_images")
      .select("upload_id")
      .eq("user_id", draft.user_id)
    if (links.error) {
      result.skipped += 1
      continue
    }

    const uploadIds = (links.data ?? []).map((row) => row.upload_id)
    let paths: string[] = []
    if (uploadIds.length > 0) {
      const uploads = await admin
        .from("image_uploads")
        .select("id, storage_path")
        .in("id", uploadIds)
      if (uploads.error) {
        result.skipped += 1
        continue
      }
      paths = (uploads.data ?? []).map((row) => row.storage_path)
    }

    // 先对象、后登记行：中途失败时宁可留下「有行无对象」（下次还能凭路径重试），
    // 也不要留下「有对象无行」（再也找不回来）。
    if (paths.length > 0) {
      const removed = await admin.storage.from(IMAGE_BUCKET).remove(paths)
      if (removed.error) {
        result.skipped += 1
        continue
      }
      result.objects += paths.length
    }

    if (uploadIds.length > 0) {
      const deleted = await admin
        .from("image_uploads")
        .delete()
        .in("id", uploadIds)
      if (deleted.error) {
        result.skipped += 1
        continue
      }
    }

    // 草稿行删掉后，publish_draft_images 由外键级联消失
    const draftDeleted = await admin
      .from("publish_drafts")
      .delete()
      .eq("user_id", draft.user_id)
    if (draftDeleted.error) {
      result.skipped += 1
      continue
    }

    result.drafts += 1
  }

  return result
}
