import { describe, expect, it } from "vitest"
import { createUploads } from "../helpers/fixtures"
import { createTestContext } from "../helpers/supabase"

/**
 * RPC 契约守卫（防止 PostgREST 函数匹配语义再次翻车）
 *
 * 背景：PostgREST 按「请求体里出现的参数名」匹配函数。
 * 若 RPC 的可选参数没有 DEFAULT，而调用方（lib/db）用 undefined 让 supabase-js
 * 丢掉这些键，就会得到 PGRST202（Could not find the function ...）。
 * 本项目已经在 publish_found_item 上踩过一次。
 *
 * 做法：对每个 RPC 只传「必填」参数调用一次，断言：
 *   - 不出现 PGRST202 / 42883（函数未找到 / 不存在于 schema cache）
 *   - 也不出现 42P13 之类的签名错误
 * 允许出现业务错误（22023 参数不合法、P0002 记录不存在等）——
 * 那恰好证明函数被成功解析并执行了。
 */

const NOT_FOUND_CODES = new Set(["PGRST202", "42883"])

function expectResolved(
  error: { code?: string; message: string } | null | undefined
) {
  if (!error) return
  expect(
    NOT_FOUND_CODES.has(error.code ?? ""),
    "RPC 未能被 PostgREST 解析：" + error.code + " " + error.message
  ).toBe(false)
}

describe("RPC 契约守卫：只给必填参数也能被解析", () => {
  it("get_app_config()：无参数调用成功并返回配置", async () => {
    const ctx = createTestContext()
    try {
      const user = await ctx.user("cfg")
      const result = await user.client.rpc("get_app_config", {})
      expectResolved(result.error)
      expect(result.error).toBeNull()
      expect(result.data?.[0]?.max_photos).toBe(3)
      expect(result.data?.[0]?.page_size).toBe(20)
    } finally {
      await ctx.cleanup()
    }
  }, 60_000)

  it("publish_found_item：只给 title/description/custody（其余走 DEFAULT）→ 业务错误而非 PGRST202", async () => {
    const ctx = createTestContext()
    try {
      const user = await ctx.user("pub")
      const result = await user.client.rpc("publish_found_item", {
        p_title: "契约守卫",
        p_description: "只给必填参数",
        p_custody: "kept",
      } as never)
      expectResolved(result.error)
      // kept 缺 contact → 22023（证明函数被解析并执行到了校验逻辑）
      expect(result.error?.code).toBe("22023")
    } finally {
      await ctx.cleanup()
    }
  }, 60_000)

  it("create_pickup：只给物品 id → P0002 而不是 PGRST202", async () => {
    const ctx = createTestContext()
    try {
      const user = await ctx.user("pick")
      const result = await user.client.rpc("create_pickup", {
        p_item_id: crypto.randomUUID(),
      })
      expectResolved(result.error)
      expect(result.error?.code).toBe("P0002")
    } finally {
      await ctx.cleanup()
    }
  }, 60_000)

  it("consume_ai_quota：无参数调用返回配额结果，而不是 PGRST202", async () => {
    const ctx = createTestContext()
    try {
      const user = await ctx.user("quota")
      const result = await user.client.rpc("consume_ai_quota", {})
      expectResolved(result.error)
      expect(result.error).toBeNull()
      expect(result.data?.[0]?.out_allowed).toBe(true)
      expect(result.data?.[0]?.out_limit).toBe(10)
    } finally {
      await ctx.cleanup()
    }
  }, 60_000)

  it("withdraw_found_item：只给物品 id → P0002 而不是 PGRST202", async () => {
    const ctx = createTestContext()
    try {
      const user = await ctx.user("close")
      const result = await user.client.rpc("withdraw_found_item", {
        p_item_id: crypto.randomUUID(),
      })
      expectResolved(result.error)
      expect(result.error?.code).toBe("P0002")
    } finally {
      await ctx.cleanup()
    }
  }, 60_000)

  it("reveal_found_item_contact：只给物品 id → P0002 而不是 PGRST202", async () => {
    const ctx = createTestContext()
    try {
      const user = await ctx.user("reveal")
      const result = await user.client.rpc("reveal_found_item_contact", {
        p_item_id: crypto.randomUUID(),
      })
      expectResolved(result.error)
      expect(result.error?.code).toBe("P0002")
    } finally {
      await ctx.cleanup()
    }
  }, 60_000)

  it("lib/db 的真实发布路径可用（防止契约漂移）", async () => {
    const ctx = createTestContext()
    try {
      const user = await ctx.user("libdb")
      const { publishItem } = await import("@/lib/db/found-items")
      const first = await createUploads(user.id, 1)
      const itemId = await publishItem(user.client, {
        title: "lib/db 发布的物品",
        description: "走产品封装发布，验证参数形状与 PostgREST 匹配。",
        custody: "kept",
        contact: "13800138000",
        lat: null,
        lng: null,
        locationLabel: "",
        uploadIds: first.map((upload) => upload.id),
      })
      expect(typeof itemId).toBe("string")

      const second = await createUploads(user.id, 1)
      const inPlaceId = await publishItem(user.client, {
        title: "lib/db 留在原地",
        description: "只给位置描述，其余参数留空。",
        custody: "in_place",
        contact: "",
        lat: null,
        lng: null,
        locationLabel: "图书馆 3 楼",
        uploadIds: second.map((upload) => upload.id),
      })
      expect(typeof inPlaceId).toBe("string")
    } finally {
      await ctx.cleanup()
    }
  }, 60_000)
})
