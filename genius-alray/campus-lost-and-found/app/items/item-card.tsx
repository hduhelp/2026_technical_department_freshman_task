import Link from "next/link"
import { ImageIcon } from "lucide-react"

import { SkeletonImage } from "@/components/media/skeleton-image"
import { ITEM_STATUS_LABEL, type ListedItem } from "@/lib/types"

import { formatDateTime } from "./format"

/**
 * 失物墙卡片：只展示图片、名称、描述（截断）与发布时间。
 * 已被认领的物品仍然留在墙上，用一个角标标出来；寻找失主中的不加任何标签。
 * 联系方式、位置、拾主用户名既不在数据里、也不在这里渲染。
 * 点击反馈走 CSS（active:scale），保持 Server Component。
 */
export function ItemCard({
  item,
  authed = true,
}: {
  item: ListedItem
  /** 未登录时点卡片先去登录（首屏信息流公开可看，详情要登录） */
  authed?: boolean
}) {
  const cover = item.images[0]
  const claimed = item.status === "claimed"
  const href = authed
    ? "/items/" + item.id
    : "/login?next=" + encodeURIComponent("/items/" + item.id)

  return (
    <Link
      href={href}
      data-testid="item-card"
      className="group block overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10 transition-[transform,scale,box-shadow] duration-200 hover:shadow-md active:scale-[0.98] motion-reduce:transition-none"
    >
      <div className="relative w-full overflow-hidden bg-muted">
        {cover?.url ? (
          // 加载中撑出占位比例 + 骨架，失败换成图标，绝不露破图与 alt 文本
          <SkeletonImage
            src={cover.url}
            alt={item.title}
            aspectClassName="aspect-[4/3]"
            testId="item-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-6" aria-hidden />
          </div>
        )}
        {claimed ? (
          <span className="absolute top-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-foreground ring-1 ring-foreground/10">
            {ITEM_STATUS_LABEL[item.status]}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium">{item.title}</h3>
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {item.description}
        </p>
        <time className="text-[11px] text-muted-foreground">
          {formatDateTime(item.created_at)}
        </time>
      </div>
    </Link>
  )
}
