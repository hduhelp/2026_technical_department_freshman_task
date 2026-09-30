import Link from "next/link"
import { PackageSearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center p-4">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageSearchIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>没有找到这个页面</EmptyTitle>
          <EmptyDescription>
            帖子可能已经被删除了，或者链接不对。
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            size="lg"
            className="h-11 w-full"
            render={<Link href="/items" />}
          >
            去看看帖子列表
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
