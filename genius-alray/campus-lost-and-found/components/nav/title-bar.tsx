"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { ChevronLeftIcon, UserRoundIcon } from "lucide-react"

import { DURATION, EASE_OUT } from "@/components/motion/primitives"
import { InstallAppButton } from "@/components/pwa/install-prompt"
import { cn } from "@/lib/utils"

/**
 * 全站唯一的标题栏（AppBar）。
 *
 * 由 app/template.tsx 统一挂在每个页面之上，所以**页面里不要再自己画标题栏**。
 * 标题与返回目标默认按路由推导（见 ROUTES）；只有「标题依赖数据」的页面
 * （例如物品详情要用物品名称）才需要用 <PageTitle/> 覆盖一次。
 *
 * 路由切换时标题会做一次轻量的淡入上移，让层级变化看得见。
 */
export type TitleBarConfig = {
  title: string
  subtitle?: string
  backHref?: string
  backLabel?: string
  backTestId?: string
  /** 客户端自定义返回行为（多步向导退回上一步），优先级高于 backHref */
  onBack?: () => void
  showMe?: boolean
}

/** 这些路由不显示标题栏（登录/注册是扁平页） */
const HIDDEN_ROUTES = [/^\/login$/, /^\/signup$/]

const ROUTES: Array<(pathname: string) => TitleBarConfig | null> = [
  (p) => (p === "/" ? { title: "失物招领墙", showMe: true } : null),
  (p) => (p === "/publish" ? { title: "发布招领", backHref: "/" } : null),
  (p) => {
    const m = p.match(/^\/items\/([^/]+)\/claim$/)
    return m
      ? {
          title: "认领信息",
          backHref: "/items/" + m[1],
          backLabel: "返回物品",
          backTestId: "pickup-cancel",
        }
      : null
  },
  (p) => {
    const m = p.match(/^\/items\/([^/]+)$/)
    return m
      ? {
          title: "物品详情",
          backHref: "/",
          backLabel: "返回失物墙",
          backTestId: "item-back",
        }
      : null
  },
  (p) => (p === "/terms" ? { title: "服务条款", backHref: "/signup" } : null),
  (p) => (p === "/privacy" ? { title: "隐私政策", backHref: "/signup" } : null),
  (p) => (p === "/me" ? { title: "我的", backHref: "/" } : null),
  (p) => (p === "/me/profile" ? { title: "我的信息", backHref: "/me" } : null),
  (p) =>
    /^\/me\/items\/[^/]+\/pickups$/.test(p)
      ? { title: "认领人", backHref: "/me" }
      : null,
]

/** 页面的覆盖值优先，但 undefined 的字段保留路由默认值 */
function mergeConfig(
  base: TitleBarConfig | null,
  override: TitleBarConfig
): TitleBarConfig {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) merged[key] = value
  }
  return merged as unknown as TitleBarConfig
}

function resolveRoute(pathname: string): TitleBarConfig | null {
  for (const resolve of ROUTES) {
    const config = resolve(pathname)
    if (config) return config
  }
  return null
}

type Override = { path: string; config: TitleBarConfig }

const TitleBarContext = React.createContext<{
  set: (config: TitleBarConfig | null) => void
} | null>(null)

/**
 * 页面用它覆盖标题栏（标题依赖数据、或需要自定义返回行为时）。
 * 渲染 null —— 它只负责把配置送进标题栏。
 */
export function PageTitle(props: TitleBarConfig) {
  const context = React.useContext(TitleBarContext)
  const { title, subtitle, backHref, backLabel, backTestId, showMe, onBack } =
    props
  const set = context?.set

  // 用 layout effect（客户端）避免「先闪一下路由默认标题、再变成数据标题」
  const useIsomorphicLayoutEffect =
    typeof window === "undefined" ? React.useEffect : React.useLayoutEffect

  useIsomorphicLayoutEffect(() => {
    if (!set) return
    set({ title, subtitle, backHref, backLabel, backTestId, showMe, onBack })
    return () => set(null)
    // onBack 放进依赖是安全的：provider 状态变化时它的 children 元素引用不变，
    // React 会跳过 children 子树的重渲染，所以不会形成「effect → setState → effect」循环。
  }, [set, title, subtitle, backHref, backLabel, backTestId, showMe, onBack])

  return null
}

function BackControl({
  config,
  className,
}: {
  config: TitleBarConfig
  className: string
}) {
  if (config.onBack) {
    return (
      <button
        type="button"
        aria-label={config.backLabel ?? "返回"}
        data-testid={config.backTestId}
        onClick={config.onBack}
        className={className}
      >
        <ChevronLeftIcon className="size-5" aria-hidden />
      </button>
    )
  }
  if (!config.backHref) return null
  return (
    <Link
      href={config.backHref}
      aria-label={config.backLabel ?? "返回"}
      data-testid={config.backTestId}
      className={className}
    >
      <ChevronLeftIcon className="size-5" aria-hidden />
    </Link>
  )
}

export function TitleBarProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [override, setOverride] = React.useState<Override | null>(null)

  // 记下「这次覆盖属于哪个路由」，避免上一页的标题残留一帧。
  // 直接用 pathname 作为依赖（不在 render 期写 ref）。
  const set = React.useCallback(
    (config: TitleBarConfig | null) => {
      setOverride(config ? { path: pathname, config } : null)
    },
    [pathname]
  )

  const value = React.useMemo(() => ({ set }), [set])
  const base = resolveRoute(pathname)
  // 只认「当前路由」的覆盖值，避免上一页的标题残留一帧；
  // 覆盖值与路由默认值**逐字段合并**：页面只想改标题时，不必重复写返回目标。
  const config =
    override?.path === pathname ? mergeConfig(base, override.config) : base
  const hidden = HIDDEN_ROUTES.some((route) => route.test(pathname))

  if (hidden || !config) {
    return (
      <TitleBarContext.Provider value={value}>
        {children}
      </TitleBarContext.Provider>
    )
  }

  return (
    <TitleBarContext.Provider value={value}>
      <header
        data-testid="title-bar"
        className="sticky top-0 z-40 flex min-w-0 items-center gap-3 bg-background/85 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70"
      >
        <BackControl
          config={config}
          className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h1
              key={config.title}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              className={cn(
                "truncate font-heading text-lg font-semibold tracking-tight"
              )}
            >
              {config.title}
            </motion.h1>
          </AnimatePresence>
          {config.subtitle ? (
            <p className="truncate text-xs text-muted-foreground">
              {config.subtitle}
            </p>
          ) : null}
        </div>

        {config.showMe ? (
          <div className="flex shrink-0 items-center gap-2">
            {/* 能装且还没装时才渲染；装到桌面后自己消失 */}
            <InstallAppButton />
            <Link
              href="/me"
              aria-label="我的"
              data-testid="me-entry"
              title="我的"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-accent active:scale-95"
            >
              <UserRoundIcon className="size-5" aria-hidden />
            </Link>
          </div>
        ) : null}
      </header>
      {children}
    </TitleBarContext.Provider>
  )
}
