#!/usr/bin/env node
// 从本地 supabase CLI 读取凭据并生成 .env.local
// 已存在文件中「非本脚本生成」的键会被保留（例如你填入的真实 AI key）
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const raw = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" })
const kv = {}
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)
  if (m) kv[m[1]] = m[2]
}

const missing = ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"].filter((k) => !kv[k])
if (missing.length > 0) {
  console.error("无法从 supabase status 读取：" + missing.join(", "))
  console.error("请先执行 pnpm db:start")
  process.exit(1)
}

const generated = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
])

const defaults = new Map([
  ["NEXT_PUBLIC_AUTH_EMAIL_DOMAIN", "campus.local"],
  ["AI_PROVIDER", "mock"],
  ["AI_MODEL", ""],
  ["AI_API_KEY", ""],
  ["AI_BASE_URL", ""],
])

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !generated.has(m[1])) defaults.set(m[1], m[2])
  }
}

const out = [
  "# 由 scripts/gen-env.mjs 生成（pnpm db:env）；已被 .gitignore 忽略",
  "",
  "# Supabase（本地）",
  "NEXT_PUBLIC_SUPABASE_URL=" + kv.API_URL,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=" + kv.ANON_KEY,
  "SUPABASE_SERVICE_ROLE_KEY=" + kv.SERVICE_ROLE_KEY,
  "",
  "# 应用配置",
  ...Array.from(defaults, ([k, v]) => k + "=" + v),
  "",
]
writeFileSync(".env.local", out.join("\n"))
console.log(".env.local 已生成（Supabase URL: " + kv.API_URL + "）")
