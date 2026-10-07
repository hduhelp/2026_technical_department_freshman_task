"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ContactIcon, HandHeartIcon } from "lucide-react"

import { PhoneText } from "@/components/contact/phone-link"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Profile } from "@/lib/types"

import { createPickupAction } from "../actions"

/**
 * 详情页底部的认领入口。
 *
 * 认领的**二次确认发生在点击时**：弹「诚信认领」确认框（只读展示自己的姓名与手机号），
 * 确认后才写入，然后把用户送到独立的「认领信息」屏看指引与拾主联系方式。
 * 物品已被别人认领时也允许认领（认领只是登记，归属靠线下协商）。
 */
export function ClaimActions({
  itemId,
  profile,
  claimedByMe,
  alreadyClaimedByOther = false,
}: {
  itemId: string
  profile: Profile | null
  claimedByMe: boolean
  alreadyClaimedByOther?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  const infoPath = "/items/" + itemId + "/claim"

  if (claimedByMe) {
    return (
      <Button
        size="lg"
        className="h-12 w-full text-base"
        nativeButton={false}
        render={<Link href={infoPath} />}
        data-testid="pickup-view-info"
      >
        <HandHeartIcon aria-hidden />
        查看认领信息
      </Button>
    )
  }

  function confirm() {
    setError(null)
    startTransition(async () => {
      // 只提交物品 id：姓名与手机号由服务端从 profiles 取，客户端伪造不了
      const result = await createPickupAction({ itemId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      // 直接跳转：认领成功后详情页会立刻变成已认领状态，
      // 再等 900ms 的对勾反而会因为组件切换分支被卸载而丢掉定时器。
      router.push(infoPath)
    })
  }

  return (
    <>
      <Button
        size="lg"
        className="h-12 w-full text-base"
        data-testid="pickup-open"
        disabled={pending}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <HandHeartIcon aria-hidden />
        {alreadyClaimedByOther ? "我也要认领" : "这是我的，我要认领"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="gap-4"
          data-testid="claim-confirm"
        >
          <DialogHeader>
            <DialogTitle>诚信认领</DialogTitle>
            <DialogDescription>
              请确认这是你本人的物品。冒领会占用失主的找回机会；错拿请及时联系拾主，偷窃需承担法律责任。
            </DialogDescription>
          </DialogHeader>

          {/* 只读展示：这里不能交互（避免给自己拨号） */}
          <div
            data-testid="claim-confirm-profile"
            className="flex flex-col gap-1.5 rounded-2xl bg-muted/60 px-3 py-2 text-sm select-none"
          >
            <span className="text-xs text-muted-foreground">
              将提交你的信息
            </span>
            <span className="flex items-center gap-1.5">
              <ContactIcon className="size-4 shrink-0" aria-hidden />
              <span data-testid="claim-confirm-name">{profile?.real_name}</span>
            </span>
            {profile?.phone ? <PhoneText phone={profile.phone} /> : null}
          </div>

          {error ? (
            <Alert variant="destructive" data-testid="claim-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="claim-confirm-cancel"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              data-testid="claim-confirm-ok"
              disabled={pending}
              onClick={confirm}
            >
              {pending ? "正在认领…" : "我确认认领"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
