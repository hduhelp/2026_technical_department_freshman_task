import { ItemListSkeleton } from "@/components/items/item-card-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

export default function ItemsLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b px-4 py-3">
        <Skeleton className="h-11 w-full rounded-4xl" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-16 rounded-4xl" />
          <Skeleton className="h-8 w-16 rounded-4xl" />
          <Skeleton className="h-8 w-16 rounded-4xl" />
        </div>
      </div>
      <ItemListSkeleton />
    </div>
  )
}
