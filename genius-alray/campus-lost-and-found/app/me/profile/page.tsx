import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageTitle } from "@/components/nav/title-bar"
import { getMyProfile } from "@/lib/db/profiles"
import { createClient, getCurrentUser } from "@/lib/supabase/server"

import { ProfileForm } from "./profile-form"

export const metadata: Metadata = {
  title: "我的信息 · 校园失物招领",
}

export const dynamic = "force-dynamic"

/** 只接受站内相对路径，避免被当成开放重定向 */
function safeNext(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null
  return value
}

export default async function MeProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const params = await searchParams
  const nextPath = safeNext(params.next)

  const supabase = await createClient()
  const profile = await getMyProfile(supabase, user.id)

  return (
    <div className="flex min-w-0 flex-1 flex-col px-4 py-4">
      {/* 从认领流程进来时（?next=/items/xxx），返回键应该回到那个物品，而不是「我的」 */}
      <PageTitle title="我的信息" backHref={nextPath ?? "/me"} />
      <ProfileForm
        defaultName={profile?.real_name ?? ""}
        defaultPhone={profile?.phone ?? ""}
        nextPath={nextPath}
      />
    </div>
  )
}
