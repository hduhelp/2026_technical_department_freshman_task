"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { findSimilarItems, insertItem, setItemStatus } from "@/lib/data/items"
import { MISSING_CONFIG_MESSAGE } from "@/lib/env"
import { publicPhotoUrl } from "@/lib/storage"
import { tryCreateSupabaseServerClient } from "@/lib/supabase/server"
import type { ItemKind, ItemStatus } from "@/lib/supabase/types"
import { validateItemDraft } from "@/lib/validation"
import type { ItemFormState, SimilarItemView } from "@/lib/actions/state"

export type CheckSimilarResult =
  { ok: true; items: SimilarItemView[] } | { ok: false; message: string }

function toIsoOrNull(value: string): string | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/**
 * 提交前的相似检测，也在用户输入时防抖调用。
 * 语义：发「丢失」去找「拾获」的帖子，反之亦然。
 */
export async function checkSimilarAction(
  formData: FormData
): Promise<CheckSimilarResult> {
  const kind = String(formData.get("kind") ?? "")
  if (kind !== "lost" && kind !== "found") {
    return { ok: false, message: "帖子类型不正确" }
  }

  const title = String(formData.get("title") ?? "").trim()
  // 关键字太短时匹配结果几乎全是噪音，直接不检
  if (title.length < 2) return { ok: true, items: [] }

  const supabase = await tryCreateSupabaseServerClient()
  if (!supabase) return { ok: false, message: MISSING_CONFIG_MESSAGE }

  const opposite: ItemKind = kind === "lost" ? "found" : "lost"

  try {
    const items = await findSimilarItems(supabase, {
      kind: opposite,
      title,
      description: String(formData.get("description") ?? ""),
      location: String(formData.get("location") ?? ""),
      happenedAt: toIsoOrNull(String(formData.get("happened_at") ?? "")),
    })
    return {
      ok: true,
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        location: item.location,
        happenedAt: item.happened_at,
        imageUrl: publicPhotoUrl(item.image_path),
        score: item.score,
      })),
    }
  } catch {
    return { ok: false, message: "相似检测失败，请稍后重试" }
  }
}

export async function createItemAction(
  formData: FormData
): Promise<ItemFormState> {
  const supabase = await tryCreateSupabaseServerClient()
  if (!supabase) return { fieldErrors: {}, formError: MISSING_CONFIG_MESSAGE }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { fieldErrors: {}, formError: "请先登录后再发布" }

  // 不信任客户端：所有字段在这里再校验一遍
  const parsed = validateItemDraft(formData)
  if (!parsed.ok) return { fieldErrors: parsed.errors }

  const draft = parsed.value
  if (draft.imagePath && !draft.imagePath.startsWith(user.id + "/")) {
    return { fieldErrors: {}, formError: "图片路径不合法，请重新上传" }
  }

  const inserted = await insertItem(supabase, user.id, draft)
  if (!inserted.ok) return { fieldErrors: {}, formError: inserted.message }

  revalidatePath("/items")
  revalidatePath("/items/" + inserted.id)
  redirect("/items/" + inserted.id + "?created=1")
}

/** 只有作者能改状态：RLS 保证越权时影响行数为 0。 */
export async function setItemStatusAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "")
  const status = String(formData.get("status") ?? "")
  if (!id || (status !== "open" && status !== "resolved")) return

  const supabase = await tryCreateSupabaseServerClient()
  if (!supabase) return

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/items/" + id)

  await setItemStatus(supabase, id, status as ItemStatus)
  revalidatePath("/items")
  revalidatePath("/items/" + id)
}
