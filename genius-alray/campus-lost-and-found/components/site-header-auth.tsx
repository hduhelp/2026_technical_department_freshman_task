import Link from "next/link"

import { Button } from "@/components/ui/button"
import { logoutAction } from "@/lib/actions/auth"
import { getProfile } from "@/lib/data/profiles"
import {
  getCurrentUser,
  tryCreateSupabaseServerClient,
} from "@/lib/supabase/server"

export async function SiteHeaderAuth() {
  const user = await getCurrentUser()

  if (!user) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" render={<Link href="/login" />}>
          登录
        </Button>
        <Button size="sm" render={<Link href="/register" />}>
          注册
        </Button>
      </div>
    )
  }

  const supabase = await tryCreateSupabaseServerClient()
  const profile = supabase ? await getProfile(supabase, user.id) : null

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      <span className="max-w-24 truncate text-sm text-muted-foreground">
        {profile?.username ?? "已登录"}
      </span>
      <form action={logoutAction}>
        <Button variant="outline" size="sm" type="submit">
          退出
        </Button>
      </form>
    </div>
  )
}
