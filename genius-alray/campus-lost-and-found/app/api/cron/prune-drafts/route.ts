import { NextResponse } from "next/server"

import { DRAFT_TTL_DAYS, pruneAbandonedDrafts } from "@/lib/db/prune-drafts"

// service_role + storage：必须跑在 Node 运行时，且不能被静态优化掉
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// 单次运行可能删不少对象；60s 在 Hobby 与 Pro 上都是安全值。
// 即使被平台掐断也只是「这一轮少删几个」—— 每份草稿相互独立，
// 失败/未处理的下一轮接着删，不会留下半删状态。
export const maxDuration = 60

/**
 * 回收被放弃的发布草稿（生产由 Vercel Cron 每天触发一次，见 vercel.json）。
 *
 * 【鉴权】Vercel Cron 会带 `Authorization: Bearer $CRON_SECRET`。
 * 没配 CRON_SECRET 时一律 401：这个接口会删存储对象，
 * 「没配密钥」必须等于「不可访问」，绝不能等于「谁都能访问」。
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get("authorization")
  if (!secret || authorization !== "Bearer " + secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const result = await pruneAbandonedDrafts()
    return NextResponse.json({ ok: true, ttlDays: DRAFT_TTL_DAYS, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "回收失败",
      },
      { status: 500 }
    )
  }
}
