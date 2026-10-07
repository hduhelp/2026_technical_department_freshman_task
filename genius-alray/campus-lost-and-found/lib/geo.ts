/**
 * 坐标与地图链接。
 *
 * 【为什么需要转换】浏览器的 `navigator.geolocation` 返回的是 **WGS84**（GPS 原始坐标），
 * 而国内地图（高德/腾讯）用的是 **GCJ-02**（火星坐标）。直接把 WGS84 丢给高德会偏移
 * 几百米 —— 对一个「去这里取回你丢的东西」的场景来说是不可接受的。
 * 这里用公开的 WGS84 → GCJ-02 转换算法（境外坐标不做偏移）。
 */
const A = 6378245.0
const EE = 0.006_693_421_622_965_943

function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let ret =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x))
  ret +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  ret +=
    ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
  ret +=
    ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) *
      2) /
    3
  return ret
}

function transformLng(x: number, y: number): number {
  let ret =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  ret +=
    ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
  ret +=
    ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) *
      2) /
    3
  return ret
}

export function wgs84ToGcj02(
  lat: number,
  lng: number
): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng }
  const dLat = transformLat(lng - 105, lat - 35)
  const dLng = transformLng(lng - 105, lat - 35)
  const radLat = (lat / 180) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  return {
    lat:
      lat + (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI),
    lng: lng + (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI),
  }
}

/** 使用方来源信息：高德建议填写（"为保证服务质量建议填写"），也是排查流量来源的唯一线索 */
const AMAP_SRC = "campus-lost-found"

/** 高德地图安卓包名：`intent://` 里用它精确唤起（装了才唤起，没装按 fallback 回落网页版） */
const AMAP_ANDROID_PACKAGE = "com.autonavi.minimap"

/**
 * 高德「标记点」**网页版**链接（`coordinate=gaode` 表示传进去的是 GCJ-02）。
 *
 * 用途只有一个：桌面端、没装 App、以及微信这类内嵌浏览器里的落地页。
 * 手机端正常路径是直接用 scheme / intent 唤起 App（见 `amapMarkerTarget` 与
 * `planAmapLaunch`）—— 高德自己的 H5（m.amap.com）虽然也认 `callnative=1`，
 * 但落地后仍要用户再点一次「打开高德地图」，不是真正的自动跳转。
 * 文档：https://lbs.amap.com/api/uri-api/guide/mobile-web/point
 */
export function amapMarkerUrl(input: {
  lat: number
  lng: number
  label?: string
}): string {
  const gcj = wgs84ToGcj02(input.lat, input.lng)
  const params = new URLSearchParams({
    position: gcj.lng.toFixed(6) + "," + gcj.lat.toFixed(6),
    coordinate: "gaode",
    callnative: "1",
    src: AMAP_SRC,
  })
  if (input.label) params.set("name", input.label)
  return "https://uri.amap.com/marker?" + params.toString()
}

/** 只有位置描述、没有坐标时：用高德搜地点（网页版） */
export function amapSearchUrl(keyword: string): string {
  const params = new URLSearchParams({
    keyword,
    callnative: "1",
    src: AMAP_SRC,
  })
  return "https://uri.amap.com/search?" + params.toString()
}

/** 高德 App 的唤起链接（三种，按平台/浏览器取用） */
export type AmapAppLinks = {
  /** iOS 原生 scheme：装了高德就一步进 App */
  ios: string
  /** 安卓原生 scheme（非 Chromium 内核的浏览器用） */
  android: string
  /** 安卓 `intent://`：带 `S.browser_fallback_url`，没装 App 时 Chrome 自己跳网页版 */
  androidIntent: string
}

/** 一次「查看定位」需要的东西：网页版 + App 唤起链接 */
export type AmapTarget = {
  web: string
  app: AmapAppLinks
}

/** scheme 的 query 用 encodeURIComponent（URLSearchParams 会把空格编成 +，scheme 里会被当字面量） */
function amapAppQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => key + "=" + encodeURIComponent(value))
    .join("&")
}

/**
 * 安卓 `intent://` 链接。
 *
 * 比直接跳 `androidamap://` 多一层保险：没装高德时 Chrome 不会停在
 * `ERR_UNKNOWN_URL_SCHEME` 错误页（那样我们连兜底的 JS 都没机会跑），
 * 而是按 `S.browser_fallback_url` 自动跳到高德网页版。
 */
function androidIntent(data: string, fallback: string): string {
  return (
    "intent://" +
    data +
    "#Intent;scheme=androidamap;package=" +
    AMAP_ANDROID_PACKAGE +
    ";S.browser_fallback_url=" +
    encodeURIComponent(fallback) +
    ";end"
  )
}

/**
 * 标记点：网页版 + App 唤起链接。
 *
 * `dev=0` 表示「lat/lon 已经是加密后的高德坐标（GCJ-02），不需要再做国测加密」——
 * 我们上面刚做完 WGS84 → GCJ-02，所以必须是 0（官方文档：dev=1 才需要再加密）。
 * 文档：https://lbs.amap.com/api/amap-mobile/guide/android/marker
 */
