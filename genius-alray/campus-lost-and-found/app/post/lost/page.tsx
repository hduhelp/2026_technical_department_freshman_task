import { redirect } from "next/navigation"
import type { Metadata } from "next"

import { PostForm } from "@/components/post/post-form"
import { SetupNotice } from "@/components/setup-notice"
import { hasSupabaseConfig } from "@/lib/env"
import { getCurrentUser } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "发布丢物启事" }

export default async function PostLostPage() {
  if (!hasSupabaseConfig()) return <SetupNotice />

  const user = await getCurrentUser()
  if (!user) redirect("/login?next=" + encodeURIComponent("/post/lost"))

  return <PostForm kind="lost" />
}
