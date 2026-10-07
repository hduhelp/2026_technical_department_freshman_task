import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { syncLoginPhone } from "@/lib/auth/login-phone"
import {
  AUTH_EMAIL_DOMAIN,
  TEST_PASSWORD,
  createAnonClient,
  createTestContext,
  type TestContext,
  type TestUser,
} from "../helpers/supabase"

/**
 * profiles（个人信息 / 账号）
 * - 可读列：id, real_name, phone, created_at, updated_at
 * - 可写列：real_name, phone（其余列 42501）
 * - RLS：只能读/改自己那一行（profiles_select_own / profiles_update_own）
 * - CHECK（第 7 轮）：姓名 2-20 字；手机号必须是中国大陆 11 位手机号且唯一
 * - 注册即必填：real_name / phone 都是 NOT NULL
 */
const PROFILE_COLUMNS = "id, real_name, phone, created_at, updated_at"

/** 造一个没被占用的测试手机号 */
function freshPhone(): string {
  return (
    "13" +
    Math.floor(Math.random() * 1_000_000_000)
      .toString()
      .padStart(9, "0")
  )
}

describe("profiles：个人信息的列级与行级权限", () => {
  let ctx: TestContext
  let alice: TestUser
  let bob: TestUser

  beforeAll(async () => {
    ctx = createTestContext()
    alice = await ctx.user("alice")
    bob = await ctx.user("bob")
  }, 120_000)

  afterAll(async () => {
    await ctx.cleanup()
  })

  it("注册即写入：姓名与手机号都已存在且可读", async () => {
    const result = await alice.client
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", alice.id)
      .single()

    expect(result.error).toBeNull()
    expect(result.data?.real_name).toBe(alice.realName)
    expect(result.data?.phone).toBe(alice.phone)
    expect(result.data?.created_at).toBeTruthy()
  })

  it("可以更新自己的 real_name / phone，并读回", async () => {
    const nextPhone = freshPhone()
    const updated = await alice.client
      .from("profiles")
      .update({ real_name: "张三", phone: nextPhone })
      .eq("id", alice.id)
      .select(PROFILE_COLUMNS)
      .single()

    expect(updated.error).toBeNull()
    expect(updated.data?.real_name).toBe("张三")
    expect(updated.data?.phone).toBe(nextPhone)

    const readBack = await alice.client
      .from("profiles")
      .select("real_name, phone")
      .eq("id", alice.id)
      .single()
    expect(readBack.data?.real_name).toBe("张三")
    expect(readBack.data?.phone).toBe(nextPhone)
  })

  it("RLS：读不到别人的 profile，也改不动别人的行", async () => {
    const foreign = await alice.client
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", bob.id)
    expect(foreign.error).toBeNull()
    expect(foreign.data).toEqual([])

    const attempt = await alice.client
      .from("profiles")
      .update({ real_name: "冒充" })
      .eq("id", bob.id)
      .select("id")
    expect(attempt.error).toBeNull()
    expect(attempt.data).toEqual([])

    // Bob 的行没有被改动
    const bobRow = await ctx.admin
      .from("profiles")
      .select("real_name")
      .eq("id", bob.id)
      .single()
    expect(bobRow.data?.real_name).toBe(bob.realName)
  })

  it("列级：未授予的时刻列不可写（42501）", async () => {
    const result = await alice.client
      .from("profiles")
      .update({ created_at: new Date().toISOString() } as never)
      .eq("id", alice.id)
      .select("id")
    expect(result.error).not.toBeNull()
    expect(result.error?.code).toBe("42501")
  })

  it("CHECK 约束：姓名长度与手机号格式都被数据库拒绝（23514）", async () => {
    const badName = await alice.client
      .from("profiles")
      .update({ real_name: "张" })
      .eq("id", alice.id)
      .select("id")
    expect(badName.error?.code).toBe("23514")

    for (const phone of [
      "abc",
      "12345",
      "1".repeat(21),
      "+86 138-0013-8000",
      "23800138000",
    ]) {
      const badPhone = await alice.client
        .from("profiles")
        .update({ phone })
        .eq("id", alice.id)
        .select("id")
      expect(badPhone.error?.code, phone).toBe("23514")
    }

    // 手机号唯一：换成别人的号码会被拒
    const duplicate = await alice.client
      .from("profiles")
      .update({ phone: bob.phone })
      .eq("id", alice.id)
      .select("id")
    expect(duplicate.error?.code).toBe("23505")

    // 合法值仍然可写
    const ok = await alice.client
      .from("profiles")
      .update({ phone: freshPhone() })
      .eq("id", alice.id)
      .select("phone")
      .single()
    expect(ok.error).toBeNull()
  })

  /**
   * 回归：手机号即账号（内部邮箱 <手机号>@<域名>）。
   * 只改 profiles.phone 而不动 auth 的邮箱，用户就会变成
   * 「资料里写着新号、却只能拿旧号登录」—— 等于把自己锁在门外。
   * 这里调用的是 app/me/actions.ts 里用的同一个函数。
   */
  it("改手机号后：新手机号能登录，旧手机号不再能登录", async () => {
    const newPhone = freshPhone()
    const newEmail = newPhone + "@" + AUTH_EMAIL_DOMAIN
    expect(newEmail).not.toBe(alice.email)

    // 顺序与 saveProfileAction 一致：先同步登录账号，再写资料
    const synced = await syncLoginPhone(ctx.admin, alice.id, newPhone)
    expect(synced).toEqual({ ok: true })

    // 登录账号变了，但当前会话不受影响（改完还得能存资料）
    const updated = await alice.client
      .from("profiles")
      .update({ phone: newPhone })
      .eq("id", alice.id)
      .select("phone")
      .single()
    expect(updated.error).toBeNull()
    expect(updated.data?.phone).toBe(newPhone)

    // 新手机号派生的邮箱能登录
    const fresh = createAnonClient()
    const signedIn = await fresh.auth.signInWithPassword({
      email: newEmail,
      password: TEST_PASSWORD,
    })
    expect(signedIn.error).toBeNull()
    expect(signedIn.data.user?.id).toBe(alice.id)

    // 旧手机号派生的邮箱已经不是登录账号了
    const stale = createAnonClient()
    const old = await stale.auth.signInWithPassword({
      email: alice.email,
      password: TEST_PASSWORD,
    })
    expect(old.error).not.toBeNull()
  })

  it("同步登录账号时，已被别人占用的手机号会被拒绝", async () => {
    const taken = await syncLoginPhone(ctx.admin, alice.id, bob.phone)
    expect(taken.ok).toBe(false)
  })
})