export function amapMarkerTarget(input: {
  lat: number
  lng: number
  label?: string
}): AmapTarget {
  const gcj = wgs84ToGcj02(input.lat, input.lng)
  const query = amapAppQuery({
    sourceApplication: AMAP_SRC,
    poiname: input.label?.trim() || "拾获位置",
    lat: gcj.lat.toFixed(6),
    lon: gcj.lng.toFixed(6),
    dev: "0",
  })
  const web = amapMarkerUrl(input)
  return {
    web,
    app: {
      ios: "iosamap://viewMap?" + query,
      android: "androidamap://viewMap?" + query,
      androidIntent: androidIntent("viewMap?" + query, web),
    },
  }
}

/**
 * 搜索地点：网页版 + App 唤起链接。
 *
 * 注意关键词的参数名两个平台不一样（高德官方文档如此）：iOS 是 `name`，安卓是 `keywords`。
 * 文档：https://lbs.amap.com/api/amap-mobile/guide/ios/search
 */
export function amapSearchTarget(keyword: string): AmapTarget {
  const web = amapSearchUrl(keyword)
  const iosQuery = amapAppQuery({
    sourceApplication: AMAP_SRC,
    name: keyword,
    dev: "0",
  })
  const androidQuery = amapAppQuery({
    sourceApplication: AMAP_SRC,
    keywords: keyword,
    dev: "0",
  })
  return {
    web,
    app: {
      ios: "iosamap://poi?" + iosQuery,
      android: "androidamap://poi?" + androidQuery,
      androidIntent: androidIntent("poi?" + androidQuery, web),
    },
  }
}

export type MobileOs = "ios" | "android" | "other"

/** 手机系统（只用来挑 scheme；桌面与鸿蒙都归 "other"，一律走网页版） */
export function detectMobileOs(userAgent: string): MobileOs {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios"
  // iPadOS 13+ 的 Safari 自称 Macintosh，只能靠触摸点数认出来
  const touchPoints =
    typeof navigator === "undefined" ? 0 : (navigator.maxTouchPoints ?? 0)
  if (/Macintosh/.test(userAgent) && touchPoints > 1) return "ios"
  if (/Android/.test(userAgent)) return "android"
  return "other"
}

/**
 * 微信 / QQ / 微博 / 支付宝等内嵌浏览器：自定义 scheme 基本必被拦，
 * 硬跳只会留下一个无响应的空白页，所以这些环境直接给网页版。
 */
export function isInAppBrowser(userAgent: string): boolean {
  return /MicroMessenger|QQ\/|Weibo|DingTalk|AlipayClient|Aweme|Douyin|Lark\//i.test(
    userAgent
  )
}

/** Chromium 系（Chrome/WebView/三星/Edge…）才认 `intent://` 与 `S.browser_fallback_url` */
export function supportsIntentUrl(userAgent: string): boolean {
  return /Chrome|Chromium|CriOS|SamsungBrowser|EdgA/i.test(userAgent)
}

/** 「点一下」之后到底走哪条路 */
export type AmapLaunchPlan =
  | { kind: "web"; url: string; reason: "desktop" | "in-app-browser" }
  | {
      kind: "app"
      url: string
      fallback: string
      platform: "ios" | "android"
      mode: "scheme" | "intent"
    }

/**
 * 决定「打开高德」这一步怎么走：能在手机上一步进 App 就一步进，
 * 其余情况（桌面、内嵌浏览器、鸿蒙等）老实打开网页版。
 */
export function planAmapLaunch(input: {
  userAgent: string
  target: AmapTarget
}): AmapLaunchPlan {
  const { userAgent, target } = input

  if (isInAppBrowser(userAgent)) {
    return { kind: "web", url: target.web, reason: "in-app-browser" }
  }

  const os = detectMobileOs(userAgent)
  if (os === "ios") {
    return {
      kind: "app",
      url: target.app.ios,
      fallback: target.web,
      platform: "ios",
      mode: "scheme",
    }
  }
  if (os === "android") {
    const useIntent = supportsIntentUrl(userAgent)
    return {
      kind: "app",
      url: useIntent ? target.app.androidIntent : target.app.android,
      fallback: target.web,
      platform: "android",
      mode: useIntent ? "intent" : "scheme",
    }
  }
  return { kind: "web", url: target.web, reason: "desktop" }
}

/**
 * 执行唤起（只在浏览器里调用）。
 *
 * 手机端直接跳 scheme / intent，装了高德就是**一步**进 App，不再落到高德网页版
 * 让用户点第二次。兜底：约 2 秒后页面仍然可见（说明没被 App 接管，例如没装高德、
 * 或浏览器拦了 scheme）就退到高德网页版；一旦页面被切到后台就说明已经进 App，
 * 定时器立刻取消，不会把用户又拽回浏览器。
 */
export function launchAmapApp(
  plan: Extract<AmapLaunchPlan, { kind: "app" }>,
  timeoutMs = 2000
): void {
  let settled = false

  const timer = window.setTimeout(() => {
    if (settled || document.visibilityState === "hidden") return
    settled = true
    window.location.href = plan.fallback
  }, timeoutMs)

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState !== "hidden") return
      settled = true
      window.clearTimeout(timer)
    },
    { once: true }
  )

  window.location.href = plan.url
}
