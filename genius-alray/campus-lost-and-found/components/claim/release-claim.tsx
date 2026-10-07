"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { releaseClaimAction } from "@/app/items/actions"

/**
 * 「拿错了，不是我的」：撤回认领。
 * 记录保留，之后还能再认领；若还有别人在认领，物品仍保持「已认领」。
 */
export function ReleaseClaim({ itemId }: { itemId: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function run() {
    startTransition(async () => {
      const result = await releaseClaimAction(itemId)
      if (result.ok) {
        toast.add({ type: "success", title: result.message })
        setOpen(false)
        router.replace("/items/" + itemId)
        return
      }
      toast.add({ type: "error", title: result.message })
    })
  }

  return (
    <>
      <button
        type="button"
        data-testid="claim-release-open"
        onClick={() => setOpen(true)}
        className="text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
      >
        领错了？
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-xs gap-4"
          data-testid="claim-release-confirm"
        >
          <DialogHeader>
            <DialogTitle>撤回认领？</DialogTitle>
            <DialogDescription>
              你会退出认领人名单；如果还有其他人认领，物品会保持「已认领」，
              没有别人才回到「寻找失主中」。你提交的认领信息会保留，之后仍可以再认领。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="claim-release-cancel"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              data-testid="claim-release-ok"
              disabled={pending}
              onClick={run}
            >
              {pending ? "撤回中…" : "确认撤回"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
