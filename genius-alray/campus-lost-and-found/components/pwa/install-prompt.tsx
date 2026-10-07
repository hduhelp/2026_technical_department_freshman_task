"use client"

import * as React from "react"
import { DownloadIcon, ShareIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Chrome / Edge 的安装事件不在 TS 的 DOM 类型里，按最小可用形状声明 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

type InstallContextValue = {
  /** 浏览器已经给出可安装事件（能调用原生安装弹窗） */
  canPrompt: boolean
  /** 已经在独立窗口里跑 / 收到过 appinstalled */
  installed: boolean
  promptInstall: () => Promise<void>
}

/* ---------- 只读浏览器状态：用 useSyncExternalStore 读，避免「effect 里 setState」 */

/**
 * 服务端渲染与首次 hydration 一律拿 serverSnapshot（都是「不知道」），
 * 之后 React 自己会用客户端快照再渲染一次 —— 既没有水合不一致，
 * 也不需要「挂载后再 setState」那种写法。
 */
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false

const isStandaloneClient = () =>
  (typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches) ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true

const isIosSafariClient = () => {
  const { userAgent, maxTouchPoints } = window.navigator
  if (/iPhone|iPad|iPod/.test(userAgent)) return true
  // iPadOS 13+ 的 Safari 自称 Macintosh，只能靠触摸点数认出来
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1
}

const InstallContext = React.createContext<InstallContextValue | null>(null)

/**
 * 安装能力的提供者：**拦截**浏览器的自动安装提示，改由我们自己的按钮触发。
 *
 * 【为什么必须挂在根布局】beforeinstallprompt 只会在「可安装且还没装」时触发一次，
 * 而且可能发生在用户落在任何一页的时候；若监听写在首页按钮里，从详情页进来的
 * 用户就永远拿不到这个事件。
 *
 * 【为什么要 preventDefault】默认行为是浏览器自己挑时机弹一条安装提示；这里拦掉，
 * 让「装不装」由用户在首页标题栏的按钮上决定。
 */
export function PwaInstallProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const deferredRef = React.useRef<BeforeInstallPromptEvent | null>(null)
  const [canPrompt, setCanPrompt] = React.useState(false)
  const [justInstalled, setJustInstalled] = React.useState(false)
  const installed =
    React.useSyncExternalStore(subscribeNoop, isStandaloneClient, getFalse) ||
    justInstalled

  React.useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      deferredRef.current = event as BeforeInstallPromptEvent
      setCanPrompt(true)
    }
    const onInstalled = () => {
      deferredRef.current = null
      setCanPrompt(false)
      setJustInstalled(true)
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  const promptInstall = React.useCallback(async () => {
    const deferred = deferredRef.current
    if (!deferred) return
    // 这个事件只能用一次：先清掉，免得用户连点时抛错
    deferredRef.current = null
    setCanPrompt(false)
    await deferred.prompt()
    await deferred.userChoice
  }, [])

  const value = React.useMemo(
    () => ({ canPrompt, installed, promptInstall }),
    [canPrompt, installed, promptInstall]
  )

  return (
    <InstallContext.Provider value={value}>{children}</InstallContext.Provider>
  )
}

export function usePwaInstall(): InstallContextValue | null {
  return React.useContext(InstallContext)
}

/**
 * 首页标题栏里的「安装应用」按钮（在头像旁边）。
 * 没得装（浏览器不给安装事件、也不是 iOS）时直接不渲染，不留空位。
 */
export function InstallAppButton() {
  const install = usePwaInstall()
  const mounted = React.useSyncExternalStore(subscribeNoop, getTrue, getFalse)
  const ios = React.useSyncExternalStore(
    subscribeNoop,
    isIosSafariClient,
    getFalse
  )
  const [guideOpen, setGuideOpen] = React.useState(false)

  if (!mounted || !install || install.installed) return null

  const canPrompt = install.canPrompt
  // 既没有原生安装事件、又不是 iOS Safari：这台设备装不了，按钮不出现
  if (!canPrompt && !ios) return null

  return (
    <>
      <button
        type="button"
        data-testid="install-app"
        onClick={() => {
          if (canPrompt) {
            void install.promptInstall()
            return
          }
          setGuideOpen(true)
        }}
        className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/80 active:scale-95 motion-reduce:transition-none"
      >
        {canPrompt ? (
          <DownloadIcon className="size-3.5" aria-hidden />
        ) : (
          <ShareIcon className="size-3.5" aria-hidden />
        )}
        安装应用
      </button>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent
          className="max-w-xs gap-3"
          data-testid="install-ios-dialog"
        >
          <DialogHeader>
            <DialogTitle>安装到桌面</DialogTitle>
            <DialogDescription>
              点 Safari 底部的「分享」，再选「添加到主屏幕」，就能像 App
              一样打开。
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  )
}
