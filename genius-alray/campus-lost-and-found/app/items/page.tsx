import { Suspense } from "react"
import type { Metadata } from "next"
import { PackageSearchIcon } from "lucide-react"

import { ItemCard } from "@/components/items/item-card"
import { ItemListSkeleton } from "@/components/items/item-card-skeleton"
import { ListFilters } from "@/components/items/list-filters"
import { Pagination } from "@/components/items/pagination"
import { PostCtaBar } from "@/components/items/post-cta-bar"
import { SearchForm } from "@/components/items/search-form"
import { SetupNotice } from "@/components/setup-notice"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { listItems } from "@/lib/data/items"
import { hasSupabaseConfig } from "@/lib/env"
import {
  parseItemsQuery,
  type ItemsQuery,
  type RawSearchParams,
} from "@/lib/items-url"
import {
  createSupabaseServerClient,
  getCurrentUser,
} from "@/lib/supabase/server"

export const metadata: Metadata = { title: "帖子列表" }

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  if (!hasSupabaseConfig()) return <SetupNotice />

  const query = parseItemsQuery(await searchParams)
  const user = await getCurrentUser()

  // 未登录时忽略「只看我发布的」，避免出现空列表还没法解释
  const effectiveQuery: ItemsQuery =
    query.mine && !user ? { ...query, mine: false } : query

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-14 z-30 flex flex-col gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <SearchForm query={effectiveQuery} />
        <ListFilters query={effectiveQuery} isLoggedIn={Boolean(user)} />
      </div>

      {/* 筛选条件变化时重建边界，骨架立即出现，数据到了再替换 */}
      <Suspense
        key={JSON.stringify(effectiveQuery)}
        fallback={<ItemListSkeleton />}
      >
        <ItemList query={effectiveQuery} userId={user?.id ?? null} />
      </Suspense>

      <PostCtaBar />
    </div>
  )
}

async function ItemList({
  query,
  userId,
}: {
  query: ItemsQuery
  userId: string | null
}) {
  const supabase = await createSupabaseServerClient()
  const { rows, page, pageCount, total } = await listItems(supabase, {
    q: query.q,
    kind: query.kind,
    includeResolved: query.includeResolved,
    onlyUser: query.mine ? userId : null,
    page: query.page,
  })

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageSearchIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>没有找到相关帖子</EmptyTitle>
            <EmptyDescription>
              {query.q
                ? "换个关键词试试，或者放宽筛选条件。"
                : "这个分类下还没有帖子，你可以成为第一个。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="px-4 py-3 text-xs text-muted-foreground">共 {total} 条</p>
      <div className="flex flex-col gap-3 px-4">
        {rows.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
      <Pagination query={query} page={page} pageCount={pageCount} />
    </div>
  )
}
