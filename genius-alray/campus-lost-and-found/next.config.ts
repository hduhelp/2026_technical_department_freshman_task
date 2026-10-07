import type { NextConfig } from "next"

import { checkDeployEnv } from "./lib/deploy-env"

const isDev = process.env.NODE_ENV === "development"

/**
 * 部署前哨：配置写错最好是「构建失败」，而不是「上线后才发现」。
 * 规则本身（以及每条为什么）在 lib/deploy-env.ts，那边有单测覆盖。
 */
const deployEnv = checkDeployEnv(process.env)
for (const warning of deployEnv.warnings) console.warn(warning)
if (deployEnv.errors.length > 0) {
  throw new Error(deployEnv.errors.join("\n"))
}

/** 浏览器端 supabase-js 要直连 Supabase（登录、直读公开列），必须进 connect-src / img-src */
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin
  } catch {
    return ""
  }
})()

/**
 * 站点存着姓名与手机号，CSP 是 XSS 之外唯一还能兜住的一层。
 *
 * 【为什么 script-src 里有 'unsafe-inline'】Next 的水合引导脚本是内联的，
 * 不用 nonce 就只能放行内联。这确实削弱了 CSP 对 XSS 的防护，但 object-src /
 * base-uri / form-action / frame-ancestors 仍然把注入面收窄了；要彻底去掉它
 * 得给每个请求发 nonce（改 proxy.ts），留待后续。
 * dev 下额外需要 'unsafe-eval'（HMR / source map），并放行 HMR 的 websocket。
 *
 * 【为什么 Turnstile 的域名是无条件写死的】登录/注册页的人机校验由
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY 决定渲不渲染，但 CSP 是构建期产物。
 * 让 CSP 跟着那个变量变，就又制造了一个「构建时没配好 → 运行期被浏览器拦掉」
 * 的隐形故障（正是 checkDeployEnv 要消灭的那类）。多放行这一个厂商域名，
 * 换的是「配了 sitekey 就一定能用」。
 */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com"

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE_ORIGIN}${isDev ? " 'unsafe-eval'" : ""}`,
  // Tailwind 与 motion 都会写内联 style
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseOrigin ? " " + supabaseOrigin : ""}`,
  "font-src 'self' data:",
  `connect-src 'self' ${TURNSTILE_ORIGIN}${supabaseOrigin ? " " + supabaseOrigin : ""}${
    isDev ? " ws: wss:" : ""
  }`,
  // Turnstile 的挑战控件是跨源 iframe（Cloudflare 官方要求 frame-src 放行）
  `frame-src 'self' ${TURNSTILE_ORIGIN}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // 声明过的类型就是真实类型：上传接口已按魔数校验，这里再断掉浏览器的嗅探
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()",
  },
  // 本机是 http，发 HSTS 没有意义，只在非 dev 下发。
  // 【故意不带 includeSubDomains】这个域名下别的子域不归我们管：
  // 任何一个还在用 http 的子域（或同事本地的 hosts 映射）都会当场被浏览器拒掉，
  // 而 max-age 是两年、撤销成本极高。等确实自建了整片子域再说。
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000",
        },
      ]),
]

const nextConfig: NextConfig = {
  poweredByHeader: false,

  // Next 16 默认只信任启动时的 hostname（localhost）。
  // 通过 127.0.0.1 访问时 /_next/hmr 会被判定为跨源并拦截，导致整站不 hydrate。
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // Service Worker 绝不进 HTTP 缓存：否则浏览器会一直用旧版本，
  // 「改了缓存策略但不生效」会变成最难查的一类问题。
  async headers() {
    return [
      {
        // 全站安全响应头
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ]
  },
}

export default nextConfig
