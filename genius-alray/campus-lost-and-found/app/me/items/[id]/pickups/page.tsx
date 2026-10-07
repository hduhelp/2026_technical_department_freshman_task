import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { UsersIcon } from "lucide-react"

import { PhoneLink } from "@/components/contact/phone-link"
import { PageTitle } from "@/components/nav/title-bar"
import { Badge } from "@/components/ui/badge"
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
import { getItem } from "@/lib/db/found-items"
import { listItemPickups } from "@/lib/db/pickups"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import { ITEM_STATUS_LABEL } from "@/lib/types"

import { MeItemActions } from "../../../me-item-actions"
import { STATUS_BADGE_VARIANT } from "../../../status-variant"

export const metadata: Metadata = {
  title: "认领人名单 · 校园失物招领",
}

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function formatDateTime(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return dateTimeFormatter.format(date)
}

export default async function ItemPickupsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const { id } = await params
  const supabase = await createClient()

  const item = await getItem(supabase, id)
  // 只有物品的拾主本人可以看认领人名单
  if (!item || item.owner_id !== user.id) notFound()

  const pickups = await listItemPickups(supabase, id)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-4">
      <PageTitle title="认领人" subtitle={item.title} />

      <div className="flex min-w-0 items-center gap-2">
        <Badge variant={STATUS_BADGE_VARIANT[item.status]}>
          {ITEM_STATUS_LABEL[item.status]}
        </Badge>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          认领后物品已标记为已认领，请与认领人核对后归还
        </p>
      </div>

      {item.status === "published" ? (
        <div className="flex flex-wrap items-center gap-2">
          <MeItemActions itemId={item.id} />
        </div>
      ) : null}

      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <h3 className="font-heading text-base font-semibold">
          认领人（{pickups.length}）
        </h3>
        {pickups.length === 0 ? (
          <Empty className="my-auto flex-none">
            <EmptyMedia variant="icon">
              <UsersIcon aria-hidden />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>还没有人认领</EmptyTitle>
              <EmptyDescription>
                认领后会显示认领人的姓名与手机号
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          pickups.map((pickup) => (
            <Card size="sm" key={pickup.id}>
              <CardHeader>
                <CardTitle className="truncate">{pickup.picker_name}</CardTitle>
                <CardDescription>
                  {formatDateTime(pickup.created_at)} 提交
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                {/* 统一的电话组件：蓝色图标+号码，点击先二次确认再拨号 */}
                <PhoneLink
                  phone={pickup.picker_phone}
                  testId={"picker-phone-" + pickup.id}
                />
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  )
}
