import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 安全矩阵 10：源码纪律
 * - 不存在对 found_items / found_item_images / pickups 的星号 select
 * - "use client" 文件不 import lib/supabase/admin（service_role 永不下发浏览器）
 * - 引用 admin client 的文件必须处于服务端上下文
 */

const ROOT = process.cwd()
const SCAN_DIRS = ["app", "components", "lib", "hooks"]
const EXTRA_FILES = ["proxy.ts"]
const PROTECTED_TABLES = ["found_items", "found_item_images", "pickups"]

function collect(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collect(full, out)
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full)
    }
  }
  return out
}

const FILES = [
  ...SCAN_DIRS.flatMap((dir) => collect(join(ROOT, dir))),
  ...EXTRA_FILES.map((file) => join(ROOT, file)),
].filter(existsSync)

function read(path: string): string {
  return readFileSync(path, "utf8")
}

function relative(path: string): string {
  return path.slice(ROOT.length + 1)
}

function isClientFile(code: string): boolean {
  const head = code.trimStart()
  return head.startsWith('"use client"') || head.startsWith("'use client'")
}

function hasServerOnlyImport(code: string): boolean {
  return (
    code.includes('import "server-only"') ||
    code.includes("import 'server-only'")
  )
}

function hasUseServerDirective(code: string): boolean {
  const head = code.trimStart()
  return head.startsWith('"use server"') || head.startsWith("'use server'")
}

/** 找出 from("<table>") 之后紧邻的 .select(...) 调用参数里是否含星号 */
function starSelectTargets(code: string, table: string): string[] {
  const needles = ['from("' + table + '")', "from('" + table + "')"]
  const hits: string[] = []
  for (const needle of needles) {
    let from = code.indexOf(needle)
    while (from !== -1) {
      const tail = code.slice(from, from + 240)
      const selectAt = tail.indexOf(".select(")
      if (selectAt >= 0) {
        const closeAt = tail.indexOf(")", selectAt)
        const call = tail.slice(
          selectAt,
          closeAt === -1 ? tail.length : closeAt + 1
        )
        if (call.includes("*")) hits.push(needle)
      }
      from = code.indexOf(needle, from + needle.length)
    }
  }
  return hits
}

describe("矩阵 10：源码纪律", () => {
  it("扫描范围非空（避免规则静默失效）", () => {
    expect(FILES.length).toBeGreaterThan(10)
  })

  it("不存在受保护表的星号 select", () => {
    const violations: string[] = []
    for (const path of FILES) {
      const code = read(path)
      for (const table of PROTECTED_TABLES) {
        if (starSelectTargets(code, table).length > 0) {
          violations.push(relative(path) + " -> " + table)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('"use client" 文件不引用 admin client / service_role', () => {
    const violations: string[] = []
    for (const path of FILES) {
      const code = read(path)
      if (!isClientFile(code)) continue
      if (code.includes("@/lib/supabase/admin")) violations.push(relative(path))
      else if (code.includes("createAdminClient"))
        violations.push(relative(path))
      else if (code.includes("SERVICE_ROLE")) violations.push(relative(path))
    }
    expect(violations).toEqual([])
  })

  it("引用 admin client 的文件必须处于服务端上下文", () => {
    const violations: string[] = []
    for (const path of FILES) {
      const code = read(path)
      if (!code.includes("@/lib/supabase/admin")) continue
      const rel = relative(path)
      const allowed =
        rel === "lib/supabase/admin.ts" ||
        rel.includes("/api/") ||
        hasUseServerDirective(code) ||
        hasServerOnlyImport(code)
      if (!allowed) violations.push(rel)
    }
    expect(violations).toEqual([])
  })

  it("admin.ts 带 server-only 守卫，且不存在旧式 middleware.ts", () => {
    const admin = read(join(ROOT, "lib/supabase/admin.ts"))
    expect(hasServerOnlyImport(admin)).toBe(true)
    expect(existsSync(join(ROOT, "middleware.ts"))).toBe(false)
  })
})
