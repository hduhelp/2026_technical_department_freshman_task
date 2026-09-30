import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/** 列表页底部的固定操作栏。用 footer 按钮而不是浮动按钮，位置固定、含义明确。 */
export function PostCtaBar() {
  return (
    <div className="sticky bottom-0 z-30 border-t bg-background/90 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur">
      <Button
        size="lg"
        className="h-11 w-full"
        render={<Link href="/post/lost" />}
      >
        <PlusIcon data-icon="inline-start" aria-hidden="true" />
        发布丢物启事
      </Button>
    </div>
  )
}
