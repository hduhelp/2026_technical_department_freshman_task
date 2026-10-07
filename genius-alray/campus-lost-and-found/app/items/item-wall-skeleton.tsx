import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * 瀑布流骨架：**故意用几种不同的宽高比**模仿真实卡片的错落。
 * 图片真实宽高比要等下载完才知道（数据库里没有尺寸列），
 * 所以这里给的是「看起来像瀑布流」的占位，而不是一列整齐的方块。
 */
const ASPECTS = [
  "aspect-[4/5]",
  "aspect-square",
  "aspect-[3/4]",
  "aspect-[4/3]",
  "aspect-[5/4]",
]

/** 单张占位卡片（要嵌进已有的 columns 容器时用它，免得另起一个多列块） */
export function ItemWallSkeletonCard({
  index = 0,
  testId,
}: {
  index?: number
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      aria-hidden
      className="mb-3 break-inside-avoid overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10"
    >
      <Skeleton
        className={cn("w-full rounded-none", ASPECTS[index % ASPECTS.length])}
      />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}

/** 首屏骨架：自带双列容器，用于 app/loading.tsx */
export function ItemWallSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      data-testid="wall-skeleton"
      aria-hidden
      className="columns-2 gap-3 [column-fill:balance]"
    >
      {Array.from({ length: count }, (_, index) => (
        <ItemWallSkeletonCard key={index} index={index} />
      ))}
    </div>
  )
}
