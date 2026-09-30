import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toItemsHref, type ItemsQuery } from "@/lib/items-url"

export function Pagination({
  query,
  page,
  pageCount,
}: {
  query: ItemsQuery
  page: number
  pageCount: number
}) {
  if (pageCount <= 1) return null

  return (
    <nav
      aria-label="分页"
      className="flex items-center justify-between gap-3 px-4 pb-3"
    >
      {page > 1 ? (
        <Button
          variant="outline"
          size="lg"
          className="h-11"
          render={<Link href={toItemsHref({ page: page - 1 }, query)} />}
        >
          <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
          上一页
        </Button>
      ) : (
        <span />
      )}

      <span className="text-sm text-muted-foreground">
        第 {page} / {pageCount} 页
      </span>

      {page < pageCount ? (
        <Button
          variant="outline"
          size="lg"
          className="h-11"
          render={<Link href={toItemsHref({ page: page + 1 }, query)} />}
        >
          下一页
          <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      ) : (
        <span />
      )}
    </nav>
  )
}
