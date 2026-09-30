"use client"

import { useEffect } from "react"
import { TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[app] 页面渲染出错", error)
  }, [error])

  return (
    <div className="flex flex-1 items-center p-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>页面出错了</EmptyTitle>
          <EmptyDescription>
            可能是网络或数据库暂时不可用，稍后再试一次。
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="lg" className="h-11 w-full" onClick={() => reset()}>
            重试
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
