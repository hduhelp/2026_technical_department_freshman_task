import { Badge } from "@/components/ui/badge"
import { STATUS_LABELS } from "@/lib/constants"
import type { ItemStatus } from "@/lib/supabase/types"

export function StatusBadge({ status }: { status: ItemStatus }) {
  if (status === "resolved") {
    return <Badge variant="outline">{STATUS_LABELS.resolved}</Badge>
  }
  return <Badge variant="secondary">{STATUS_LABELS.open}</Badge>
}
