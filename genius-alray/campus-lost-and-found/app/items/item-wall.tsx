"use client"

import Link from "next/link"
import { useState, useTransition } from "react"

import { StaggerItem, StaggerList } from "@/components/motion/primitives"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { ListedItem } from "@/lib/types"

import { loadMoreItemsAction } from "./actions"
import { ItemCard } from "./item-card"
import { ItemWallSkeletonCard } from "./item-wall-skeleton"

/**
 * 双列瀑布流 + 客户端分页。
 * 首屏由 Server Component 渲染，之后按 offset 递增向服务端要下一页；
 * 只有首屏卡片依次入场，翻页补进来的直接出现，避免越往后延迟越久。
 */
export function ItemWall({
  initialItems,
  initialHasMore,
  authed = true,
}: {
  initialItems: ListedItem[]
  initialHasMore: boolean
  /** 未登录时点卡片要先去登录 */
  authed?: boolean
}) {
  const [items, setItems] = useState<ListedItem[]>(initialItems)
  const [offset, setOffset] = useState(initialItems.length)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const firstScreenCount = initialItems.length

  function loadMore() {
    // 未登录不允许翻页（服务端也会拒绝，这里只是不给入口）
    if (!authed) return
    setError(null)
    startTransition(async () => {
      const result = await loadMoreItemsAction(offset)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id))
        return [...prev, ...result.items.filter((item) => !seen.has(item.id))]
      })
      setOffset((prev) => prev + result.items.length)
      setHasMore(result.hasMore)
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div data-testid="item-wall" className="min-w-0">
        <StaggerList className="columns-2 gap-3 [column-fill:balance]">
          {items.map((item, index) =>
            index < firstScreenCount ? (
              <StaggerItem key={item.id} className="mb-3 break-inside-avoid">
                <ItemCard item={item} authed={authed} />
              </StaggerItem>
            ) : (
              <div key={item.id} className="mb-3 break-inside-avoid">
                <ItemCard item={item} authed={authed} />
              </div>
            )
          )}
          {/* 翻页期间先占两张的位置：按钮的「加载中…」不足以说明瀑布流在长 */}
          {pending
            ? Array.from({ length: 2 }, (_, index) => (
                <ItemWallSkeletonCard
                  key={"pending-" + index}
                  index={index + 1}
                  testId="wall-loading-more"
                />
              ))
            : null}
        </StaggerList>
      </div>

      {error ? (
        <Alert variant="destructive" data-testid="wall-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {hasMore ? (
        authed ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            data-testid="load-more"
            disabled={pending}
            onClick={loadMore}
          >
            {pending ? "加载中…" : "加载更多"}
          </Button>
        ) : (
          // 未登录只展示最新一页：不给「加载更多」入口，改成去登录
          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            data-testid="wall-login-for-more"
            render={<Link href="/login" />}
          >
            登录后查看更多
          </Button>
        )
      ) : (
        <p
          className="py-1 text-center text-xs text-muted-foreground"
          data-testid="wall-no-more"
        >
          没有更多了
        </p>
      )}
    </div>
  )
}
