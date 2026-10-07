// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SkeletonImage } from "@/components/media/skeleton-image"

afterEach(cleanup)

/**
 * 图片三态：加载中要有骨架撑住位置，失败要换成图标 + 说明。
 * 最要紧的一条：**任何状态都不许露出浏览器的破图与 alt 文本**。
 */
describe("SkeletonImage", () => {
  it("加载中：骨架撑住位置，图片不可见", () => {
    render(<SkeletonImage src="/a.png" alt="物品照片" testId="cover" />)

    expect(screen.getByTestId("cover-skeleton")).toBeInTheDocument()
    expect(screen.queryByTestId("cover-error")).toBeNull()
    expect(screen.getByAltText("物品照片").className).toContain("opacity-0")
  })

  it("加载完成：骨架消失、图片淡入", () => {
    render(<SkeletonImage src="/a.png" alt="物品照片" testId="cover" />)

    fireEvent.load(screen.getByAltText("物品照片"))

    expect(screen.queryByTestId("cover-skeleton")).toBeNull()
    expect(screen.getByAltText("物品照片").className).toContain("opacity-100")
  })

  it("加载失败：换成图标 + 说明，图片保持隐藏（不显示破图与 alt 文本）", () => {
    render(<SkeletonImage src="/a.png" alt="物品照片" testId="cover" />)

    fireEvent.error(screen.getByAltText("物品照片"))

    expect(screen.queryByTestId("cover-skeleton")).toBeNull()
    expect(screen.getByTestId("cover-error")).toHaveTextContent(
      "图片暂时无法显示"
    )
    expect(screen.getByAltText("物品照片").className).toContain("opacity-0")
  })

  it("errorText 传 null：只留图标（小缩略图用）", () => {
    render(
      <SkeletonImage
        src="/a.png"
        alt="缩略图"
        testId="thumb"
        errorText={null}
      />
    )

    fireEvent.error(screen.getByAltText("缩略图"))

    expect(screen.getByTestId("thumb-error")).toBeInTheDocument()
    expect(screen.getByTestId("thumb-error")).not.toHaveTextContent(
      "图片暂时无法显示"
    )
  })

  it("缓存命中（不会再触发 onLoad）也能收敛到已加载，骨架不会一直挂着", () => {
    // jsdom 里的 img 永远不会真的加载：把 complete / naturalWidth 打桩成「已缓存」
    const complete = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "complete"
    )
    const naturalWidth = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "naturalWidth"
    )
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => true,
    })
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 800,
    })

    try {
      render(<SkeletonImage src="/cached.png" alt="缓存图" testId="cached" />)

      expect(screen.queryByTestId("cached-skeleton")).toBeNull()
      expect(screen.getByAltText("缓存图").className).toContain("opacity-100")
    } finally {
      if (complete)
        Object.defineProperty(HTMLImageElement.prototype, "complete", complete)
      if (naturalWidth)
        Object.defineProperty(
          HTMLImageElement.prototype,
          "naturalWidth",
          naturalWidth
        )
    }
  })
})
