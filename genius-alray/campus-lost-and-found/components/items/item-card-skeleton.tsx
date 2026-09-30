import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function ItemCardSkeleton() {
  return (
    <Card className="flex-row items-stretch gap-3 p-3">
      <Skeleton className="size-20 shrink-0 rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-5 w-24 rounded-4xl" />
      </div>
    </Card>
  )
}

export function ItemListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {Array.from({ length: count }, (_, index) => (
        <ItemCardSkeleton key={index} />
      ))}
    </div>
  )
}
