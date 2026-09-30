// 端到端验证：数据库 / RLS / Storage / RPC。
// 用法：node scripts/verify-backend.mjs
// 需要 .env.local 里的 NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY。
// 脚本会自己创建测试数据并在结束时清理。

import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

import { createClient } from "@supabase/supabase-js"

function loadEnv(path = ".env.local") {
  const result = {}
  let raw = ""
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    console.error("找不到 " + path + "，请先按 .env.example 配好。")
    process.exit(1)
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

const env = loadEnv()
const url = env.NEXT_PUBLIC_SUPABASE_URL
// 新版 publishable key 优先，旧的 anon key 兜底（与 lib/env.ts 保持一致）
const anonKey =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const emailDomain = env.AUTH_EMAIL_DOMAIN || "user.campus-lostfound.invalid"

if (!url || !anonKey || !serviceKey) {
  console.error(
    "缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY"
  )
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function loginEmail(username) {
  const digest = createHash("sha256").update(username.toLowerCase()).digest("hex")
  return digest.slice(0, 32) + "@" + emailDomain
}

let passed = 0
let failed = 0
function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log("  ✓ " + label)
  } else {
    failed += 1
    console.log("  ✗ " + label + (detail ? "  → " + detail : ""))
  }
}

const stamp = Date.now().toString(36)
const userA = { username: "verify_a_" + stamp, password: "verify-pass-123" }
const userB = { username: "verify_b_" + stamp, password: "verify-pass-123" }
const createdUsers = []
const createdItems = []

async function makeUser(user) {
  user.email = loginEmail(user.username)
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { username: user.username },
  })
  if (error) throw new Error("创建用户失败：" + error.message)
  user.id = data.user.id
  createdUsers.push(user.id)

  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: user.id, username: user.username })
  if (profileError) throw new Error("写入 profile 失败：" + profileError.message)

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (signInError) throw new Error("登录失败：" + signInError.message)
  user.client = client
  return user
}

function insertItem(client, userId, payload) {
  return client
    .from("items")
    .insert({ user_id: userId, ...payload })
    .select("id")
    .single()
}

