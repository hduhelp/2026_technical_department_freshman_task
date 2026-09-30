export type AuthFormState = {
  fieldErrors: Record<string, string>
  formError?: string
}

export type ItemFormState = {
  fieldErrors: Record<string, string>
  formError?: string
}

/** 相似检测返回给客户端的精简结构：图片已经在服务端换成了公开 URL。 */
export type SimilarItemView = {
  id: string
  title: string
  location: string
  happenedAt: string
  imageUrl: string | null
  score: number
}

export const EMPTY_AUTH_STATE: AuthFormState = { fieldErrors: {} }
export const EMPTY_ITEM_STATE: ItemFormState = { fieldErrors: {} }
