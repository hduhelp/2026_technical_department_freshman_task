import { cache } from "react"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { ImageOffIcon, MapPinIcon, ClockIcon, UserIcon } from "lucide-react"

import { StatusBadge } from "@/components/items/status-badge"
import { SetupNotice } from "@/components/setup-notice"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { setItemStatusAction } from "@/lib/actions/items"
import { KIND_LABELS } from "@/lib/constants"
import { getItem, getItemContact } from "@/lib/data/items"
import { hasSupabaseConfig } from "@/lib/env"
import { formatDateTime, formatRelativeTime } from "@/lib/format"
import { publicPhotoUrl } from "@/lib/storage"
import {
  createSupabaseServerClient,
  getCurrentUser,
} from "@/lib/supabase/server"

/** 同一个请求里 generateMetadata 与页面各调一次，用 cache 去重，只查一趟。 */
const loadItem = cache(async (id: string) => {
  const supabase = await createSupabaseServerClient()
  return getItem(supabase, id)
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  if (!hasSupabaseConfig()) return { title: "帖子详情" }
  const { id } = await params
  const item = await loadItem(id).catch(() => null)
  return { title: item ? item.title : "帖子不存在" }
}

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string }>
}) {
  if (!hasSupabaseConfig()) return <SetupNotice />

  const { id } = await params
  const item = await loadItem(id)
  if (!item) notFound()

  const [{ created }, user] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ])

  // 联系方式由 RLS 把关：未登录时这里查不到任何行
  const supabase = await createSupabaseServerClient()
  const contact = user ? await getItemContact(supabase, item.id) : null

  const isOwner = user?.id === item.user_id
  const photo = publicPhotoUrl(item.image_path)

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-4">
      {created ? (
        <Alert>
          <AlertTitle>发布成功</AlertTitle>
          <AlertDescription>你的帖子已经出现在列表里了。</AlertDescription>
        </Alert>
      ) : null}

      <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl bg-muted">
        {photo ? (
          <Image
            src={photo}
            alt={item.title}
            fill
            sizes="(max-width: 480px) 100vw, 480px"
            priority
            className="object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <ImageOffIcon className="size-8" aria-hidden="true" />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <h1 className="flex-1 font-heading text-lg font-semibold text-balance">
            {item.title}
          </h1>
          <StatusBadge status={item.status} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={item.kind === "lost" ? "secondary" : "outline"}>
            {KIND_LABELS[item.kind]}
          </Badge>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <UserIcon className="size-3.5" aria-hidden="true" />
            {item.username}
          </span>
        </div>

        <Separator />

        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <dt className="inline-flex items-center gap-1 text-muted-foreground">
              <MapPinIcon className="size-4" aria-hidden="true" />
              地点
            </dt>
            <dd className="flex-1">{item.location}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="inline-flex items-center gap-1 text-muted-foreground">
              <ClockIcon className="size-4" aria-hidden="true" />
              时间
            </dt>
            <dd className="flex-1">
              {formatDateTime(item.happened_at)}
              <span className="ml-1 text-xs text-muted-foreground">
                （{formatRelativeTime(item.happened_at)}）
              </span>
            </dd>
          </div>
        </dl>

        {item.description ? (
          <p className="text-sm/relaxed whitespace-pre-wrap">
            {item.description}
          </p>
        ) : null}
      </div>

      <ContactSection
        contact={contact}
        isLoggedIn={Boolean(user)}
        itemId={item.id}
      />

      {isOwner ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>这是你发布的帖子</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={setItemStatusAction}>
              <input type="hidden" name="id" value={item.id} />
              <input
                type="hidden"
                name="status"
                value={item.status === "open" ? "resolved" : "open"}
              />
              <Button
                type="submit"
                variant={item.status === "open" ? "default" : "outline"}
                size="lg"
                className="h-11 w-full"
              >
                {item.status === "open" ? "标记为已找回" : "重新打开"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function ContactSection({
  contact,
  isLoggedIn,
  itemId,
}: {
  contact: string | null
  isLoggedIn: boolean
  itemId: string
}) {
  if (contact) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>联系方式</CardTitle>
        </CardHeader>
        <CardContent className="text-sm break-words">{contact}</CardContent>
      </Card>
    )
  }

  if (!isLoggedIn) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>联系方式</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <span>登录后可见发布者留下的联系方式。</span>
          <Button
            variant="outline"
            size="lg"
            className="h-11 w-full"
            render={
              <Link
                href={"/login?next=" + encodeURIComponent("/items/" + itemId)}
              />
            }
          >
            去登录
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>联系方式</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        发布者没有留联系方式，可以尝试在列表里找找有没有更接近的帖子。
      </CardContent>
    </Card>
  )
}
