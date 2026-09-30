import Link from "next/link"

import { Button } from "@/components/ui/button"
import { KIND_LABELS } from "@/lib/constants"
import { toItemsHref, type ItemsQuery } from "@/lib/items-url"

/**
 * 类型切换与筛选 chip。
 * 全部是服务端渲染的链接：可预取、可后退、可分享，零客户端状态。
 */
export function ListFilters({
  query,
  isLoggedIn,
}: {
  query: ItemsQuery
  isLoggedIn: boolean
}) {
  const tabs: { key: ItemsQuery["kind"]; label: string }[] = [
    { key: null, label: "全部" },
    { key: "lost", label: KIND_LABELS.lost },
    { key: "found", label: KIND_LABELS.found },
  ]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {tabs.map((tab) => {
          const active = query.kind === tab.key
          return (
            <Button
              key={tab.label}
              size="sm"
              variant={active ? "default" : "outline"}
              aria-current={active ? "page" : undefined}
              render={
                <Link href={toItemsHref({ kind: tab.key, page: 1 }, query)} />
              }
            >
              {tab.label}
            </Button>
          )
        })}
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={query.includeResolved ? "secondary" : "ghost"}
          aria-pressed={query.includeResolved}
          render={
            <Link
              href={toItemsHref(
                { includeResolved: !query.includeResolved, page: 1 },
                query
              )}
            />
          }
        >
          含已找回
        </Button>

        {isLoggedIn ? (
          <Button
            size="sm"
            variant={query.mine ? "secondary" : "ghost"}
            aria-pressed={query.mine}
            render={
              <Link href={toItemsHref({ mine: !query.mine, page: 1 }, query)} />
            }
          >
            只看我发布的
          </Button>
        ) : null}
      </div>
    </div>
  )
}
