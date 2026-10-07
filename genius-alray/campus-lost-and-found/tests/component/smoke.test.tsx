// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

describe("组件测试骨架", () => {
  it("jsdom 环境下可以渲染", () => {
    render(<p>测试</p>)
    expect(screen.getByText("测试")).toBeInTheDocument()
  })
})
