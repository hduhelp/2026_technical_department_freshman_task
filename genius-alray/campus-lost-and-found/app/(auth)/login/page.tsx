import type { Metadata } from "next"
import Link from "next/link"

import { FadeIn } from "@/components/motion/primitives"

import { safeNextPath } from "../next-path"
import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: "登录 · 校园失物招领",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const params = await searchParams
  const raw = Array.isArray(params.next) ? params.next[0] : params.next
  const nextPath = safeNextPath(raw)

  return (
    <FadeIn>
      <div className="my-auto flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            登录
          </h1>
          <p className="text-sm text-muted-foreground">用手机号登录</p>
        </div>

        <LoginForm nextPath={nextPath} />

        <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
          <p>
            还没有账号？
            <Link
              href="/signup"
              className="ml-1 text-primary underline-offset-4 hover:underline"
            >
              去注册
            </Link>
          </p>
          <Link
            href="/"
            data-testid="browse-without-login"
            className="underline underline-offset-4 hover:text-foreground"
          >
            随便看看
          </Link>
        </div>
      </div>
    </FadeIn>
  )
}
