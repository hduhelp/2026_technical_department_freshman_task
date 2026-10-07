"use client"

import * as React from "react"
import { AnimatePresence, motion } from "motion/react"

import { DURATION, EASE_OUT } from "@/components/motion/primitives"

/** 让卡片内的操作按钮通知外层容器：这张卡该消失了。 */
const MeItemCloseContext = React.createContext<(() => void) | null>(null)

export function useMeItemClose(): (() => void) | null {
  return React.useContext(MeItemCloseContext)
}

/** 撤单成功后：整张卡片淡出并移出列表。 */
export function MeItemShell({
  itemId,
  children,
}: {
  itemId: string
  children: React.ReactNode
}) {
  const [visible, setVisible] = React.useState(true)
  const close = React.useCallback(() => setVisible(false), [])

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          key={itemId}
          className="min-w-0"
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
        >
          <MeItemCloseContext.Provider value={close}>
            {children}
          </MeItemCloseContext.Provider>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
