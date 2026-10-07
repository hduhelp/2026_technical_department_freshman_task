"use client"

import * as React from "react"
import {
  AnimatePresence,
  motion,
  type Transition,
  type Variants,
} from "motion/react"
import { CheckIcon, SparklesIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * 全站统一的动效词汇。原则：
 * - 短（180–420ms）、位移小（≤24px），只提示「状态变了」，不做装饰；
 * - 系统开启「减少动态效果」时由 MotionProvider（reducedMotion="user"）自动退化；
 * - 全部是客户端组件，可直接在 Server Component 里当容器用（children 透传）。
 */
export const DURATION = { fast: 0.18, base: 0.26, slow: 0.42 } as const

export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]

const base: Transition = { duration: DURATION.base, ease: EASE_OUT }

/** 入场：淡入 + 轻微上移。用于区块出现。 */
export function FadeIn({
  children,
  className,
  delay = 0,
  y = 10,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  y?: number
}) {
  return (
    <motion.div
      className={cn("min-w-0", className)}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...base, delay }}
    >
      {children}
    </motion.div>
  )
}

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: base },
}

/** 列表容器：子项依次入场（配 StaggerItem）。 */
export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      className={cn("min-w-0", className)}
      variants={listVariants}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  )
}

/** 列表子项：交给 StaggerList 控制节奏。 */
export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div className={cn("min-w-0", className)} variants={itemVariants}>
      {children}
    </motion.div>
  )
}

/** 点击反馈：按下去的瞬间缩一点点。只用在客户端小岛里，卡片优先用 CSS active:。 */
export function TapScale({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      className={cn("min-w-0", className)}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}

/** 一步一屏：切换步骤时左右滑动 + 淡入淡出。 */
export function StepTransition({
  stepKey,
  direction = 1,
  children,
  className,
}: {
  stepKey: string | number
  direction?: 1 | -1
  children: React.ReactNode
  className?: string
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={stepKey}
        className={cn("min-w-0", className)}
        initial={{ opacity: 0, x: 28 * direction }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -28 * direction }}
        transition={base}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** 展开 / 收起：高度自动动画。用于按需出现的表单与揭晓结果。 */
export function Collapse({
  open,
  children,
  className,
}: {
  open: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="collapse"
          className={cn("min-w-0 overflow-hidden", className)}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={base}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** 正反馈：操作成功后盖住整屏的对勾。由调用方自己决定什么时候关掉 / 跳走。 */
export function SuccessOverlay({
  show,
  message,
  testId = "success-overlay",
}: {
  show: boolean
  message?: string
  testId?: string
}) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="success"
          data-testid={testId}
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.fast }}
        >
          <motion.div
            className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 22 }}
          >
            <CheckIcon className="size-8" aria-hidden />
          </motion.div>
          {message ? (
            <motion.p
              className="text-sm text-muted-foreground"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...base, delay: 0.1 }}
            >
              {message}
            </motion.p>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** 进度条：值变化时平滑过渡，代替蹦一下的数字。 */
export function MotionBar({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  return (
    <div
      className={cn(
        "h-1 w-full overflow-hidden rounded-full bg-muted",
        className
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <motion.div
        className="h-full rounded-full bg-primary"
        initial={false}
        animate={{ width: Math.min(100, Math.max(0, value)) + "%" }}
        transition={{ duration: DURATION.slow, ease: EASE_OUT }}
      />
    </div>
  )
}

/**
 * 全屏加载：盖住整屏的等待态，带一个持续呼吸的动画。
 * 这是本文件里唯一允许「无限循环」的动效 —— 加载指示器必须持续运动，
 * 否则用户会以为卡死了（见 docs/UI-DESIGN.md §4 的例外说明）。
 * 关键：加载期间调用方不要把表单同时渲染出来（否则会出现两套输入框）。
 */
export function LoadingOverlay({
  show,
  message = "AI 正在写描述…",
  testId = "ai-loading",
}: {
  show: boolean
  message?: string
  testId?: string
}) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="loading"
          data-testid={testId}
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.fast }}
        >
          <div className="relative flex size-24 items-center justify-center">
            <motion.span
              className="absolute inset-0 rounded-full bg-primary/20"
              animate={{ scale: [0.8, 1.15, 0.8], opacity: [0.55, 0.1, 0.55] }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            <motion.span
              className="absolute inset-4 rounded-full bg-primary/25"
              animate={{ scale: [1.12, 0.86, 1.12], opacity: [0.3, 0.75, 0.3] }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            <motion.span
              className="relative flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground"
              animate={{ scale: [1, 1.08, 1] }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <SparklesIcon className="size-6" aria-hidden />
            </motion.span>
          </div>

          <p className="text-sm text-muted-foreground">{message}</p>

          <div className="flex gap-1.5">
            {[0, 1, 2].map((index) => (
              <motion.span
                key={index}
                className="size-1.5 rounded-full bg-muted-foreground/60"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: index * 0.2,
                }}
              />
            ))}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** 页面级入场：由 app/template.tsx 统一使用。 */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      className={cn("flex min-w-0 flex-1 flex-col", className)}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  )
}
