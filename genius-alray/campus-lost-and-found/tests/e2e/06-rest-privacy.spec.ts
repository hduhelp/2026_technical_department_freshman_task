import { expect, test } from "@playwright/test"
import { ANON_KEY, SUPABASE_URL, type TestContext } from "../helpers/supabase"
import {
  E2E_PASSWORD,
  createE2EUser,
  createPublishedItem,
  newTestContext,
  type E2EItem,
} from "./helpers"

/**
 * 列级隐私：拿一个真实登录会话直连 PostgREST。
 * - 公开失物墙成立：未登录（anon）与登录用户都能读公开列；
 * - contact / location_* 列级 REVOKE：任何查询（含 select=*）都 42501；
 * - 私有桶对象直读也拿不到（只能走服务端签名 URL）。
 */
test.describe("列级隐私（直连 REST）", () => {
  let ctx: TestContext
  let kept: E2EItem
  let inPlace: E2EItem
  let attackerEmail = ""

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    ctx = newTestContext()
    const owner = await createE2EUser(ctx, "owner")
    const attacker = await createE2EUser(ctx, "atk")
    attackerEmail = attacker.email
    kept = await createPublishedItem(ctx, owner, {
      title: "E2E REST 钱包 " + Math.random().toString(36).slice(2, 6),
      custody: "kept",
      contact: "13900139000",
    })
    inPlace = await createPublishedItem(ctx, owner, {
      title: "E2E REST 雨伞 " + Math.random().toString(36).slice(2, 6),
      custody: "in_place",
      locationLabel: "图书馆 3 楼自习区",
      lat: 31.230416,
      lng: 121.473701,
    })
  })

  test.afterAll(async () => {
    await ctx.cleanup()
  })

  test("公开列可读；contact / location / 星号 select / 私有桶全部拿不到", async ({
    playwright,
  }) => {
    test.setTimeout(120_000)
    const api = await playwright.request.newContext()
    let rest = await playwright.request.newContext()
    const anonRest = await playwright.request.newContext({
      baseURL: SUPABASE_URL,
      extraHTTPHeaders: { apikey: ANON_KEY },
    })

    const expectDenied = async (response: {
      status: () => number
      text: () => Promise<string>
    }) => {
      const status = response.status()
      expect(status).not.toBe(404)
      expect(status).toBeGreaterThanOrEqual(400)
      expect(await response.text()).toContain("42501")
    }

    try {
      // 未登录（anon）也能刷公开失物墙
      const anonListed = await anonRest.get(
        "/rest/v1/found_items?select=id,owner_id,title,description,custody,status&id=eq." +
          kept.id
      )
      expect(anonListed.status()).toBe(200)
      const anonRows = (await anonListed.json()) as Array<
        Record<string, unknown>
      >
      expect(anonRows.length).toBe(1)
      expect(anonRows[0]?.title).toBe(kept.title)
      expect(Object.keys(anonRows[0] ?? {})).not.toContain("contact")

      for (const column of [
        "contact",
        "location_lat",
        "location_lng",
        "location_label",
      ]) {
        await expectDenied(
          await anonRest.get("/rest/v1/found_items?select=id," + column)
        )
      }
      await expectDenied(await anonRest.get("/rest/v1/found_items?select=*"))

      // 登录会话（拿真实 token）
      const tokenResponse = await api.post(
        SUPABASE_URL + "/auth/v1/token?grant_type=password",
        {
          headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
          data: { email: attackerEmail, password: E2E_PASSWORD },
        }
      )
      expect(tokenResponse.ok()).toBe(true)
      const tokenBody = (await tokenResponse.json()) as { access_token: string }
      expect(tokenBody.access_token.length).toBeGreaterThan(0)

      await rest.dispose()
      rest = await playwright.request.newContext({
        baseURL: SUPABASE_URL,
        extraHTTPHeaders: {
          apikey: ANON_KEY,
          Authorization: "Bearer " + tokenBody.access_token,
        },
      })

      // 公开列：登录用户可读
      const listed = await rest.get(
        "/rest/v1/found_items?select=id,owner_id,title,description,custody,status&id=eq." +
          kept.id
      )
      expect(listed.status()).toBe(200)
      const rows = (await listed.json()) as Array<Record<string, unknown>>
      expect(rows.length).toBe(1)
      expect(rows[0]?.title).toBe(kept.title)
      expect(Object.keys(rows[0] ?? {})).not.toContain("contact")

      // 机密列：直接 42501（非 404）
      for (const column of [
        "contact",
        "location_lat",
        "location_lng",
        "location_label",
      ]) {
        await expectDenied(
          await rest.get("/rest/v1/found_items?select=id," + column)
        )
      }
      await expectDenied(await rest.get("/rest/v1/found_items?select=*"))

      // 按 id 精确取机密列同样被拒（防止「猜到 uuid 就能拿」）
      await expectDenied(
        await rest.get(
          "/rest/v1/found_items?select=id,contact&id=eq." + kept.id
        )
      )
      await expectDenied(
        await rest.get(
          "/rest/v1/found_items?select=location_label&id=eq." + inPlace.id
        )
      )

      // 私有桶对象：直连 storage 也拿不到
      const image = await ctx.admin
        .from("found_item_images")
        .select("storage_path")
        .eq("found_item_id", kept.id)
        .limit(1)
        .single()
      const storagePath = image.data?.storage_path ?? ""
      expect(storagePath).not.toBe("")
      const objectResponse = await api.get(
        SUPABASE_URL + "/storage/v1/object/item-images/" + storagePath,
        {
          headers: {
            apikey: ANON_KEY,
            Authorization: "Bearer " + tokenBody.access_token,
          },
        }
      )
      expect(objectResponse.status()).not.toBe(200)
      expect(objectResponse.status()).toBeGreaterThanOrEqual(400)
    } finally {
      await rest.dispose()
      await api.dispose()
      await anonRest.dispose()
    }
  })
})
