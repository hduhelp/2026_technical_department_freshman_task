"use client"

import * as React from "react"

/**
 * 注册 Service Worker（见 public/sw.js）。
 *
 * 【为什么只在生产构建里注册】开发环境下 SW 会缓存自己那一份资源，
 * HMR 之后浏览器可能仍然在用旧代码，「改动不生效」的假象极难排查；
 * 而且 E2E 跑的是 `pnpm dev`，注册 SW 会让测试结果随机漂移。
 * 所以：`next dev` 不注册，`next build && next start` 才注册。
 */
export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (!("serviceWorker" in navigator)) return

    const register = () => {
      // 失败不影响页面可用：http 访问、无痕模式、企业策略都可能拒掉 SW
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {})
    }

    if (document.readyState === "complete") {
      register()
      return
    }
    window.addEventListener("load", register, { once: true })
    return () => window.removeEventListener("load", register)
  }, [])

  return null
}
