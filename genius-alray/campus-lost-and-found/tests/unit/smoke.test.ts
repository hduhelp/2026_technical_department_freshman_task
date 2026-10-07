import { describe, expect, it } from "vitest"

describe("测试骨架", () => {
  it("node 环境下可以运行", () => {
    expect(typeof process.version).toBe("string")
  })
})
