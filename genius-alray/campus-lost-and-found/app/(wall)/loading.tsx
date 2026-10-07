import { Skeleton } from "@/components/ui/skeleton"

import { ItemWallSkeleton } from "../items/item-wall-skeleton"

/**
 * 失物墙首屏骨架（`/` 是 force-dynamic，首屏一定会经过这里）。
 * 结构与 page.tsx 对齐：发布按钮 + 双列瀑布流，数据到位时不至于整页跳一下。
 *
 * 注意它只挂在 `(wall)` 路由组下：放根目录会包住所有路由，
 * 详情页的 notFound() 会因为流式响应已发出 200 而退化成 200。
 */
export default function HomeLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-5">
      <Skeleton className="h-12 w-full rounded-4xl" />
      <ItemWallSkeleton />
    </div>
  )
}
