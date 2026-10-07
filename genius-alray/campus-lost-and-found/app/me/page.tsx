import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronRightIcon, ImageIcon, InboxIcon, UsersIcon } from "lucide-react"

import { SkeletonImage } from "@/components/media/skeleton-image"
import { PageTitle } from "@/components/nav/title-bar"
import { SignOutButton } from "./sign-out-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  listImagesForItems,
  listMyItems,
  mergeImages,
} from "@/lib/db/found-items"
import { listMyPickups } from "@/lib/db/pickups"
import { getMyProfile } from "@/lib/db/profiles"
import { unwrap } from "@/lib/db/types"
import { createSignedUrlMap } from "@/lib/storage/signed"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import {
  ITEM_STATUS_LABEL,
  type DbClient,
  type ItemStatus,
  type ListedItem,
  type Pickup,
  type Profile,
} from "@/lib/types"

import { MeItemActions } from "./me-item-actions"
import { MeItemShell } from "./me-item-shell"
import { MeTabs } from "./me-tabs"
import { STATUS_BADGE_VARIANT } from "./status-variant"

export const metadata: Metadata = {
  title: "我的 · 校园失物招领",
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function formatDate(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return dateFormatter.format(date)
}

type PickupItemMeta = { title: string; status: ItemStatus }

type MeData = {
  items: ListedItem[]
  pickups: Pickup[]
  pickupItems: Record<string, PickupItemMeta>
}

async function loadMeData(supabase: DbClient, userId: string): Promise<MeData> {
  // listMyItems 已在 lib/db 内部按 owner_id 显式过滤（RLS 会放行全部 published 行）
  const items = await listMyItems(supabase, userId)
  const images = await listImagesForItems(
    supabase,
    items.map((item) => item.id)
  )
  const urlByPath = await createSignedUrlMap(
    images.map((image) => image.storage_path)
  )

  // 同理：pickups 的 RLS 允许拾主看到自己物品上的全部认领记录，必须显式按 picker_id 过滤
  const pickups = await listMyPickups(supabase, userId)
  const pickupItemIds = Array.from(
    new Set(pickups.map((pickup) => pickup.found_item_id))
  )

  // 认领记录对应的物品：已撤单且非本人发布的物品受 RLS 限制读不到，这里只取显式列
  const pickupItems: Record<string, PickupItemMeta> = {}
  if (pickupItemIds.length > 0) {
    const rows = unwrap(
      await supabase
        .from("found_items")
        .select("id, title, status")
        .in("id", pickupItemIds)
    )
    for (const row of rows) {
      pickupItems[row.id] = { title: row.title, status: row.status }
    }
  }

  return {
    items: mergeImages(items, images, urlByPath),
    pickups,
    pickupItems,
  }
}

/**
 * 顶部个人信息卡片：头像 + 姓名 + 手机号，右侧放退出登录。
 * 点左侧进「我的信息」修改（手机号是本人号码，不做成可拨号的蓝色链接）。
 */
function ProfileCard({
  profile,
  action,
}: {
  profile: Profile | null
  action: React.ReactNode
}) {
  const name = profile?.real_name ?? ""
  const phone = profile?.phone ?? ""

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link
        href="/me/profile"
        data-testid="profile-entry"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3 transition-colors hover:bg-muted active:scale-[0.99]"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-base font-medium text-primary-foreground">
          {name ? name.slice(0, 1) : "我"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium">
            {name || "未填写姓名"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {phone || "未填写手机号"}
          </span>
        </span>
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </Link>
      {action}
    </div>
  )
}

function MyItemCard({ item }: { item: ListedItem }) {
  const cover = item.images.find((image) => image.url)?.url ?? ""
  const published = item.status === "published"

  return (
    <MeItemShell itemId={item.id}>
      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          <Link
            href={"/items/" + item.id}
            className="flex min-w-0 gap-3 active:opacity-80"
          >
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
              {cover ? (
                <SkeletonImage
                  src={cover}
                  alt={item.title}
                  fill
                  aspectClassName=""
                  className="size-full"
                  errorText={null}
                />
              ) : (
                <ImageIcon
                  className="size-6 text-muted-foreground"
                  aria-hidden
                />
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate font-medium">
                  {item.title}
                </p>
                <Badge variant={STATUS_BADGE_VARIANT[item.status]}>
                  {ITEM_STATUS_LABEL[item.status]}
                </Badge>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {item.description}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(item.created_at)} · {item.images.length} 张照片
              </p>
            </div>
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href={"/me/items/" + item.id + "/pickups"} />}
            >
              <UsersIcon aria-hidden />
              查看认领人
            </Button>
            {published ? <MeItemActions itemId={item.id} /> : null}
          </div>
        </CardContent>
      </Card>
    </MeItemShell>
  )
}

/** 我的认领：整卡点进物品详情，信息不再内联。物品不可见时退化成不可点卡片。 */
function MyPickupCard({
  pickup,
  meta,
}: {
  pickup: Pickup
  meta: PickupItemMeta | undefined
}) {
  const card = (
    <Card size="sm" data-testid="me-pickup-card">
      <CardHeader>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <CardTitle className="truncate">
            {meta ? meta.title : "物品不可见"}
          </CardTitle>
          <Badge variant={meta ? STATUS_BADGE_VARIANT[meta.status] : "outline"}>
            {meta ? ITEM_STATUS_LABEL[meta.status] : "不可见"}
          </Badge>
        </div>
        <CardDescription>{formatDate(pickup.created_at)} 提交</CardDescription>
      </CardHeader>
    </Card>
  )

  if (!meta) return card

  return (
    <Link
      href={"/items/" + pickup.found_item_id}
      className="block min-w-0 active:scale-[0.99]"
    >
      {card}
    </Link>
  )
}

export default async function MePage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const supabase = await createClient()

  let data: MeData
  try {
    data = await loadMeData(supabase, user.id)
  } catch (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "请稍后重试"}
        </AlertDescription>
      </Alert>
    )
  }

  let profile: Profile | null = null
  try {
    profile = await getMyProfile(supabase, user.id)
  } catch {
    // 个人信息读不到不影响列表，入口退化成「填写个人信息」
  }

  const published =
    data.items.length === 0 ? (
      <Empty className="my-auto flex-none">
        <EmptyMedia variant="icon">
          <ImageIcon aria-hidden />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>还没有发布</EmptyTitle>
          <EmptyDescription>拍几张照片就能发布</EmptyDescription>
        </EmptyHeader>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/" />}
        >
          去失物墙
        </Button>
      </Empty>
    ) : (
      data.items.map((item) => <MyItemCard key={item.id} item={item} />)
    )

  const pickups =
    data.pickups.length === 0 ? (
      <Empty className="my-auto flex-none">
        <EmptyMedia variant="icon">
          <InboxIcon aria-hidden />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>还没有认领</EmptyTitle>
          <EmptyDescription>找到自己的物品，提交认领信息</EmptyDescription>
        </EmptyHeader>
      </Empty>
    ) : (
      data.pickups.map((pickup) => (
        <MyPickupCard
          key={pickup.id}
          pickup={pickup}
          meta={data.pickupItems[pickup.found_item_id]}
        />
      ))
    )

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-4">
      <PageTitle title="我的" />

      <ProfileCard profile={profile} action={<SignOutButton />} />

      <MeTabs
        publishedCount={data.items.length}
        pickupCount={data.pickups.length}
        published={published}
        pickups={pickups}
      />
    </div>
  )
}
