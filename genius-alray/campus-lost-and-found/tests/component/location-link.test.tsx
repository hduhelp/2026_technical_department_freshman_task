// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocationLink } from "@/components/contact/location-link"

// vitest 没开 globals，RTL 的自动 cleanup 不会注册：必须在文件里显式清理，
// 否则同一个文件里的多个用例会共享 DOM（getByTestId 直接报 multiple elements）。
afterEach(cleanup)

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/** 临时把 navigator.userAgent 换成手机/桌面，跑完还原（jsdom 的 UA 是原型上的 getter） */
function withUserAgent(ua: string, run: () => void) {
  const own = Object.getOwnPropertyDescriptor(window.navigator, "userAgent")
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    get: () => ua,
  })
  try {
    run()
  } finally {
    if (own) Object.defineProperty(window.navigator, "userAgent", own)
    else
      Reflect.deleteProperty(
        window.navigator as unknown as Record<string, unknown>,
        "userAgent"
      )
  }
}

/** 打开二次确认框，返回「打开高德地图」这个链接 */
async function openDialog() {
  fireEvent.click(screen.getByTestId("location-link"))
  return await screen.findByTestId("map-open-confirm")
}

/**
 * 位置组件不许把经纬度展示给用户：
 * 有位置详情就显示详情，否则统一显示「查看定位」。
 */
describe("LocationLink 的文案", () => {
  it("有位置详情 + 坐标：控件显示「查看定位」，不出现经纬度，也不把详情铺在按钮上", () => {
    render(
      <LocationLink
        label="图书馆 3 楼自习区"
        lat={31.230416}
        lng={121.473701}
      />
    )
    const link = screen.getByTestId("location-link")
    expect(link).toHaveTextContent("查看定位")
    expect(link).not.toHaveTextContent("图书馆 3 楼自习区")
    expect(link).not.toHaveTextContent(/31\.23|121\.47/)
  })

  it("只有坐标：显示「查看定位」，整页都不出现经纬度", () => {
    render(<LocationLink lat={31.230416} lng={121.473701} />)
    expect(screen.getByTestId("location-link")).toHaveTextContent("查看定位")
    expect(document.body.textContent).not.toMatch(/31\.23|121\.47/)
  })

  it("什么都没填：显示「未填写位置」", () => {
    render(<LocationLink />)
    expect(screen.getByTestId("location-link")).toHaveTextContent("未填写位置")
  })
})

/**
 * 手机端能不能跳进高德 App，全靠这个链接：
 * https://uri.amap.com 的 callnative=1 会被高德自己的页面接管。
 */
describe("LocationLink 的高德链接", () => {
  it("有坐标：走标记点，坐标是 GCJ-02，并带 callnative=1 与 src", async () => {
    render(
      <LocationLink label="图书馆 3 楼" lat={31.230416} lng={121.473701} />
    )
    const href = (await openDialog()).getAttribute("href") ?? ""

    expect(href.startsWith("https://uri.amap.com/marker?")).toBe(true)
    const params = new URL(href).searchParams
    expect(params.get("coordinate")).toBe("gaode")
    expect(params.get("callnative")).toBe("1")
    expect(params.get("src")).toBeTruthy()
    expect(params.get("name")).toBe("图书馆 3 楼")
    // 链接里只能是转换后的 GCJ-02，不能是 WGS84 原始值
    expect(href).not.toContain("31.230416")
    expect(href).not.toContain("121.473701")
  })

  it("只有位置详情：走高德搜索，同样带 callnative=1", async () => {
    render(<LocationLink label="图书馆 3 楼" />)
    const href = (await openDialog()).getAttribute("href") ?? ""

    expect(href.startsWith("https://uri.amap.com/search?")).toBe(true)
    const params = new URL(href).searchParams
    expect(params.get("keyword")).toBe("图书馆 3 楼")
    expect(params.get("callnative")).toBe("1")
  })
})

/** 桌面端/内嵌浏览器新标签打开网页版；手机端直接唤起高德 App（一步进 App） */
describe("LocationLink 的打开方式", () => {
  it("手机端：拦掉默认行为，直接唤起高德 App", async () => {
    render(
      <LocationLink label="图书馆 3 楼" lat={31.230416} lng={121.473701} />
    )
    const confirm = await openDialog()

    // 点击之后换成假定时器：否则 2 秒后的「网页版兜底」会在用例结束后才触发
    // （jsdom 会因此报一堆 navigation 噪音，也可能干扰后续用例）
    vi.useFakeTimers()
    try {
      withUserAgent(IPHONE_UA, () => {
        // jsdom 不会真的跳转，只会打一行「Not implemented: navigation」，这里静音
        const silence = vi.spyOn(console, "error").mockImplementation(() => {})
        // fireEvent 返回 false = 默认行为已被 preventDefault 拦下（导航由我们接管）
        expect(fireEvent.click(confirm)).toBe(false)
        silence.mockRestore()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("桌面端：不拦默认行为（新标签打开高德网页版）", async () => {
    render(
      <LocationLink label="图书馆 3 楼" lat={31.230416} lng={121.473701} />
    )
    const confirm = await openDialog()

    const silence = vi.spyOn(console, "error").mockImplementation(() => {})
    withUserAgent(DESKTOP_UA, () => {
      // fireEvent 返回 true = 默认行为照常发生，新标签交给浏览器自己开
      expect(fireEvent.click(confirm)).toBe(true)
    })
    silence.mockRestore()
  })
})
