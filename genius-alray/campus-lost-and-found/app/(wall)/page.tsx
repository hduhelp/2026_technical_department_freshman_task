import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  getAppConfig,
  listImagesForItems,
  listWallItems,
  mergeImages,
} from "@/lib/db/found-items"
import { createSignedUrlMap } from "@/lib/storage/signed"
import { createClient, getCurrentUser } from "@/lib/supabase/server"

import { ItemWall } from "../items/item-wall"

import { PublishEntryContent } from "./publish-entry"

export const metadata: Metadata = {
  title: "失物墙 · 校园失物招领",
  description: "看看有没有你丢的东西。",
}

export const dynamic = "force-dynamic"

/**
 * 放在 `(wall)` 路由组里，只为把首屏骨架（同目录的 loading.tsx）**限制在 "/"**：
 * 根目录的 app/loading.tsx 会包住所有子路由（含 not-found），
 * 页面里再抛 notFound() 时状态码已经发出去了，404 会变成 200。
 */
export default async function HomePage() {
  // 【第 7 轮】未登录也能刷信息流；点进详情才要求登录
  const user = await getCurrentUser()
  const authed = Boolean(user)

  const supabase = await createClient()

  // 每页条数一律来自数据库 app_config，不接受客户端传入
  const config = await getAppConfig(supabase)
  const pageSize = Math.max(config?.page_size ?? 20, 1)

  const items = await listWallItems(supabase, {
    limit: pageSize,
    offset: 0,
  })
  const images = await listImagesForItems(
    supabase,
    items.map((item) => item.id)
  )
  const urlByPath = await createSignedUrlMap(
    images.map((image) => image.storage_path)
  )
  const listed = mergeImages(items, images, urlByPath)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-5">
      <Button
        size="lg"
        className="h-12 w-full text-base"
        nativeButton={false}
        render={<Link href={authed ? "/publish" : "/login?next=%2Fpublish"} />}
        data-testid="publish-entry"
      >
        <PublishEntryContent label="我捡到了东西" />
      </Button>

      {listed.length === 0 ? (
        <Empty data-testid="wall-empty" className="my-auto flex-none">
          <EmptyHeader>
            <EmptyTitle>还没有人发布</EmptyTitle>
            <EmptyDescription>捡到东西就发布一条。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemWall
          initialItems={listed}
          initialHasMore={items.length >= pageSize}
          authed={authed}
        />
      )}
    </div>
  )
}
