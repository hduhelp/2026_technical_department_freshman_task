/**
 * Service Worker：让「添加到主屏幕」后的校园失物招领在断网/弱网时也能打开。
 *
 * 【缓存口径】宁可不缓存，也不缓存错东西：
 * - 只处理同源 GET。跨域（Supabase / 高德）与 `/api/` 一律不碰。
 * - 导航请求走 network-first：断网时回落到预缓存的 /offline 页。
 *   业务页面（失物墙、详情、我的）都依赖登录态与数据库，绝不缓存它们的 HTML ——
 *   否则会出现「退出登录后还能看到上一用户的页面」这类事故。
 * - 只有 /_next/static/**、/icons/** 这类内容哈希命名的静态资源走 cache-first。
 * - RSC / 预取请求只看网络：它们是带 `RSC` 头的特殊响应，塞进缓存没有意义。
 *
 * 【更新】改缓存策略时把 VERSION 加一；activate 里会删掉所有旧版本的缓存。
 * 【注册】见 components/pwa/service-worker-register.tsx —— 只在生产构建里注册。
 */
const VERSION = "v1"
const PRECACHE = "campus-lost-found-precache-" + VERSION
const RUNTIME = "campus-lost-found-runtime-" + VERSION

/** 离线页 + 图标 + 清单：断网时唯一还能自证身份的东西 */
const PRECACHE_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE)
      // 逐个 add：任何一个 404 都不要让整个安装失败，否则 SW 永远装不上
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }))
          } catch {
            // 忽略：缺一个图标不该阻止离线能力
          }
        })
      )
      await self.skipWaiting()
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key !== PRECACHE && key !== RUNTIME)
          .map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

/** 内容哈希命名的静态资源：命中就直接用，不用再问网络 */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|gif|svg|webp|ico)$/.test(url.pathname)
  )
}

async function offlineResponse() {
  const cache = await caches.open(PRECACHE)
  const page = await cache.match("/offline")
  if (page) return page
  return new Response("当前没有网络连接", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return

  const url = new URL(request.url)
  // 跨域（Supabase、高德、字体 CDN）与上传接口不归 SW 管
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch {
          return await offlineResponse()
        }
      })()
    )
    return
  }

  // RSC / 预取请求：带 RSC 头，响应体不是普通 HTML，不缓存
  if (request.headers.get("RSC") || request.headers.get("Next-Router-Prefetch")) {
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME)
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok && response.type === "basic") {
          cache.put(request, response.clone())
        }
        return response
      })()
    )
  }
})
