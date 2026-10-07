// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * 发布入口的导航中状态（第 15 轮）。
 *
 * 弱网下点「我捡到了东西」要等一两秒才有反应，所以按钮必须在导航一开始
 * 就切成「正在打开…」+ 转圈。这里把两个分支都钉死。
 * （useLinkStatus 的真实行为由 Next 保证，这里只验证我们对它的使用。）
 */
const linkStatus = vi.hoisted(() => ({ pending: false }))

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: linkStatus.pending }),
}))

import { PublishEntryContent } from "@/app/(wall)/publish-entry"

// vitest 没开 globals，@testing-library 的自动 cleanup 不会注册 —— 不手动清，
// 上一条渲染出来的 DOM 会留在 document 里，让「断言某段文案不存在」的用例永远失败。
afterEach(cleanup)

describe("发布入口的导航中状态", () => {
  it("导航中：显示转圈与「正在打开…」", () => {
    linkStatus.pending = true
    render(<PublishEntryContent label="我捡到了东西" />)

    expect(screen.getByText("正在打开…")).toBeTruthy()
    expect(screen.queryByText("我捡到了东西")).toBeNull()
  })

  it("平时：显示加号与原文案", () => {
    linkStatus.pending = false
    render(<PublishEntryContent label="我捡到了东西" />)

    expect(screen.getByText("我捡到了东西")).toBeTruthy()
    expect(screen.queryByText("正在打开…")).toBeNull()
  })
})
