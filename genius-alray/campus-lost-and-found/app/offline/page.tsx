import type { Metadata } from "next"
import { WifiOffIcon } from "lucide-react"

import { OfflineRetry } from "./offline-retry"

export const metadata: Metadata = {
  title: "当前没有网络连接 · 校园失物招领",
}

/**
 * 离线回退页：Service Worker 在导航请求断网时返回的就是这一页。
 * 它是**纯静态**的（不读库、不读登录态），所以能被安全地预缓存。
 * 路由不进 title-bar 的 ROUTES，因此这里没有标题栏 —— 也回不去，正常。
 */
export default function OfflinePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <WifiOffIcon className="size-7" aria-hidden />
      </div>
      <h1 className="font-heading text-lg font-semibold">当前没有网络连接</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        这是存在手机本地的离线页。网络恢复后重新加载，就能继续浏览失物墙。
      </p>
      <OfflineRetry />
    </div>
  )
}
