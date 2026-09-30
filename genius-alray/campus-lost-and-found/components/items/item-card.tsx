import Image from "next/image"
import Link from "next/link"
import { ImageOffIcon } from "lucide-react"

import { StatusBadge } from "@/components/items/status-badge"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { KIND_LABELS } from "@/lib/constants"
import { formatRelativeTime } from "@/lib/format"
import { publicPhotoUrl } from "@/lib/storage"
import type { ItemListRow } from "@/lib/supabase/types"

export function ItemCard({ item }: { item: ItemListRow }) {
  const photo = publicPhotoUrl(item.image_path)

  return (
    <Link
      href={"/items/" + item.id}
      className="block rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="flex-row items-stretch gap-3 p-3 transition-colors active:bg-muted">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
          {photo ? (
            <Image
              src={photo}
              alt={item.title}
              fill
              sizes="80px"
              className="object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-muted-foreground">
              <ImageOffIcon className="size-5" aria-hidden="true" />
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <span className="line-clamp-2 flex-1 text-sm font-medium">
              {item.title}
            </span>
            <StatusBadge status={item.status} />
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {item.location} · {formatRelativeTime(item.happened_at)}
          </span>
          <div className="flex items-center gap-2">
            <Badge variant={item.kind === "lost" ? "secondary" : "outline"}>
              {KIND_LABELS[item.kind]}
            </Badge>
            <span className="truncate text-xs text-muted-foreground">
              {item.username}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  )
}
