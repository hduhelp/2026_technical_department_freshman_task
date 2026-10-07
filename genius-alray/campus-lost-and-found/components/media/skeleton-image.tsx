"use client"

import * as React from "react"
import { ImageOffIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * 带骨架屏的图片：全站图片统一用它。
 *
 * 【为什么不能用裸 <img>】签名 URL 可能过期，弱网下也要等好几秒：
 * 裸 <img> 在加载中是一片空白（卡片直接塌成 0 高），加载失败还会把浏览器的
 * 「破图 + alt 文本」露给用户。这里统一处理三态：
 * - loading：按占位比例撑开 + 呼吸骨架，卡片不会塌；
 * - loaded ：图片淡入（系统「减少动态效果」时不做过渡）；
 * - error  ：换成图标 + 一句人话，绝不显示破图。
 *
 * 【为什么必须是客户端组件】只有 onLoad / onError 能知道图片的真实状态，
 * CSS 拿不到「已加载」这个信号。
 */
export function SkeletonImage({
  src,
  alt,
  className,
  imgClassName,
  aspectClassName = "aspect-[4/3]",
  fill = false,
  eager = false,
  errorText = "图片暂时无法显示",
  testId,
}: {
  src: string
  alt: string
  /** 容器类名（尺寸、圆角、flex/snap 之类的布局约束都写这里） */
  className?: string
  /** 图片元素类名 */
  imgClassName?: string
  /** 占位用的宽高比；fill 模式下加载完也保留，自然模式下加载完就撤掉 */
  aspectClassName?: string
  /** true：容器尺寸由外部固定（如正方形轮播位），图片绝对定位铺满 */
  fill?: boolean
  /** 首屏第一张图用 eager，别让它排队等懒加载 */
  eager?: boolean
  /** 加载失败时的说明；传 null 就只留图标（小缩略图用） */
  errorText?: string | null
  testId?: string
}) {
  const imgRef = React.useRef<HTMLImageElement | null>(null)
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">(
    "loading"
  )

  /**
   * 缓存命中时浏览器不会再触发 onLoad（SSR 出来的 <img> 尤其明显），
   * 那样骨架会一直挂着 —— 所以挂载 / 换 src 之后主动查一次 complete。
   */
  React.useEffect(() => {
    const img = imgRef.current
    if (!img) return
    if (!img.complete) {
      setStatus("loading")
      return
    }
    setStatus(img.naturalWidth > 0 ? "loaded" : "error")
  }, [src])

  const loaded = status === "loaded"
  // 自然模式下加载完就撤掉占位比例，让图片按真实宽高比撑开容器（瀑布流靠这个错落）
  const reserveAspect = fill || !loaded

  return (
    <div
      data-testid={testId}
      className={cn(
        "relative overflow-hidden bg-muted",
        !fill && "w-full",
        reserveAspect && aspectClassName,
        className
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={cn(
          "transition-opacity duration-300 select-none motion-reduce:transition-none",
          loaded ? "opacity-100" : "opacity-0",
          fill
            ? "absolute inset-0 size-full object-cover"
            : "h-auto w-full object-cover",
          imgClassName
        )}
      />

      {status === "loading" ? (
        <span
          aria-hidden
          data-testid={testId ? testId + "-skeleton" : undefined}
          className="absolute inset-0 animate-pulse bg-muted motion-reduce:animate-none"
        />
      ) : null}

      {status === "error" ? (
        <span
          data-testid={testId ? testId + "-error" : undefined}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted px-2 text-center text-muted-foreground"
        >
          <ImageOffIcon className="size-6 shrink-0" aria-hidden />
          {errorText ? (
            <span className="text-[11px] leading-tight">{errorText}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
