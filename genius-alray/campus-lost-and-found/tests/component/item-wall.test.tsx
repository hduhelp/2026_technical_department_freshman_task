// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ItemWall } from "@/app/items/item-wall"
import type { ListedItem } from "@/lib/types"

// ItemWall 是客户端岛，但它 import 的 loadMoreItemsAction 来自 "use server" 模块；
// 在 vitest 里那会把整条服务端依赖链（含 server-only）拉进来。本文件只断言渲染分支，
// 所以直接把 action 换成替身。
vi.mock("@/app/items/actions", () => ({
  loadMoreItemsAction: vi.fn(),
}))

// 只需要一个能把 href / data-testid 原样透传的 <a>：这里不涉及真实路由跳转。
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}))

afterEach(cleanup)

const NO_ITEMS: ListedItem[] = []

/**
 * 匿名访客只给最新一页。
 * 回归背景：翻页 action 对未登录直接返回「请先登录」，但按钮一直渲染着 ——
 * 墙上超过一页时，匿名用户点一下就必然弹错。
 */
describe("失物墙的翻页入口", () => {
  it("未登录 + 还有更多：不给「加载更多」，改成去登录", () => {
    render(<ItemWall initialItems={NO_ITEMS} initialHasMore authed={false} />)

    expect(screen.queryByTestId("load-more")).toBeNull()
    expect(screen.getByTestId("wall-login-for-more")).toHaveAttribute(
      "href",
      "/login"
    )
  })

  it("已登录 + 还有更多：正常显示「加载更多」", () => {
    render(<ItemWall initialItems={NO_ITEMS} initialHasMore authed />)

    expect(screen.getByTestId("load-more")).toBeInTheDocument()
    expect(screen.queryByTestId("wall-login-for-more")).toBeNull()
  })

  it("未登录 + 没有更多：只说到底了，不出现登录引导", () => {
    render(
      <ItemWall initialItems={NO_ITEMS} initialHasMore={false} authed={false} />
    )

    expect(screen.queryByTestId("load-more")).toBeNull()
    expect(screen.queryByTestId("wall-login-for-more")).toBeNull()
    expect(screen.getByTestId("wall-no-more")).toBeInTheDocument()
  })
})
