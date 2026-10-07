import { Skeleton } from "@/components/ui/skeleton"

export default function MeLoading() {
  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <Skeleton className="h-14 w-full rounded-2xl" />
      <Skeleton className="h-9 w-full rounded-4xl" />
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-foreground/10"
        >
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-8 w-28 rounded-4xl" />
        </div>
      ))}
    </div>
  )
}
