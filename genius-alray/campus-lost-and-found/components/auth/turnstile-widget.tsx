"use client"

import { useEffect, useRef, useState } from "react"

import { publicEnv } from "@/lib/public-env"

/**
 * Cloudflare Turnstile 人机校验（登录 / 注册）。
 *
 * 【为什么需要它】账号 = 手机号，而产品不做短信验证码，注册时也没有任何
 * 人机门槛：脚本可以批量注册、批量占用手机号（phone 是唯一的，被占的真人
 * 反而注册不了）。Supabase Auth 支持在开启 CAPTCHA 保护后强制校验，
 * 这里负责在页面上把挑战渲染出来、拿到 token 交给 Server Action。
 *
 * 【站点密钥为空时整块消失】NEXT_PUBLIC_TURNSTILE_SITE_KEY 为空是本地开发与
 * 自动化测试的常态（本地 Supabase 没开 CAPTCHA）。此时组件不渲染、不注入
 * 第三方脚本、表单也照常提交 —— 测试环境不依赖外网。
 *
 * 这里手写而不是装 @marsidev/react-turnstile：需要的只有「渲染一次 + 能 reset」，
 * 为此多一个运行时依赖（其内部实现同样是注入这段脚本）不划算。
 */

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      theme?: "auto" | "light" | "dark"
      language?: string
      callback?: (token: string) => void
      "error-callback"?: () => void
      "expired-callback"?: () => void
    }
  ) => string
  reset: (widgetId?: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

let scriptPromise: Promise<TurnstileApi> | null = null

/** 脚本只注入一次；失败时把缓存清掉，用户刷新后还能重试 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile)
      return
    }
    const script = document.createElement("script")
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error("Turnstile 脚本没有暴露 API"))
    }
    script.onerror = () => reject(new Error("Turnstile 脚本加载失败"))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    scriptPromise = null
    throw error
  })

  return scriptPromise
}

type Props = {
  /** 拿到 token / token 失效时回调（失效传 null，此时禁止提交） */
  onToken: (token: string | null) => void
  /**
   * 「换一张新挑战」的信号：Turnstile 的令牌是一次性的，提交过一次就作废，
   * 用户第二次提交会一直卡在「校验已失效」。
   *
   * 父组件把 useActionState 的 state 原样传进来即可 —— 每次动作结束都是
   * 新对象引用，于是每失败一次就自动换一张。这里只做引用比较，
   * 不需要（也不该）在父组件里用 effect + setState 去维护计数器。
   */
  resetSignal: unknown
}

export function TurnstileWidget({ onToken, resetSignal }: Props) {
  const siteKey = publicEnv.turnstileSiteKey
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  // 回调放进 ref：父组件每次渲染都会传新函数，不该因此重渲染挑战。
  // （在 effect 里同步而不是渲染期直接赋值 —— 渲染期写 ref 是 React 明令禁止的。）
  const onTokenRef = useRef(onToken)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    const container = containerRef.current
    if (!siteKey || !container) return
    let disposed = false

    loadTurnstile()
      .then((api) => {
        if (disposed) return
        widgetIdRef.current = api.render(container, {
          sitekey: siteKey,
          theme: "auto",
          language: "zh-cn",
          callback: (token) => onTokenRef.current(token),
          "error-callback": () => onTokenRef.current(null),
          "expired-callback": () => onTokenRef.current(null),
        })
        setStatus("ready")
      })
      .catch(() => {
        if (disposed) return
        setStatus("error")
        onTokenRef.current(null)
      })

    return () => {
      disposed = true
      const widgetId = widgetIdRef.current
      widgetIdRef.current = null
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey])

  const lastSignalRef = useRef(resetSignal)
  useEffect(() => {
    // 首次挂载时引用相同 → 不动；之后每次动作结果变化都换一张新挑战
    if (lastSignalRef.current === resetSignal) return
    lastSignalRef.current = resetSignal
    const widgetId = widgetIdRef.current
    if (widgetId && window.turnstile) window.turnstile.reset(widgetId)
    onTokenRef.current(null)
  }, [resetSignal])

  if (!siteKey) return null

  return (
    <div className="flex flex-col gap-1">
      <div ref={containerRef} data-testid="turnstile" />
      {status === "loading" ? (
        <p className="text-xs text-muted-foreground">正在加载人机校验…</p>
      ) : null}
      {status === "error" ? (
        <p className="text-xs text-destructive">
          人机校验加载失败，请检查网络后刷新页面重试
        </p>
      ) : null}
    </div>
  )
}
