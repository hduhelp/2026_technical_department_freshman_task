"use client"

import { MotionConfig } from "motion/react"

/**
 * 动效无障碍开关：系统「减少动态效果」打开时，motion 自动跳过位移/缩放/布局动画，
 * 只保留必要的淡入淡出。必须包在整棵树外面。
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
