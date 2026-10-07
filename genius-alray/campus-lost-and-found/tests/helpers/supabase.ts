import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

export type Client = SupabaseClient<Database>

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321"
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
export const AUTH_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? "campus.local"
export const DB_URL =
  process.env.DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export const IMAGE_BUCKET = "item-images"
export const TEST_PASSWORD = "test-password-123"

/** 1x1 透明 PNG，仅用于验证私有桶的读写权限 */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
)

function assertCredentials(): void {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error(
      "缺少 NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY；请确认本地 .env.local 已就绪"
    )
  }
}

export function createAnonClient(): Client {
  assertCredentials()
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createAdminClient(): Client {
  assertCredentials()
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * 造一个合法且唯一的测试手机号（1[3-9] + 9 位）。
 * 必须真的唯一：runId 是字母，用「runId + seq」抽数字会让每个 context 的第一个用户
 * 都得到同一个号码，直接撞 profiles_phone_key。
 */
function testPhone(): string {
  const tail = Math.floor(Math.random() * 1_000_000_000)
  return "13" + tail.toString().padStart(9, "0")
}

export type TestUser = {
  id: string
  /** 内部标识（用于生成邮箱/日志），第 7 轮起账号是手机号 */
  username: string
  /** 注册时填的真实姓名（认领默认用它） */
  realName: string
  phone: string
  email: string
  password: string
  client: Client
  token: () => Promise<string>
}

export type TestContext = {
  runId: string
  admin: Client
  anon: Client
  user: (prefix: string) => Promise<TestUser>
  trackStoragePath: (path: string) => void
  cleanup: () => Promise<void>
}

/**
 * 每个测试文件一份隔离上下文：
 * - 用户带随机后缀，互不冲突
 * - 结束时删除用户（级联删除其物品/寻物/认领）与测试产生的标签/对象
 */
export function createTestContext(): TestContext {
  const runId = Math.random().toString(36).slice(2, 8)
  const admin = createAdminClient()
  const anon = createAnonClient()
  const users: TestUser[] = []
  const storagePaths: string[] = []
  let seq = 0

  async function user(prefix: string): Promise<TestUser> {
    seq += 1
    const safe = prefix
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 6)
    // 【第 7 轮】账号体系改成「手机号 + 密码」：内部邮箱由手机号派生，
    // profiles 的 real_name / phone 是 NOT NULL，所以创建测试用户必须带上这两项。
    const username = ("u_" + safe + "_" + runId + seq).slice(0, 20)
    const realName = ("测试" + safe.slice(0, 4)).slice(0, 20)
    const phone = testPhone()
    const email = phone + "@" + AUTH_EMAIL_DOMAIN

    const created = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { real_name: realName, phone },
    })
    if (created.error || !created.data?.user) {
      throw new Error(
        "创建测试用户失败：" + (created.error?.message ?? "unknown")
      )
    }

    const client = createAnonClient()
    const signedIn = await client.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    })
    if (signedIn.error || !signedIn.data.session) {
      throw new Error(
        "测试用户登录失败：" + (signedIn.error?.message ?? "unknown")
      )
    }

    const testUser: TestUser = {
      id: created.data.user.id,
      username,
      realName,
      phone,
      email,
      password: TEST_PASSWORD,
      client,
      token: async () => {
        const session = await client.auth.getSession()
        return session.data.session?.access_token ?? ""
      },
    }
    users.push(testUser)
    return testUser
  }

  function trackStoragePath(path: string): void {
    storagePaths.push(path)
  }

  async function cleanup(): Promise<void> {
    for (const u of users) {
      try {
        await admin.auth.admin.deleteUser(u.id)
      } catch {
        // 清理失败不阻塞测试结论
      }
    }
    if (storagePaths.length > 0) {
      try {
        await admin.storage.from(IMAGE_BUCKET).remove(storagePaths)
      } catch {
        // 同上
      }
    }
  }

  return { runId, admin, anon, user, trackStoragePath, cleanup }
}
