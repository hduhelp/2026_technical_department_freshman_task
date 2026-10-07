// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { StatusBarKeeper } from "@/components/pwa/status-bar-keeper"

const KEEPER = "meta[data-status-bar-keeper]"

afterEach(() => {
  cleanup()
  // 镜像出来的节点不归 React 管，cleanup 不会删掉它们，得手动清
  document.head.querySelectorAll(KEEPER).forEach((node) => node.remove())
  document.head
    .querySelectorAll('meta[name="theme-color"]:not([data-status-bar-keeper])')
    .forEach((node) => node.remove())
})

/**
 * 回归守卫：Next 每次客户端路由切换都会把 <head> 里自己那批元信息移除再重建，
 * 独立窗口里这一瞬间会掉回 manifest 的兜底色 —— 也就是用户报的「状态栏闪白」。
 */
describe("StatusBarKeeper", () => {
  it("把浅色/深色 theme-color 与 iOS 状态栏样式镜像到 head", () => {
    render(<StatusBarKeeper />)

    const themeColors = [
      ...document.head.querySelectorAll(
        'meta[data-status-bar-keeper][name="theme-color"]'
      ),
    ]
    expect(themeColors.map((meta) => meta.getAttribute("media"))).toEqual([
      "(prefers-color-scheme: light)",
      "(prefers-color-scheme: dark)",
    ])
    expect(themeColors.map((meta) => meta.getAttribute("content"))).toEqual([
      "#ffffff",
      "#0a0a0a",
    ])
    expect(
      document.head
        .querySelector(
          'meta[data-status-bar-keeper][name="apple-mobile-web-app-status-bar-style"]'
        )
        ?.getAttribute("content")
    ).toBe("default")
  })

  it("Next 重建 <head> 之后 theme-color 依然在（闪白的就是这一帧）", () => {
    // 先摆两个「归 React 管」的 theme-color，模拟 metadata / viewport 生成的那对
    for (const [media, color] of [
      ["(prefers-color-scheme: light)", "#ffffff"],
      ["(prefers-color-scheme: dark)", "#0a0a0a"],
    ]) {
      const meta = document.createElement("meta")
      meta.setAttribute("name", "theme-color")
      meta.setAttribute("media", media)
      meta.setAttribute("content", color)
      document.head.appendChild(meta)
    }

    render(<StatusBarKeeper />)

    // 模拟路由切换：Next 把自己那批元信息全部移除（随后才重新插入）
    document.head
      .querySelectorAll(
        'meta[name="theme-color"]:not([data-status-bar-keeper])'
      )
      .forEach((node) => node.remove())

    expect(
      document.head.querySelectorAll('meta[name="theme-color"]').length
    ).toBeGreaterThan(0)
    expect(document.head.querySelectorAll(KEEPER)).toHaveLength(3)
  })

  it("重复挂载不会重复插入（StrictMode 会把 effect 跑两次）", () => {
    render(<StatusBarKeeper />)
    cleanup()
    render(<StatusBarKeeper />)
    expect(document.head.querySelectorAll(KEEPER)).toHaveLength(3)
  })
})
