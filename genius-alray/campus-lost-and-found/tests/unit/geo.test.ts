import { describe, expect, it } from "vitest"

import {
  amapMarkerTarget,
  amapMarkerUrl,
  amapSearchTarget,
  amapSearchUrl,
  detectMobileOs,
  isInAppBrowser,
  planAmapLaunch,
  supportsIntentUrl,
  wgs84ToGcj02,
} from "@/lib/geo"

/** 手机端高德链接的契约：坐标必须是 GCJ-02，App 唤起链接必须能被系统识别 */
describe("WGS84 → GCJ-02", () => {
  it("国内坐标按公开算法偏移（天安门是常见对照点）", () => {
    const gcj = wgs84ToGcj02(39.9087, 116.3975)
    expect(gcj.lat).toBeCloseTo(39.910103, 5)
    expect(gcj.lng).toBeCloseTo(116.403744, 5)
  })

  it("境外坐标原样返回，不做偏移", () => {
    expect(wgs84ToGcj02(35.6762, 139.6503)).toEqual({
      lat: 35.6762,
      lng: 139.6503,
    })
    expect(wgs84ToGcj02(40.7128, -74.006)).toEqual({
      lat: 40.7128,
      lng: -74.006,
    })
  })
})

describe("高德网页版链接（桌面端 / 没装 App / 内嵌浏览器的落地页）", () => {
  it("标记点：传 GCJ-02 + coordinate=gaode + callnative=1 + src", () => {
    const url = amapMarkerUrl({
      lat: 31.230416,
      lng: 121.473701,
      label: "图书馆 3 楼",
    })
    expect(url.startsWith("https://uri.amap.com/marker?")).toBe(true)

    const params = new URL(url).searchParams
    expect(params.get("position")).toBe("121.478224,31.228474")
    expect(params.get("coordinate")).toBe("gaode")
    expect(params.get("callnative")).toBe("1")
    expect(params.get("src")).toBeTruthy()
    expect(params.get("name")).toBe("图书馆 3 楼")

    // 绝不能把 WGS84 原始坐标直接交给高德（会偏几百米）
    expect(url).not.toContain("121.473701")
    expect(url).not.toContain("31.230416")
  })

  it("标记点：没有位置详情时不带 name", () => {
    const url = amapMarkerUrl({ lat: 31.230416, lng: 121.473701 })
    expect(new URL(url).searchParams.has("name")).toBe(false)
  })

  it("搜索：关键词 + callnative=1 + src", () => {
    const url = amapSearchUrl("图书馆 3 楼")
    expect(url.startsWith("https://uri.amap.com/search?")).toBe(true)

    const params = new URL(url).searchParams
    expect(params.get("keyword")).toBe("图书馆 3 楼")
    expect(params.get("callnative")).toBe("1")
    expect(params.get("src")).toBeTruthy()
  })
})

describe("高德 App 唤起链接", () => {
  const marker = amapMarkerTarget({
    lat: 31.230416,
    lng: 121.473701,
    label: "图书馆 3 楼",
  })

  it("标记点 iOS：iosamap://viewMap，坐标是 GCJ-02，dev=0", () => {
    expect(marker.app.ios.startsWith("iosamap://viewMap?")).toBe(true)
    expect(marker.app.ios).toContain("lat=31.228474")
    expect(marker.app.ios).toContain("lon=121.478224")
    // dev=0 = 坐标已经是加密后的高德坐标，不需要再做国测加密（我们已转过 GCJ-02）
    expect(marker.app.ios).toContain("dev=0")
    expect(marker.app.ios).toContain(
      "poiname=" + encodeURIComponent("图书馆 3 楼")
    )
    expect(marker.app.ios).toContain("sourceApplication=")
    expect(marker.web).toBe(
      amapMarkerUrl({ lat: 31.230416, lng: 121.473701, label: "图书馆 3 楼" })
    )
  })

  it("标记点安卓：androidamap://viewMap + intent://（没装 App 自动回落网页版）", () => {
    expect(marker.app.android.startsWith("androidamap://viewMap?")).toBe(true)
    expect(marker.app.android).toContain("lat=31.228474")

    expect(marker.app.androidIntent.startsWith("intent://viewMap?")).toBe(true)
    expect(marker.app.androidIntent).toContain("scheme=androidamap")
    expect(marker.app.androidIntent).toContain("package=com.autonavi.minimap")
    expect(marker.app.androidIntent).toContain(
      "S.browser_fallback_url=" + encodeURIComponent(marker.web)
    )
  })

  it("搜索：iOS 用 name、安卓用 keywords（高德文档里两边参数名不同）", () => {
    const search = amapSearchTarget("图书馆 3 楼")
    expect(search.app.ios.startsWith("iosamap://poi?")).toBe(true)
    expect(search.app.ios).toContain(
      "name=" + encodeURIComponent("图书馆 3 楼")
    )
    expect(search.app.android.startsWith("androidamap://poi?")).toBe(true)
    expect(search.app.android).toContain(
      "keywords=" + encodeURIComponent("图书馆 3 楼")
    )
  })
})

describe("「打开高德」走哪条路", () => {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  const androidChrome =
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
  const androidFirefox =
    "Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0"
  const desktop =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  const wechat = iphone + " MicroMessenger/8.0.49"

  const target = amapMarkerTarget({ lat: 31.230416, lng: 121.473701 })

  function appPlan(userAgent: string) {
    const plan = planAmapLaunch({ userAgent, target })
    if (plan.kind !== "app") {
      throw new Error(
        "应当直接唤起 App，实际走了网页版：" + JSON.stringify(plan)
      )
    }
    return plan
  }

  it("iPhone：scheme 唤起，网页版仅作兜底", () => {
    const plan = appPlan(iphone)
    expect(plan.platform).toBe("ios")
    expect(plan.mode).toBe("scheme")
    expect(plan.url).toBe(target.app.ios)
    expect(plan.fallback).toBe(target.web)
  })

  it("安卓 Chrome：走 intent://（装了直接进 App，没装由 Chrome 回落到网页版）", () => {
    const plan = appPlan(androidChrome)
    expect(plan.platform).toBe("android")
    expect(plan.mode).toBe("intent")
    expect(plan.url).toBe(target.app.androidIntent)
  })

  it("安卓非 Chromium：退回 androidamap:// scheme", () => {
    const plan = appPlan(androidFirefox)
    expect(plan.mode).toBe("scheme")
    expect(plan.url).toBe(target.app.android)
  })

  it("桌面：不唤起 App，保持网页版", () => {
    expect(planAmapLaunch({ userAgent: desktop, target })).toEqual({
      kind: "web",
      url: target.web,
      reason: "desktop",
    })
  })

  it("微信内嵌浏览器：不唤起 App（scheme 一定被拦），只给网页版", () => {
    const plan = planAmapLaunch({ userAgent: wechat, target })
    expect(plan.kind).toBe("web")
    if (plan.kind === "web") expect(plan.reason).toBe("in-app-browser")
  })

  it("系统 / 浏览器判定", () => {
    expect(detectMobileOs(iphone)).toBe("ios")
    expect(detectMobileOs(androidChrome)).toBe("android")
    expect(detectMobileOs(desktop)).toBe("other")
    expect(isInAppBrowser(wechat)).toBe(true)
    expect(isInAppBrowser(iphone)).toBe(false)
    expect(supportsIntentUrl(androidChrome)).toBe(true)
    expect(supportsIntentUrl(androidFirefox)).toBe(false)
  })
})
