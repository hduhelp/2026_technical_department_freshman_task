"use client"

import * as React from "react"

import { FadeIn } from "@/components/motion/primitives"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type MeTabValue = "published" | "pickups"

/** 「我的」两个标签页：一屏只放一段列表，切换时淡入。 */
export function MeTabs({
  publishedCount,
  pickupCount,
  published,
  pickups,
}: {
  publishedCount: number
  pickupCount: number
  published: React.ReactNode
  pickups: React.ReactNode
}) {
  const [value, setValue] = React.useState<MeTabValue>("published")

  return (
    <Tabs
      className="flex-1 gap-4"
      value={value}
      onValueChange={(next) => setValue(next as MeTabValue)}
    >
      <TabsList className="w-full">
        <TabsTrigger value="published">我的发布 {publishedCount}</TabsTrigger>
        <TabsTrigger value="pickups">我的认领 {pickupCount}</TabsTrigger>
      </TabsList>

      <TabsContent value="published" className="flex flex-col">
        <FadeIn className="flex flex-1 flex-col gap-3">{published}</FadeIn>
      </TabsContent>

      <TabsContent value="pickups" className="flex flex-col">
        <FadeIn className="flex flex-1 flex-col gap-3">{pickups}</FadeIn>
      </TabsContent>
    </Tabs>
  )
}
