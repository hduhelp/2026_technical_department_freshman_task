/**
 * 私有桶名。
 *
 * 放在这里而不是 storage/signed.ts：那个模块带 `server-only` 守卫，而本模块是
 * 纯函数（校验 + 魔数嗅探），要被单测直接 import —— 为了一个常量把整条服务端
 * 依赖链拖进测试不值得。
 */
export const IMAGE_BUCKET = "item-images"

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export class ImageValidationError extends Error {}

/**
 * 从文件头判断真实图片类型。
 *
 * 【为什么不能只信 file.type / content-type】那是客户端说了算的字符串：把任意字节
 * 声明成 image/jpeg 就能进桶，桶的 allowed_mime_types 校验的也是这个声明值。
 * 这里按魔数比对，保证「桶里存的东西」和「声明的类型」一致。
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg"
  }
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    return "image/png"
  }
  // WebP：RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return null
}

/** 魔数与声明必须一致；对不上就当作不支持的类型拒掉 */
export function assertImageMatchesDeclaredType(
  bytes: Uint8Array,
  declaredType: string
): void {
  const detected = sniffImageMime(bytes)
  if (detected === null) {
    throw new ImageValidationError("文件不是有效的 jpeg / png / webp 图片")
  }
  if (detected !== declaredType) {
    throw new ImageValidationError("图片内容与声明的格式不一致")
  }
}

export function assertValidImage(file: { type: string; size: number }): void {
  if (
    !ALLOWED_MIME_TYPES.includes(
      file.type as (typeof ALLOWED_MIME_TYPES)[number]
    )
  ) {
    throw new ImageValidationError("只支持 jpeg / png / webp 图片")
  }
  if (file.size <= 0) {
    throw new ImageValidationError("图片内容为空")
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageValidationError("图片不能超过 2MB")
  }
}

export function extensionForMime(mime: string): string {
  return EXTENSION_BY_MIME[mime] ?? "jpg"
}

/**
 * 存储路径固定为 {userId}/{uploadId}.{ext}，不可枚举。
 *
 * uploadId 就是 image_uploads.id：客户端只拿得到这个 id，**路径永远由服务端生成与使用**。
 * 归属校验因此是「这行登记是不是你的」，不再依赖字符串前缀（'..' / '//' 那一类
 * 花招随之消失）。
 */
export function buildStoragePath(
  userId: string,
  uploadId: string,
  mime: string
): string {
  return userId + "/" + uploadId + "." + extensionForMime(mime)
}
