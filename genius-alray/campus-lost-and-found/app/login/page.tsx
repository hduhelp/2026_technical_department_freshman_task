import { redirect } from "next/navigation"
import type { Metadata } from "next"

import { LoginForm } from "@/components/auth/login-form"
import { SetupNotice } from "@/components/setup-notice"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { hasSupabaseConfig } from "@/lib/env"
import { safeNextPath } from "@/lib/navigation"
import { getCurrentUser } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "登录" }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  if (!hasSupabaseConfig()) return <SetupNotice />

  const next = safeNextPath((await searchParams).next)
  const user = await getCurrentUser()
  if (user) redirect(next)

  return (
    <div className="flex flex-1 items-center px-4 py-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>用注册时的用户名和密码登录。</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} />
        </CardContent>
      </Card>
    </div>
  )
}
