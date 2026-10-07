"use client"

import * as React from "react"
import { PhoneIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * 只读的电话展示：**电话图标 + 号码，蓝色，但不可点击**。
 * 用在「确认框里展示自己的信息」这类不该触发拨号的场景。
 */
export function PhoneText({
  phone,
  className,
}: {
  phone: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 text-blue-600 dark:text-blue-400",
        className
      )}
    >
      <PhoneIcon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-all">{phone}</span>
    </span>
  )
}

/**
 * 全站统一的电话号码展示：**电话图标 + 号码，蓝色**。
 * 点击先弹二次确认，再走 `tel:` 直接拨号（避免误触拨出）。
 * 所有展示电话号码的地方都必须用它，不要再写裸文本。
 */
export function PhoneLink({
  phone,
  className,
  testId = "phone-link",
}: {
  phone: string
  className?: string
  testId?: string
}) {
  const [open, setOpen] = React.useState(false)
  const tel = "tel:" + phone.replace(/[^0-9+]/g, "")

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex max-w-full min-w-0 items-center gap-1.5 text-left text-blue-600 underline-offset-4 hover:underline dark:text-blue-400",
          className
        )}
      >
        <PhoneIcon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 break-all">{phone}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-xs gap-4"
          data-testid="phone-call-dialog"
        >
          <DialogHeader>
            <DialogTitle>拨打电话</DialogTitle>
            <DialogDescription>{phone}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="phone-call-cancel"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              data-testid="phone-call-confirm"
              nativeButton={false}
              render={<a href={tel} />}
              onClick={() => setOpen(false)}
            >
              拨打
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
