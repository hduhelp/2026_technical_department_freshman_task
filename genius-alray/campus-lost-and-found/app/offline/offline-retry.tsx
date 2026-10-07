"use client"

import { Button } from "@/components/ui/button"

/** 离线页唯一可做的事：重新加载（网络恢复后就能回到正常页面） */
export function OfflineRetry() {
  return (
    <Button
      type="button"
      data-testid="offline-retry"
      className="w-full"
      onClick={() => window.location.reload()}
    >
      重新加载
    </Button>
  )
}
