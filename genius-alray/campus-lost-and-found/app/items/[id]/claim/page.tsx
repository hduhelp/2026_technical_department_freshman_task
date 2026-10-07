import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { ContactIcon, MapPinIcon } from "lucide-react"

import { LocationLink } from "@/components/contact/location-link"
import { PhoneLink, PhoneText } from "@/components/contact/phone-link"
import { PageTitle } from "@/components/nav/title-bar"
import { ReleaseClaim } from "@/components/claim/release-claim"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getItem, revealContact } from "@/lib/db/found-items"
import { getMyPickup, listItemClaimers } from "@/lib/db/pickups"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import type { RevealedContact } from "@/lib/types"

import { formatDateTime } from "../../format"

export const metadata: Metadata = {
  title: "认领信息 · 校园失物招领",
}

export const dynamic = "force-dynamic"

const GUIDES = [
  "联系拾主，核对物品细节",
  "确认无误后当面取回",
  "拿错了请立刻联系拾主归还",
]

/** 认领成功后的独立一屏：认领指引 + 拾主联系方式/位置 + 其他认领人 */
export default async function ClaimInfoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const { id } = await params
  const supabase = await createClient()

  const item = await getItem(supabase, id)
  if (!item) notFound()

  const pickup = await getMyPickup(supabase, id, user.id)
  // 没认领过（或已撤回）的人不该停在这一屏
  if (!pickup || item.status !== "claimed") redirect("/items/" + id)

  let revealed: RevealedContact | null = null
  try {
    revealed = await revealContact(supabase, id)
  } catch {
    revealed = null
  }

  let others: Awaited<ReturnType<typeof listItemClaimers>> = []
  try {
    others = (await listItemClaimers(supabase, id)).filter(
      (claimer) => claimer.picker_id !== user.id
    )
  } catch {
    others = []
  }

  const hasCoords =
    revealed !== null &&
    revealed.location_lat !== null &&
    revealed.location_lng !== null
  const isInPlace = revealed?.custody === "in_place"

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 px-4 py-5">
      <PageTitle title="认领信息" />

      <ol data-testid="claim-guide" className="flex flex-col gap-2 text-sm">
        {GUIDES.map((guide, index) => (
          <li key={guide} className="flex gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
              {index + 1}
            </span>
            <span className="min-w-0 text-muted-foreground">{guide}</span>
          </li>
        ))}
      </ol>

      <section data-testid="pickup-revealed" className="flex flex-col gap-2">
        <h2 className="text-sm text-muted-foreground">
          {isInPlace ? "物品所在位置" : "拾主的联系方式"}
        </h2>
        {isInPlace ? (
          hasCoords || revealed?.location_label ? (
            <div data-testid="reveal-location">
              <LocationLink
                label={revealed?.location_label ?? null}
                lat={revealed?.location_lat ?? null}
                lng={revealed?.location_lng ?? null}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              拾主未填写位置信息，请等拾主联系你。
            </p>
          )
        ) : revealed?.contact ? (
          <div data-testid="reveal-contact">
            <PhoneLink phone={revealed.contact} className="text-base" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">拾主未填写联系方式。</p>
        )}
      </section>

      {others.length > 0 ? (
        <Alert variant="destructive" data-testid="claim-others">
          <AlertTitle>还有 {others.length} 个人也认领了</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>多人认领时请直接联系对方协商，避免重复取走同一件物品。</span>
            {others.map((claimer) => (
              <span
                key={claimer.picker_id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                <ContactIcon className="size-4 shrink-0" aria-hidden />
                <span className="font-medium">{claimer.picker_name}</span>
                <PhoneLink
                  phone={claimer.picker_phone}
                  testId="claim-other-phone"
                />
              </span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-2 text-sm" data-testid="claim-info">
        <h2 className="text-sm text-muted-foreground">我的认领</h2>
        <span className="flex items-center gap-1.5">
          <ContactIcon className="size-4 shrink-0" aria-hidden />
          <span data-testid="claim-info-name">{pickup.picker_name}</span>
        </span>
        <PhoneText phone={pickup.picker_phone} />
        <span className="text-xs text-muted-foreground">
          {formatDateTime(pickup.created_at)} 提交
        </span>
      </section>

      <Alert data-testid="claim-release">
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <MapPinIcon className="size-4 shrink-0" aria-hidden />
          <span>物品已标记为已认领。</span>
          <ReleaseClaim itemId={item.id} />
        </AlertDescription>
      </Alert>
    </div>
  )
}
