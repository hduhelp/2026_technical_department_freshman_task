import type { Metadata, Viewport } from "next"
import { Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { MotionProvider } from "@/components/motion/motion-provider"
import { PwaInstallProvider } from "@/components/pwa/install-prompt"
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register"
import { StatusBarKeeper } from "@/components/pwa/status-bar-keeper"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "校园失物招领",
  description: "拍照发布捡到的物品，浏览失物墙，留下领取信息找回失物。",
  applicationName: "校园失物招领",
  // 「添加到主屏幕」后以独立窗口启动：Android 读 app/manifest.ts，
  // iOS 认这几个 apple-* 元信息（站点标题、状态栏样式）。
  appleWebApp: {
    capable: true,
    title: "失物招领",
    statusBarStyle: "default",
  },
  // Next 对 capable 只输出标准化的 mobile-web-app-capable；老一些的 iOS
  // 只认 apple-mobile-web-app-capable，这里补一条（两条同时存在没有副作用）。
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
}

// 移动端优先：锁定 1:1 缩放，避免 412px 视口出现横向缩放
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // 独立窗口下状态栏跟着主题走。manifest 里写不了 media query，
  // 这里用 <meta name="theme-color"> 覆盖，iOS 15+/Android Chrome 都认。
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  // 首屏渲染前就告诉浏览器本站支持深色，避免深色下先闪一帧白底
  colorScheme: "light dark",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body>
        <ThemeProvider>
          {/* PWA：拦截浏览器自己的安装提示，改由首页标题栏的「安装应用」按钮触发 */}
          <PwaInstallProvider>
            {/* Base UI 的 Toaster 同时是 Provider，必须包裹整棵树。
              toast 显示在顶部，会短暂盖住标题栏，所以把停留时间收到 3 秒。 */}
            <Toaster timeout={3000}>
              {/* MotionProvider：系统「减少动态效果」时全站动效自动退化 */}
              <MotionProvider>
                {/* PWA：只在生产构建里注册 Service Worker（见组件内注释） */}
                <ServiceWorkerRegister />
                {/* PWA：路由切换时 Next 会重建 <head> 元信息，这里防止顶部状态栏闪白 */}
                <StatusBarKeeper />
                <div className="mx-auto flex min-h-svh w-full max-w-md flex-col">
                  <main className="flex min-w-0 flex-1 flex-col">
                    {children}
                  </main>
                </div>
              </MotionProvider>
            </Toaster>
          </PwaInstallProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
