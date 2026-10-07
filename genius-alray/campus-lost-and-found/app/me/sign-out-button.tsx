"use client"

import * as React from "react"
import { LogOutIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { signOutAction } from "./actions"

/** 退出登录：danger 样式 + 二次确认 */
export function SignOutButton() {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0 text-destructive hover:text-destructive"
        data-testid="sign-out"
        onClick={() => setOpen(true)}
      >
        <LogOutIcon aria-hidden />
        退出
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-xs gap-4"
          data-testid="sign-out-confirm"
        >
          <DialogHeader>
            <DialogTitle>退出登录？</DialogTitle>
            <DialogDescription>下次需要用手机号重新登录。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="sign-out-cancel"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <form action={signOutAction}>
              <Button
                type="submit"
                variant="destructive"
                data-testid="sign-out-ok"
                className="w-full"
              >
                退出登录
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
