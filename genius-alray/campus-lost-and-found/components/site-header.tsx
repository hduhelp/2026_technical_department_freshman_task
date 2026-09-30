import { Suspense } from "react"
import Link from "next/link"

import { SiteHeaderAuth } from "@/components/site-header-auth"
import { Skeleton } from "@/components/ui/skeleton"
import { SITE_NAME } from "@/lib/constants"

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="truncate text-base font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {SITE_NAME}
        </Link>
        {/*
          会话相关部分单独放进 Suspense：
          页面骨架可以立刻输出，登录态晚一点到也不影响首屏。
        */}
        <Suspense fallback={<Skeleton className="h-8 w-20 rounded-4xl" />}>
          <SiteHeaderAuth />
        </Suspense>
      </div>
    </header>
  )
}
