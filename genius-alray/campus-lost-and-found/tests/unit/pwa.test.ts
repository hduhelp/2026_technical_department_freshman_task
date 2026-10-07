import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

import { describe, expect, it } from "vitest"

import manifest from "@/app/manifest"

const root = fileURLToPath(new URL("../..", import.meta.url))

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8")
}

/** 只解 PNG 头：8 字节签名 + IHDR 里的宽高，避免为了断言尺寸引入图像库 */
function pngSize(relative: string): { width: number; height: number } {
  const buf = readFileSync(path.join(root, relative))
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe("PWA 清单", () => {
  const m = manifest()

  it("能装到桌面：名字、standalone、从首页启动", () => {
    expect(m.name).toBe("校园失物招领")
    expect(m.short_name).toBe("失物招领")
    expect(m.display).toBe("standalone")
    expect(m.start_url).toBe("/")
    expect(m.scope).toBe("/")
    expect(m.id).toBe("/")
    expect(m.lang).toBe("zh-CN")
    expect(m.theme_color).toBeTruthy()
    expect(m.background_color).toBeTruthy()
  })

  it("闪屏与状态栏兜底色不是白色（元信息空档时不该闪一下白）", () => {
    // Next 路由切换会重建 <head> 元信息，那一瞬间的状态栏颜色就取自 manifest
    expect(m.theme_color).not.toBe("#ffffff")
    expect(m.background_color).not.toBe("#ffffff")
  })

  it("图标齐全：192/512 普通图标 + maskable（安卓自适应）", () => {
    const icons = m.icons ?? []
    expect(
      icons.some((i) => i.sizes === "192x192" && i.purpose === "any")
    ).toBe(true)
    expect(
      icons.some((i) => i.sizes === "512x512" && i.purpose === "any")
    ).toBe(true)
    // maskable 少了背景就会在安卓上被裁成「只剩放大镜，背景是白的」
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true)
  })

  it("清单里声明的图标真的存在，且实际像素与 sizes 一致", () => {
    for (const icon of m.icons ?? []) {
      // 清单里的 src 是 URL（/icons/xxx.png），磁盘上在 public/ 下
      const relative = path.join("public", icon.src.replace(/^\//, ""))
      const [width, height] = (icon.sizes ?? "").split("x").map(Number)
      expect(pngSize(relative), icon.src).toEqual({ width, height })
    }
  })

  it("iOS 主屏图标是 180×180", () => {
    expect(pngSize("app/apple-icon.png")).toEqual({
      width: 180,
      height: 180,
    })
  })
})

describe("Service Worker", () => {
  const source = read("public/sw.js")

  it("语法合法（浏览器会原样执行 public/sw.js，没有构建步骤兜底）", () => {
    expect(() => new vm.Script(source)).not.toThrow()
  })

  it("注册了 install / activate / fetch 三个生命周期", () => {
    expect(source).toContain('self.addEventListener("install"')
    expect(source).toContain('self.addEventListener("activate"')
    expect(source).toContain('self.addEventListener("fetch"')
  })

  it("预缓存离线页（断网时导航请求的兜底就是它）", () => {
    expect(source).toContain('"/offline"')
  })

  it("纪律：不碰 /api/、不碰跨域、不缓存业务页面的 HTML", () => {
    expect(source).toContain('url.pathname.startsWith("/api/")')
    expect(source).toContain("url.origin !== self.location.origin")
    // 导航只做 network-first，绝不能把登录态页面写进缓存
    expect(source).toContain('request.mode === "navigate"')
    // 只有「同源的正常响应」才允许进缓存（不透明/跨域响应一律不写）
    expect(source).toContain('response.ok && response.type === "basic"')
  })
})

describe("PWA 相关配置纪律", () => {
  it("proxy 放行离线页 / 清单 / SW，否则未登录时会被 307 到登录页", () => {
    const proxy = read("proxy.ts")
    for (const p of ["/offline", "/sw.js", "/manifest.webmanifest"]) {
      expect(proxy).toContain(p)
    }
    expect(proxy).toContain("PUBLIC_PATHS.includes(pathname)")
  })

  it("sw.js 不进 HTTP 缓存（否则永远拿不到新版本）", () => {
    const config = read("next.config.ts")
    expect(config).toContain('source: "/sw.js"')
    expect(config).toContain("no-store")
  })
})
