"use client"

import * as React from "react"

/**
 * 顶部状态栏「防闪」。
 *
 * 【为什么需要】Next 每次客户端路由切换都会把 <head> 里由 metadata / viewport 生成的
 * 元信息整体**移除再重建**（实测一次跳转会 remove + add `theme-color`、
 * `apple-mobile-web-app-status-bar-style`、`link[rel=manifest]` 等全部标签）。
 * 独立窗口（已装到桌面）里这一瞬间浏览器看不到 theme-color，就退回 manifest 的
 * theme_color —— 表现为「页面之间跳转时顶部状态栏闪一下白」。
 *
 * 【做法】把决定状态栏颜色的几个 meta 复制一份，用原生 DOM 挂到 <head> 末尾：
 * 它们不归 React 管，路由切换时不会被移除，于是渲染端始终看得见状态栏颜色。
 * 复制的内容与原元信息逐字一致，谁生效结果都一样。
 */
const MIRRORED_META: Array<{ name: string; content: string; media?: string }> =
  [
    {
      name: "theme-color",
      media: "(prefers-color-scheme: light)",
      content: "#ffffff",
    },
    {
      name: "theme-color",
      media: "(prefers-color-scheme: dark)",
      content: "#0a0a0a",
    },
    {
      name: "apple-mobile-web-app-status-bar-style",
      content: "default",
    },
  ]

const KEEPER_ATTR = "data-status-bar-keeper"

export function StatusBarKeeper() {
  React.useEffect(() => {
    for (const spec of MIRRORED_META) {
      const media = spec.media
        ? '[media="' + spec.media + '"]'
        : ":not([media])"
      const selector =
        'meta[name="' + spec.name + '"][' + KEEPER_ATTR + "]" + media
      // 开发环境 StrictMode 会跑两次 effect；已经镜像过就跳过
      if (document.head.querySelector(selector)) continue

      const meta = document.createElement("meta")
      meta.setAttribute("name", spec.name)
      if (spec.media) meta.setAttribute("media", spec.media)
      meta.setAttribute("content", spec.content)
      meta.setAttribute(KEEPER_ATTR, "true")
      document.head.appendChild(meta)
    }
  }, [])

  return null
}
