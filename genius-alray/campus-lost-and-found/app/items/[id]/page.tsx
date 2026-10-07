import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ClockIcon } from "lucide-react"

import { PageTitle } from "@/components/nav/title-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { getItem, listImagesForItems } from "@/lib/db/found-items"
import { getMyPickup } from "@/lib/db/pickups"
import { getMyProfile } from "@/lib/db/profiles"
import { signPathsInOrder } from "@/lib/storage/signed"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import { ITEM_STATUS_LABEL } from "@/lib/types"
import type { Profile } from "@/lib/types"

import { formatDateTime } from "../format"
import { ClaimActions } from "./claim-actions"
import { ItemGallery } from "./item-gallery"

export const metadata: Metadata = {
  title: "物品详情 · 校园失物招领",
}

export const dynamic = "force-dynamic"

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const { id } = await params
  const supabase = await createClient()

  // getItem 只取公开列；contact / location 在列级被 REVOKE，这里根本拿不到
  const item = await getItem(supabase, id)
  if (!item) notFound()

  const images = await listImagesForItems(supabase, [id])
  const signed = await signPathsInOrder(
    images.map((image) => image.storage_path)
  )

  const isOwner = item.owner_id === user.id

  // 认领入口需要：我的个人信息（注册时必填，认领确认框里要展示）+ 我是否已认领
  let profile: Profile | null = null
  let claimedByMe = false
  if (!isOwner) {
    const [profileRow, pickup] = await Promise.all([
      getMyProfile(supabase, user.id),
      getMyPickup(supabase, id, user.id),
    ])
    profile = profileRow
    claimedByMe = item.status === "claimed" && Boolean(pickup)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-5">
      {/* 标题栏（全局）已显示物品名称，正文里不再重复大标题；返回与 item-back 走路由默认 */}
      <PageTitle title={item.title} />

      <ItemGallery images={signed} title={item.title} />

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Badge variant={item.status === "published" ? "default" : "outline"}>
            {ITEM_STATUS_LABEL[item.status]}
          </Badge>
          <p className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <ClockIcon className="size-3.5" aria-hidden />
            {formatDateTime(item.created_at)} 发布
          </p>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {item.description}
        </p>
      </div>

      {isOwner ? (
        item.status === "withdrawn" ? (
          <Alert data-testid="pickup-withdrawn">
            <AlertTitle>已撤单</AlertTitle>
          </Alert>
        ) : (
          <Alert data-testid="item-owner-notice">
            <AlertDescription>
              {item.status === "claimed"
                ? "已被认领，认领人名单在"
                : "这是你发布的，认领人名单在"}
              <Link href="/me" className="underline underline-offset-4">
                「我的认领」
              </Link>
            </AlertDescription>
          </Alert>
        )
      ) : item.status === "withdrawn" ? (
        <Alert data-testid="pickup-withdrawn">
          <AlertTitle>已撤单</AlertTitle>
        </Alert>
      ) : claimedByMe ? (
        <ClaimActions
          itemId={item.id}
          profile={profile}
          claimedByMe
          alreadyClaimedByOther={false}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {item.status === "claimed" ? (
            // 【第 7 轮】别人认领了也允许继续认领：认领只是登记，归属靠线下协商
            <Alert data-testid="pickup-claimed">
              <AlertTitle>已有人认领</AlertTitle>
              <AlertDescription>
                如果你才是失主，也可以认领，认领后能看到其他认领人并协商。
              </AlertDescription>
            </Alert>
          ) : null}
          <ClaimActions
            itemId={item.id}
            profile={profile}
            claimedByMe={false}
            alreadyClaimedByOther={item.status === "claimed"}
          />
        </div>
      )}
    </div>
  )
}
