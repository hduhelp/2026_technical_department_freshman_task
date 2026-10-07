import { describe, expect, it } from "vitest"
import {
  ImageValidationError,
  assertImageMatchesDeclaredType,
  sniffImageMime,
} from "@/lib/storage/validate"
import { PNG_BYTES } from "../helpers/supabase"

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
])

const WEBP_BYTES = (() => {
  const bytes = new Uint8Array(16)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  bytes.set([0x24, 0x00, 0x00, 0x00], 4) // 长度占位
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  return bytes
})()

/**
 * 上传接口的魔数校验（第 9 轮）。
 * 只信 file.type 等于信任客户端随便写的字符串 —— 任意字节都能被声明成
 * image/jpeg 存进桶（bucket 的 allowed_mime_types 校验的也是这个声明值）。
 */
describe("图片魔数校验", () => {
  it("认得 png / jpeg / webp", () => {
    expect(sniffImageMime(new Uint8Array(PNG_BYTES))).toBe("image/png")
    expect(sniffImageMime(JPEG_BYTES)).toBe("image/jpeg")
    expect(sniffImageMime(WEBP_BYTES)).toBe("image/webp")
  })

  it("非图片（HTML / 文本 / 空 / 白名单外的 GIF）→ null", () => {
    expect(sniffImageMime(new TextEncoder().encode("<script>alert(1)"))).toBe(
      null
    )
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe(
      null
    )
    expect(sniffImageMime(new Uint8Array([]))).toBe(null)
  })

  it("把 HTML 声明成 jpeg 必须被拒（这正是只信 file.type 时能进桶的东西）", () => {
    const html = new TextEncoder().encode("<script>alert(1)</script>")
    expect(() => assertImageMatchesDeclaredType(html, "image/jpeg")).toThrow(
      ImageValidationError
    )
  })

  it("内容与声明不一致必须被拒（png 声明成 jpeg）", () => {
    expect(() =>
      assertImageMatchesDeclaredType(new Uint8Array(PNG_BYTES), "image/jpeg")
    ).toThrow(ImageValidationError)
  })

  it("内容与声明一致时放行", () => {
    expect(() =>
      assertImageMatchesDeclaredType(new Uint8Array(PNG_BYTES), "image/png")
    ).not.toThrow()
    expect(() =>
      assertImageMatchesDeclaredType(JPEG_BYTES, "image/jpeg")
    ).not.toThrow()
    expect(() =>
      assertImageMatchesDeclaredType(WEBP_BYTES, "image/webp")
    ).not.toThrow()
  })

  it("截断的文件头不会被误判成图片", () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8]))).toBe(null)
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e]))).toBe(null)
  })
})
