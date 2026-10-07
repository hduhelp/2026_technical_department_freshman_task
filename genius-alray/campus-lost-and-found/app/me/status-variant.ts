import type { ItemStatus } from "@/lib/types"

/** 状态徽标配色：寻找失主中=主色，已认领=次级，已撤单=描边。 */
export const STATUS_BADGE_VARIANT: Record<
  ItemStatus,
  "default" | "secondary" | "outline"
> = {
  published: "default",
  claimed: "secondary",
  withdrawn: "outline",
}
