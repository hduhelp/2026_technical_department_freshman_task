import {
  ACCEPTED_IMAGE_TYPES,
  COMPRESSED_QUALITY,
  MAX_COMPRESSED_EDGE,
  MAX_UPLOAD_BYTES,
} from "@/lib/constants"

export type PrepareImageResult =
  | { ok: true; file: File; previewUrl: string; compressed: boolean }
  | { ok: false; message: string }

export function isAcceptedImageType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)
}

/**
 * 浏览器端压缩：长边压到 1600px、JPEG 0.82。
 * 压缩失败时若原图不超过 4MB 就回退用原图，否则要求换图。
 */
export async function prepareImage(file: File): Promise<PrepareImageResult> {
  if (!isAcceptedImageType(file.type)) {
    return { ok: false, message: "只支持 JPEG / PNG / WebP / GIF 格式的图片" }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message:
        "图片太大（超过 " +
        Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) +
        "MB），请换一张",
    }
  }

  try {
    const compressed = await compressImage(file)
    return {
      ok: true,
      file: compressed,
      previewUrl: URL.createObjectURL(compressed),
      compressed: true,
    }
  } catch {
    if (file.size <= 4 * 1024 * 1024) {
      return {
        ok: true,
        file,
        previewUrl: URL.createObjectURL(file),
        compressed: false,
      }
    }
    return { ok: false, message: "图片处理失败，请换一张更小的图片" }
  }
}

async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(
    1,
    MAX_COMPRESSED_EDGE / Math.max(bitmap.width, bitmap.height)
  )
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext("2d")
  if (!context) throw new Error("no 2d context")
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", COMPRESSED_QUALITY)
  )
  if (!blob) throw new Error("toBlob failed")

  const name = file.name.replace(/\.[^.]+$/, "") || "photo"
  return new File([blob], name + ".jpg", { type: "image/jpeg" })
}
