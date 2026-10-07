"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  getAppConfig,
  listImagesForItems,
  listWallItems,
  mergeImages,
  revealContact,
} from "@/lib/db/found-items"
import { createPickup, releaseClaim } from "@/lib/db/pickups"
import { DbError } from "@/lib/db/types"
import { createSignedUrlMap } from "@/lib/storage/signed"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import { pickupSchema } from "@/lib/validation/schemas"
import type { RevealedContact } from "@/lib/types"

import type { LoadMoreResult, PickupResult, SimpleResult } from "./types"

/**
 * 「拿错了，不是我的」：撤回自己的认领。
 * 认领记录保留（数据库侧不删行，只打 released_at），所以他还能再认领；
 * 只有没有其他人还在认领时，物品才回到待认领（由 RPC 判定）。
 */
export async function releaseClaimAction(
  itemId: string
): Promise<SimpleResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, message: "登录已过期，请重新登录" }

  const parsed = z.string().uuid().safeParse(itemId)
  if (!parsed.success) return { ok: false, message: "参数不合法" }

  try {
    const supabase = await createClient()
    await releaseClaim(supabase, parsed.data)
    revalidatePath("/")
    revalidatePath("/items/" + parsed.data)
    revalidatePath("/me")
    return { ok: true, message: "已撤回认领" }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof DbError) return error.message
  if (error instanceof Error && error.message) return error.message
  return "操作失败，请稍后重试"
}

const offsetSchema = z.number().int().min(0).max(100000)

/**
 * 失物墙「加载更多」。
 * 只读动作，但仍是不可信入口：先鉴权，再用 zod 校验 offset；
 * 每页条数一律取自 app_config，绝不接受客户端传入。
 */
export async function loadMoreItemsAction(
  offset: number
): Promise<LoadMoreResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "请先登录" }

  const parsed = offsetSchema.safeParse(offset)
  if (!parsed.success) return { ok: false, error: "参数不合法" }

  const supabase = await createClient()
  try {
    const config = await getAppConfig(supabase)
    const limit = Math.max(config?.page_size ?? 20, 1)

    const items = await listWallItems(supabase, {
      limit,
      offset: parsed.data,
    })
    const images = await listImagesForItems(
      supabase,
      items.map((item) => item.id)
    )
    const urlByPath = await createSignedUrlMap(
      images.map((image) => image.storage_path)
    )

    return {
      ok: true,
      items: mergeImages(items, images, urlByPath),
      hasMore: items.length >= limit,
    }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/**
 * 认领：**只提交物品 id**。
 * 实名信息由 create_pickup 在服务端从 profiles 取（客户端提交的姓名手机号一律不算数），
 * 频率限制也由该 RPC 强制：1 小时 2 次 / 24 小时 5 次，阈值见 app_config。
 * 认领即归属（物品置为 claimed），成功后立刻揭晓拾主的联系方式或位置。
 */
export async function createPickupAction(input: {
  itemId: string
}): Promise<PickupResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "请先登录" }

  const parsed = pickupSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "请检查填写内容",
    }
  }

  const supabase = await createClient()
  try {
    await createPickup(supabase, parsed.data.itemId)

    let revealed: RevealedContact | null = null
    try {
      revealed = await revealContact(supabase, parsed.data.itemId)
    } catch {
      revealed = null
    }

    revalidatePath("/items/[id]", "page")
    return { ok: true, revealed }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}
