import { HandHeartIcon, PackageSearchIcon } from "lucide-react"

import { KindCard } from "@/components/home/kind-card"

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-4 py-8">
      <div className="mb-2 flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold">
          你要找东西，还是捡到东西了？
        </h1>
        <p className="text-sm text-muted-foreground">
          校园里的失物与招领，都从这里开始。
        </p>
      </div>

      <KindCard
        href="/items"
        title="我丢了东西"
        description="先翻翻列表里有没有人捡到，也可以发一条寻找启事"
        icon={PackageSearchIcon}
      />

      <KindCard
        href="/post/found"
        title="我捡到东西了"
        description="直接发一条招领启事，帮它回到主人手里"
        icon={HandHeartIcon}
        tone="primary"
      />
    </div>
  )
}
