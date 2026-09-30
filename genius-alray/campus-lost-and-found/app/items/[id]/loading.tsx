import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function ItemDetailLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-4">
      <Skeleton className="aspect-4/3 w-full rounded-2xl" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-5 w-24 rounded-4xl" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-4 w-1/3" />
        <Card size="sm">
          <div className="flex flex-col gap-2 px-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-36" />
          </div>
        </Card>
      </div>
    </div>
  )
}
