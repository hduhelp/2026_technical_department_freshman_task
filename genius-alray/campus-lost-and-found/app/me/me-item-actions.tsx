"use client"

import * as React from "react"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { UndoIcon } from "lucide-react"
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

import { withdrawItemAction } from "./actions"
import { useMeItemClose } from "./me-item-shell"

/** 拾主操作：撤单（仅未被认领时可用）。危险操作，必须二次确认。 */
export function MeItemActions({ itemId }: { itemId: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = useTransition()
  // 卡片外层（MeItemShell）注册的淡出回调；不在列表里时为 null
  const closeCard = useMeItemClose()

  function run() {
    startTransition(async () => {
      const result = await withdrawItemAction(itemId)
      if (result.ok) {
        toast.add({ type: "success", title: result.message })
        setOpen(false)
        closeCard?.()
        router.refresh()
      } else {
        toast.add({ type: "error", title: result.message })
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-destructive hover:text-destructive"
        data-testid="withdraw-open"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        <UndoIcon aria-hidden />
        撤单
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-xs gap-4"
          data-testid="withdraw-confirm"
        >
          <DialogHeader>
            <DialogTitle>撤单？</DialogTitle>
            <DialogDescription>
              撤单后这条招领会从失物墙上消失，无法再被认领。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="withdraw-cancel"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="withdraw-ok"
              disabled={pending}
              onClick={run}
            >
              {pending ? "撤单中…" : "确认撤单"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
