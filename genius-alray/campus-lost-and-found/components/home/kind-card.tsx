import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function KindCard({
  href,
  title,
  description,
  icon: Icon,
  tone = "default",
}: {
  href: string
  title: string
  description: string
  icon: LucideIcon
  tone?: "default" | "primary"
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="flex-row items-center gap-4 px-4 py-4 transition-colors active:bg-muted">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-2xl",
            tone === "primary"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-heading text-base font-medium">{title}</span>
          <span className="text-sm text-muted-foreground">{description}</span>
        </span>
        <ChevronRightIcon
          className="size-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </Card>
    </Link>
  )
}
