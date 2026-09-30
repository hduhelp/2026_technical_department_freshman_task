export const USERNAME_MIN = 2
export const USERNAME_MAX = 20
export const PASSWORD_MIN = 6
export const TITLE_MAX = 60
export const DESCRIPTION_MAX = 1000
export const LOCATION_MAX = 80
export const CONTACT_MAX = 100

/** 允许中英文、数字、下划线 */
const USERNAME_ALLOWED = /^[A-Za-z0-9_\u4e00-\u9fa5]+$/

export type FieldErrors = Record<string, string>

/** 用户名归一化：去掉首尾空白并做 NFKC，避免全角/半角被当成两个账号。 */
export function normalizeUsername(raw: string): string {
  return raw.trim().normalize("NFKC")
}

export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw)
  if (!username) return "请填写用户名"
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return (
      "用户名长度需在 " + USERNAME_MIN + " 到 " + USERNAME_MAX + " 个字符之间"
    )
  }
  if (!USERNAME_ALLOWED.test(username)) {
    return "用户名只能包含中文、英文字母、数字和下划线"
  }
  return null
}

export function validatePassword(password: string): string | null {
  if (!password) return "请填写密码"
  if (password.length < PASSWORD_MIN) {
    return "密码至少 " + PASSWORD_MIN + " 位"
  }
  if (password.length > 72) return "密码最多 72 位"
  return null
}

export function validateTitle(raw: string): string | null {
  const value = raw.trim()
  if (!value) return "请填写物品名称"
  if (value.length > TITLE_MAX) return "物品名称最多 " + TITLE_MAX + " 个字"
  return null
}

export function validateDescription(raw: string): string | null {
  if (raw.length > DESCRIPTION_MAX) {
    return "描述最多 " + DESCRIPTION_MAX + " 个字"
  }
  return null
}

export function validateLocation(raw: string): string | null {
  const value = raw.trim()
  if (!value) return "请填写地点"
  if (value.length > LOCATION_MAX) return "地点最多 " + LOCATION_MAX + " 个字"
  return null
}

export function validateContact(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (value.length > CONTACT_MAX) {
    return "联系方式最多 " + CONTACT_MAX + " 个字"
  }
  return null
}

export function validateHappenedAt(raw: string): string | null {
  if (!raw) return "请选择时间"
  const time = Date.parse(raw)
  if (Number.isNaN(time)) return "时间格式不正确"
  // 允许 10 分钟的时钟偏差，但不允许明显来自未来
  if (time > Date.now() + 10 * 60 * 1000) return "时间不能晚于现在"
  if (time < Date.parse("2000-01-01T00:00:00Z")) return "时间过早，请检查"
  return null
}

export type ItemKind = "lost" | "found"

export type ItemDraft = {
  kind: ItemKind
  title: string
  description: string
  location: string
  happenedAt: string
  contact: string
  imagePath: string
}

export type ItemDraftResult =
  { ok: true; value: ItemDraft } | { ok: false; errors: FieldErrors }

/** 发布表单校验。客户端即时反馈与 Server Action 权威校验共用这一份。 */
export function validateItemDraft(formData: FormData): ItemDraftResult {
  const kindRaw = String(formData.get("kind") ?? "")
  const title = String(formData.get("title") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim()
  const location = String(formData.get("location") ?? "").trim()
  const happenedAt = String(formData.get("happened_at") ?? "")
  const contact = String(formData.get("contact") ?? "").trim()
  const imagePath = String(formData.get("image_path") ?? "").trim()

  const errors: FieldErrors = {}

  if (kindRaw !== "lost" && kindRaw !== "found") {
    errors.kind = "帖子类型不正确"
  }

  const titleError = validateTitle(title)
  if (titleError) errors.title = titleError

  const descriptionError = validateDescription(description)
  if (descriptionError) errors.description = descriptionError

  const locationError = validateLocation(location)
  if (locationError) errors.location = locationError

  const happenedAtError = validateHappenedAt(happenedAt)
  if (happenedAtError) errors.happened_at = happenedAtError

  const contactError = validateContact(contact)
  if (contactError) errors.contact = contactError

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      kind: kindRaw as ItemKind,
      title,
      description,
      location,
      happenedAt: new Date(happenedAt).toISOString(),
      contact,
      imagePath,
    },
  }
}
