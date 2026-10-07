import { redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/supabase/server"

/** 只负责鉴权；标题栏由 app/template.tsx 统一提供，页面各自管内容。 */
export default async function MeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return children
}
