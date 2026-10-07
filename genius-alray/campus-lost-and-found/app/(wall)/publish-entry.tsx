"use client"

import { useLinkStatus } from "next/link"
import { Loader2Icon, PlusIcon } from "lucide-react"

/**
 * 首页「我捡到了东西」入口的**导航中**状态。
 *
 * 【为什么需要】发布页是 force-dynamic，进页面要查配置 / 资料 / 草稿 + 签一次图片 URL，
 * 弱网（尤其手机移动网络）下点进去要等一两秒。这段时间界面还停在首页、按钮毫无变化，
 * 看起来就是「点了没反应」。
 *
 * 【为什么用 useLinkStatus 而不是 useTransition + router.push】
 * 这个按钮本身就是 <Link>（Base UI 的 render 把 Button 渲染成链接，保留了
 * 「在新标签页打开」「右键复制链接」这些原生语义），useLinkStatus 正是为
 * 「Link 自身的导航等待」设计的：导航一开始它就变 true，不必等 RSC 回来。
 *
 * 注意它**必须**在 <Link> 内部调用 —— 下面这个组件正是被当作 Link 的 children
 * 渲染的（见 app/(wall)/page.tsx），所以能读到那次导航的 pending。
 */
export function PublishEntryContent({ label }: { label: string }) {
  const { pending } = useLinkStatus()

  if (pending) {
    return (
      <>
        <Loader2Icon className="animate-spin" aria-hidden />
        正在打开…
      </>
    )
  }

  return (
    <>
      <PlusIcon aria-hidden />
      {label}
    </>
  )
}
