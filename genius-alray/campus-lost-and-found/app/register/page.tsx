import { redirect } from "next/navigation"
import type { Metadata } from "next"

import { RegisterForm } from "@/components/auth/register-form"
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

export const metadata: Metadata = { title: "注册" }

export default async function RegisterPage({
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
          <CardTitle>注册</CardTitle>
          <CardDescription>只需要一个用户名和密码，不用邮箱。</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm next={next} />
        </CardContent>
      </Card>
    </div>
  )
}
