"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import { ImageIcon } from "lucide-react"

import { SkeletonImage } from "@/components/media/skeleton-image"
import { DURATION, EASE_OUT } from "@/components/motion/primitives"

/**
 * 详情页照片浏览：原生 scroll-snap 横向轮播（手指滑动最跟手）。
 * 没有左右箭头；圆点可点按跳转，计数器显示当前页。
 * E2E 依赖：gallery-track / gallery-dot-N / gallery-counter。
 */
export function ItemGallery({
  images,
  title,
}: {
  images: Array<{ path: string; url: string }>
  title: string
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [index, setIndex] = useState(0)
  const count = images.length

  // 滚动即更新当前页（scrollLeft / clientWidth 四舍五入）；卸载时移除监听
  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    const handleScroll = () => {
      const width = track.clientWidth
      if (width === 0) return
      const next = Math.round(track.scrollLeft / width)
      setIndex((prev) =>
        prev === next ? prev : Math.min(count - 1, Math.max(0, next))
      )
    }

    track.addEventListener("scroll", handleScroll, { passive: true })
    return () => track.removeEventListener("scroll", handleScroll)
  }, [count])

  if (count === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-foreground/10">
        <ImageIcon className="size-8" aria-hidden />
      </div>
    )
  }

  const safeIndex = Math.min(index, count - 1)

  function goTo(next: number) {
    const track = trackRef.current
    if (!track) return
    const width = track.clientWidth
    if (width === 0) return
    track.scrollTo({ left: width * next, behavior: "smooth" })
    setIndex(next)
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        ref={trackRef}
        data-testid="gallery-track"
        role="group"
        aria-label="物品照片"
        className="flex w-full snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain scroll-smooth rounded-2xl bg-muted ring-1 ring-foreground/10 [&::-webkit-scrollbar]:hidden"
      >
        {images.map((image, imageIndex) =>
          image.url ? (
            <SkeletonImage
              key={image.path}
              src={image.url}
              alt={title}
              fill
              eager={imageIndex === 0}
              aspectClassName="aspect-square"
              className="w-full shrink-0 snap-center"
              testId={"gallery-image-" + imageIndex}
            />
          ) : (
            <div
              key={image.path}
              className="flex aspect-square w-full shrink-0 snap-center items-center justify-center text-muted-foreground select-none"
            >
              <ImageIcon className="size-8" aria-hidden />
            </div>
          )
        )}
      </div>

      {count > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {images.map((image, imageIndex) => (
            <button
              key={image.path}
              type="button"
              aria-label={"第 " + (imageIndex + 1) + " 张照片"}
              aria-current={imageIndex === safeIndex}
              data-testid={"gallery-dot-" + imageIndex}
              onClick={() => goTo(imageIndex)}
              className="flex size-4 items-center justify-center"
            >
              <motion.span
                aria-hidden
                initial={false}
                animate={{ opacity: imageIndex === safeIndex ? 1 : 0.25 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                className="block size-2 rounded-full bg-foreground"
              />
            </button>
          ))}
          <span
            aria-live="polite"
            className="ml-1 text-xs text-muted-foreground"
            data-testid="gallery-counter"
          >
            {safeIndex + 1}/{count}
          </span>
        </div>
      ) : null}
    </div>
  )
}
