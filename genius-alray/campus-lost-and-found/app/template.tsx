import { PageTransition } from "@/components/motion/primitives"
import { TitleBarProvider } from "@/components/nav/title-bar"

/**
 * 每次导航都重新挂载：
 * 1) 统一做一次轻量的页面入场；
 * 2) 在这里提供全站唯一的标题栏（页面里不要再自己画）。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <PageTransition>
      <TitleBarProvider>{children}</TitleBarProvider>
    </PageTransition>
  )
}
