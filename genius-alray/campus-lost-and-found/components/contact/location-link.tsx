"use client"

import * as React from "react"
import { MapPinIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  amapMarkerTarget,
  amapSearchTarget,
  launchAmapApp,
  planAmapLaunch,
} from "@/lib/geo"
import { cn } from "@/lib/utils"

/**
 * 全站统一的位置展示：**定位图标 + 位置文字，蓝色**。
 * 点击弹二次确认，确认后用高德地图打开（有坐标就标记点，只有描述就搜索）。
 * 有坐标时会先把 WGS84 转成 GCJ-02，见 `lib/geo.ts`。
 * 手机端直接唤起高德 App 的 scheme / intent（**一步**进 App），不再经过高德网页版
 * 那个还要再点一次的中间页；桌面端与内嵌浏览器才走网页版。
 *
 * 【为什么不显示经纬度】用户看不懂「31.23042, 121.47370」，也不该把它读出来：
 * 控件文案固定为「查看定位」，位置详情放在二次确认框里，坐标只用来生成地图链接。
 */
export function LocationLink({
  label,
  lat,
  lng,
  className,
  testId = "location-link",
  children,
}: {
  label?: string | null
  lat?: number | null
  lng?: number | null
  className?: string
  testId?: string
  children?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const hasCoords = typeof lat === "number" && typeof lng === "number"
  /** 位置详情（人话描述）：展示在确认框里，不展示经纬度 */
  const detail = label?.trim() ?? ""
  const hasTarget = hasCoords || detail.length > 0

  const target = hasCoords
    ? amapMarkerTarget({ lat, lng, label: detail || undefined })
    : detail
      ? amapSearchTarget(detail)
      : null
  /** 确认按钮的 href 固定是网页版：无 JS、桌面端、内嵌浏览器都靠它兜底 */
  const url = target?.web ?? ""

  /** 控件文案固定为「查看定位」：用户看不懂、也不该看到经纬度 */
  const linkText = hasTarget ? "查看定位" : "未填写位置"
  const dialogText =
    detail || (hasCoords ? "已在地图上标出大致位置" : "拾主未填写位置详情")

  /**
   * 打开高德地图。
   *
   * - 手机上的普通浏览器：拦掉默认行为，直接跳高德 App 的 scheme / intent，**一步**进
   *   App（高德网页版只是「先落地、再点一次」的中间页）；没装 App 时由 `launchAmapApp`
   *   兜底回网页版，不会卡在空白页；
   * - 桌面端、微信/QQ 内嵌浏览器、鸿蒙等：保持 `<a target="_blank">` 的默认行为，
   *   新标签打开高德网页版。
   *
   * 事件只用到 preventDefault，所以不绑元素类型：Base UI 的 Button 渲染成 <a>，
   * 但它声明的事件类型是 button 的，绑死 HTMLAnchorElement 过不了类型检查。
   */
  function handleOpen(event: { preventDefault: () => void }) {
    if (!target) return
    const plan = planAmapLaunch({ userAgent: navigator.userAgent, target })
    if (plan.kind === "web") {
      // 桌面端 / 内嵌浏览器：先让浏览器把新标签开出去，再收起确认框
      // （默认行为之前卸载掉这个 <a> 有被浏览器忽略导航的风险）
      window.setTimeout(() => setOpen(false), 0)
      return
    }
    event.preventDefault()
    setOpen(false)
    launchAmapApp(plan)
  }

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex max-w-full min-w-0 items-start gap-1.5 text-left text-blue-600 underline-offset-4 hover:underline dark:text-blue-400",
          className
        )}
      >
        <MapPinIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{children ?? linkText}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-xs gap-4"
          data-testid="map-open-dialog"
        >
          <DialogHeader>
            <DialogTitle>在地图中查看</DialogTitle>
            <DialogDescription>{dialogText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="map-open-cancel"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            {url ? (
              <Button
                data-testid="map-open-confirm"
                nativeButton={false}
                render={<a href={url} target="_blank" rel="noreferrer" />}
                onClick={handleOpen}
              >
                打开高德地图
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
