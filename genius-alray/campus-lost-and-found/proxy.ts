import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

// Next.js 16 起 middleware.ts 更名为 proxy.ts。
// 这里只做「乐观跳转」：刷新 session + 未登录重定向。
// 真正的授权由 RLS 与每个 Server Action 内的 getCurrentUser() 承担。
// 只有登录/注册页会把已登录用户弹回首页
const AUTH_PATHS = ["/login", "/signup"]
// 未登录也能访问（首屏信息流可以看，但详情页会要求登录）
// PWA 三件套必须无条件可达：离线页 / Service Worker / 清单。
// 少了这一条，未登录访客请求 /manifest.webmanifest 会被 307 到 /login，
// 而 Service Worker 会把「登录页」当成离线页缓存下来 —— 装到桌面后断网就废了。
const PUBLIC_PATHS = [
  "/",
  "/terms",
  "/privacy",
  "/offline",
  "/sw.js",
  "/manifest.webmanifest",
]

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname, search } = request.nextUrl

  // API 路由自己完成鉴权并返回 401。若在此跳转，fetch/XHR 会拿到 307 而不是可处理的 401。
  // 注意：上面对 supabase.auth.getUser() 的调用已经完成了 session 刷新。
  if (pathname.startsWith("/api/")) {
    return response
  }

  const isAuthPath = AUTH_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  )
  const isPublic = isAuthPath || PUBLIC_PATHS.includes(pathname)

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    if (pathname !== "/") url.searchParams.set("next", pathname + search)
    return NextResponse.redirect(url)
  }

  if (user && isAuthPath) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // 静态资源与 PWA 三件套不进 proxy：省一次 auth 往返，也不会被乐观跳转改写
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|offline|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