async function main() {
  console.log("\n== 1. 用户与 profile ==")
  await makeUser(userA)
  await makeUser(userB)

  const { data: profileRows } = await admin
    .from("profiles")
    .select("id, username")
    .in("id", [userA.id, userB.id])
  check("两个 profile 都落库", (profileRows ?? []).length === 2)

  // 大小写不敏感唯一
  const { error: dupError } = await admin
    .from("profiles")
    .insert({ id: userB.id, username: userB.username.toUpperCase() })
  check("用户名大小写不敏感唯一", Boolean(dupError), dupError?.message)

  const { data: available } = await anon.rpc("username_available", {
    p_username: userA.username.toUpperCase(),
  })
  check("username_available 对已占用返回 false", available === false)

  console.log("\n== 2. 发帖与状态 ==")
  const foundA = await insertItem(userA.client, userA.id, {
    kind: "found",
    title: "黑色折叠雨伞",
    description: "在图书馆三楼捡到一把黑色折叠雨伞，伞柄上有小熊挂件。",
    location: "图书馆三楼",
    happened_at: new Date(Date.now() - 3600_000).toISOString(),
  })
  const lostB = await insertItem(userB.client, userB.id, {
    kind: "lost",
    title: "黑色雨伞",
    description: "丢了一把黑色折叠伞，伞柄上挂着小熊。",
    location: "图书馆",
    happened_at: new Date(Date.now() - 7200_000).toISOString(),
  })
  const unrelated = await insertItem(userB.client, userB.id, {
    kind: "lost",
    title: "高等数学教材",
    description: "同济版高数上册，书角折了。",
    location: "教学楼 A 座",
    happened_at: new Date(Date.now() - 500_000).toISOString(),
  })
  check("拾获帖子创建成功", Boolean(foundA.data?.id), foundA.error?.message)
  check("丢失帖子创建成功", Boolean(lostB.data?.id), lostB.error?.message)
  check("无关帖子创建成功", Boolean(unrelated.data?.id), unrelated.error?.message)
  for (const row of [foundA, lostB, unrelated]) {
    if (row.data?.id) createdItems.push(row.data.id)
  }

  await userA.client
    .from("item_contacts")
    .insert({ item_id: foundA.data.id, contact: "微信：verify_a" })

  console.log("\n== 3. similar_items（丢失去找拾获） ==")
  const { data: similar, error: similarError } = await anon.rpc("similar_items", {
    p_kind: "found",
    p_title: "黑色雨伞",
    p_description: "黑色折叠伞，有小熊挂件",
    p_location: "图书馆",
    p_happened_at: new Date().toISOString(),
    p_limit: 5,
  })
  check("相似检测无报错", !similarError, similarError?.message)
  const similarIds = (similar ?? []).map((row) => row.id)
  check("语义最接近的帖子排第一", similarIds[0] === foundA.data.id, JSON.stringify(similarIds))
  check("相似度达到阈值", (similar ?? [])[0]?.score >= 0.2, String((similar ?? [])[0]?.score))
  check("不相关帖子不出现", !similarIds.includes(unrelated.data.id))

  console.log("\n== 4. search_items（搜索 / 筛选 / 分页） ==")
  const { data: byKeyword } = await anon.rpc("search_items", { p_q: "雨伞" })
  check("关键词命中雨伞两条", (byKeyword ?? []).length >= 2, String((byKeyword ?? []).length))

  const { data: onlyFound } = await anon.rpc("search_items", {
    p_q: "",
    p_kind: "found",
    p_limit: 50,
  })
  check("kind 过滤只返回拾获", (onlyFound ?? []).every((row) => row.kind === "found"))

  const { data: mine } = await anon.rpc("search_items", {
    p_only_user: userB.id,
    p_limit: 50,
  })
  check("only_user 只返回该用户的帖子", (mine ?? []).every((row) => row.id === lostB.data.id || row.id === unrelated.data.id))

  await userA.client
    .from("items")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", foundA.data.id)

  const { data: defaultList } = await anon.rpc("search_items", { p_limit: 50 })
  check(
    "默认不返回已找回",
    !(defaultList ?? []).some((row) => row.id === foundA.data.id)
  )
  const { data: withResolved } = await anon.rpc("search_items", {
    p_include_resolved: true,
    p_limit: 50,
  })
  check(
    "include_resolved 能返回已找回",
    (withResolved ?? []).some((row) => row.id === foundA.data.id)
  )
  check("total 字段可用", Number((withResolved ?? [])[0]?.total) >= 3, String((withResolved ?? [])[0]?.total))

  const { data: page1 } = await anon.rpc("search_items", { p_limit: 2, p_offset: 0 })
  const { data: page2 } = await anon.rpc("search_items", { p_limit: 2, p_offset: 2 })
  check("分页偏移生效", (page1 ?? []).length === 2 && (page2 ?? [])[0]?.id !== (page1 ?? [])[0]?.id)

  console.log("\n== 5. Storage ==")
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  )
  const objectPath = userA.id + "/" + randomUUID() + ".png"
  const { error: uploadError } = await userA.client.storage
    .from("item-photos")
    .upload(objectPath, png, { contentType: "image/png", upsert: false })
  check("上传到自己的目录成功", !uploadError, uploadError?.message)

  const publicUrl = url.replace(/\/+$/, "") + "/storage/v1/object/public/item-photos/" + objectPath
  const response = await fetch(publicUrl)
  check("公开 URL 可访问", response.ok, String(response.status))
  check(
    "Content-Type 正确",
    (response.headers.get("content-type") ?? "").includes("image/png"),
    response.headers.get("content-type") ?? ""
  )

  const foreignPath = userB.id + "/" + randomUUID() + ".png"
  const { error: foreignError } = await userA.client.storage
    .from("item-photos")
    .upload(foreignPath, png, { contentType: "image/png", upsert: false })
  check("不能写到别人的目录", Boolean(foreignError), foreignError?.message)

  console.log("\n== 6. RLS ==")
  const { data: anonContacts } = await anon.from("item_contacts").select("contact")
  check("未登录读不到联系方式", (anonContacts ?? []).length === 0)

  const { data: memberContacts } = await userB.client
    .from("item_contacts")
    .select("contact")
    .eq("item_id", foundA.data.id)
  check("登录后能读到联系方式", (memberContacts ?? []).length === 1)

  const { data: stolen } = await userB.client
    .from("items")
    .update({ status: "resolved" })
    .eq("id", foundA.data.id)
    .select("id")
  check("不能修改别人的帖子", (stolen ?? []).length === 0)

  const { error: foreignInsertError } = await userB.client.from("items").insert({
    user_id: userA.id,
    kind: "lost",
    title: "冒名发帖",
    location: "测试",
    happened_at: new Date().toISOString(),
  })
  check("不能用别人的 user_id 发帖", Boolean(foreignInsertError), foreignInsertError?.message)

  // 清理
  console.log("\n== 7. 清理测试数据 ==")
  await admin.storage.from("item-photos").remove([objectPath])
  await admin.from("items").delete().in("id", createdItems)
  await admin.from("profiles").delete().in("id", createdUsers)
  for (const id of createdUsers) {
    await admin.auth.admin.deleteUser(id)
  }
  console.log("  已清理 " + createdItems.length + " 条帖子、" + createdUsers.length + " 个用户")

  console.log("\n通过 " + passed + " 项，失败 " + failed + " 项\n")
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error("\n脚本异常：" + (error?.stack ?? error))
  try {
    await admin.from("items").delete().in("id", createdItems)
    await admin.from("profiles").delete().in("id", createdUsers)
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id)
  } catch {
    // 清理失败不覆盖原始错误
  }
  process.exit(1)
})
