#!/usr/bin/env node
// 回收「被放弃的发布草稿」：删掉它名下的照片对象 + 登记行 + 草稿本身。
//
// 为什么需要它：草稿里的照片从上传成功那一刻就挂在用户名下。用户一直不发布、
// 也不主动删，对象就会一直躺在私有桶里。
//
// 【为什么按「草稿」回收而不是按「孤儿对象」】草稿是有边界的清理单位：
// 它的照片全在用户名下、并且有明确的活动时间（updated_at）。按「多久没动过」
// 整体回收即可，不需要去猜哪张对象是孤儿、也不用扫全桶。
//
// 线上由 Vercel Cron 每天调 /api/cron/prune-drafts 自动跑（见 vercel.json），
// 口径与本脚本一致：**默认 30 天没动过**（lib/db/prune-drafts.ts 的 DRAFT_TTL_DAYS）。
//
// 用法：
//   pnpm db:prune-drafts                     # 默认 dry-run：只列出来
//   pnpm db:prune-drafts --apply             # 真的删（默认 30 天）
//   pnpm db:prune-drafts --apply --days=7
import { config } from "dotenv"
import { createClient } from "@supabase/supabase-js"

config({ path: ".env.local", quiet: true })
config({ path: ".env", quiet: true })

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const daysArg = args.find((arg) => arg.startsWith("--days="))
const days = Number(daysArg ? daysArg.split("=")[1] : 30)

if (!Number.isFinite(days) || days < 1) {
  console.error("--days 必须是 ≥1 的数字")
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error(
    "缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（先跑 pnpm db:env）"
  )
  process.exit(1)
}

const BUCKET = "item-images"
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

const staleResult = await admin
  .from("publish_drafts")
  .select("user_id, updated_at")
  .lt("updated_at", cutoff)

if (staleResult.error) {
  console.error("读取草稿失败：" + staleResult.error.message)
  process.exit(1)
}

const drafts = staleResult.data ?? []
console.log(
  `超过 ${days} 天没动过的草稿：${drafts.length} 份（cutoff ${cutoff}）`
)

let objects = 0
let pruned = 0

for (const draft of drafts) {
  const links = await admin
    .from("publish_draft_images")
    .select("upload_id, position")
    .eq("user_id", draft.user_id)
    .order("position")

  if (links.error) {
    console.error(
      `- ${draft.user_id}：读取草稿照片失败，跳过（${links.error.message}）`
    )
    continue
  }

  const uploadIds = (links.data ?? []).map((row) => row.upload_id)
  let paths = []
  if (uploadIds.length > 0) {
    const uploads = await admin
      .from("image_uploads")
      .select("id, storage_path")
      .in("id", uploadIds)
    if (uploads.error) {
      console.error(
        `- ${draft.user_id}：读取上传登记失败，跳过（${uploads.error.message}）`
      )
      continue
    }
    paths = (uploads.data ?? []).map((row) => row.storage_path)
  }

  console.log(
    `- ${draft.user_id}：${paths.length} 张照片，最后活动 ${draft.updated_at}`
  )
  if (!apply) continue

  // 先删对象再删登记行：反过来一旦中途失败，就变成「有行无对象」的假账
  if (paths.length > 0) {
    const removed = await admin.storage.from(BUCKET).remove(paths)
    if (removed.error) {
      console.error(`  删除对象失败，跳过该草稿：${removed.error.message}`)
      continue
    }
    objects += paths.length
  }

  if (uploadIds.length > 0) {
    const deleted = await admin
      .from("image_uploads")
      .delete()
      .in("id", uploadIds)
    if (deleted.error) {
      console.error(`  删除上传登记失败：${deleted.error.message}`)
      continue
    }
  }

  // 草稿行删掉后，publish_draft_images 会级联消失
  const draftDeleted = await admin
    .from("publish_drafts")
    .delete()
    .eq("user_id", draft.user_id)
  if (draftDeleted.error) {
    console.error(`  删除草稿失败：${draftDeleted.error.message}`)
    continue
  }
  pruned += 1
}

if (apply) {
  console.log(`完成：回收 ${objects} 个对象、${pruned} 份草稿`)
} else {
  console.log("（dry-run：加 --apply 才会真的删）")
}
