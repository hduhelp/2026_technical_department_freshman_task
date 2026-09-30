import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"

import "./globals.css"
import { SiteHeader } from "@/components/site-header"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { SITE_NAME } from "@/lib/constants"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

export const metadata: Metadata = {
  title: {
    default: SITE_NAME,
    template: "%s · " + SITE_NAME,
  },
  description: "校园里的失物与招领，发一条帖子让东西回到主人手里。",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn("antialiased", inter.variable, "font-sans")}
    >
      <body>
        <ThemeProvider>
          {/* 移动端优先：桌面端也收窄到单手可及的宽度 */}
          <div className="mx-auto flex min-h-svh w-full max-w-[480px] flex-col bg-background">
            <SiteHeader />
            <main className="flex flex-1 flex-col">{children}</main>
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
