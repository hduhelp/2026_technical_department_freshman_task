import type { NextConfig } from "next"

/** 从环境变量推导 Supabase Storage 的主机名，用于 next/image 白名单。 */
function supabaseStorageHost(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

const host = supabaseStorageHost()

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // 精确主机名（构建时有环境变量时生效）
      ...(host
        ? [
            {
              protocol: "https" as const,
              hostname: host,
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : []),
      // 兜底：项目换域名或构建时没有环境变量时仍能显示图片
      {
        protocol: "https" as const,
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    // 表单只传路径字符串，这里留够 multipart 与字段的余量
    serverActions: { bodySizeLimit: "4mb" },
  },
}

export default nextConfig
