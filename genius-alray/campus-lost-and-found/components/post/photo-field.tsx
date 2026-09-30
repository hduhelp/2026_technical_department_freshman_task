"use client"

import Image from "next/image"
import { useRef, useState } from "react"
import { ImagePlusIcon, SparklesIcon, TrashIcon } from "lucide-react"

import { describePhotoAction } from "@/lib/actions/vision"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { ACCEPTED_IMAGE_TYPES } from "@/lib/constants"
import { prepareImage } from "@/lib/image-compress"

export type UploadedPhoto = { path: string; url: string }

/**
 * 照片区（位于描述之前）。
 * 流程：选图 → 浏览器压缩 → POST /api/upload 落 Storage → 出现「用 AI 生成描述」按钮。
 * 因为照片先传好了，后面生成描述和发布都只传对象路径，不会再有大 body。
 */
export function PhotoField({
  photo,
  onPhotoChange,
  onGenerated,
}: {
  photo: UploadedPhoto | null
  onPhotoChange: (photo: UploadedPhoto | null) => void
  onGenerated: (description: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<"uploading" | "generating" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    const prepared = await prepareImage(file)
    if (!prepared.ok) {
      setError(prepared.message)
      if (inputRef.current) inputRef.current.value = ""
      return
    }

    setBusy("uploading")
    try {
      const body = new FormData()
      body.append("file", prepared.file)
      const response = await fetch("/api/upload", { method: "POST", body })
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean
        path?: string
        url?: string
        message?: string
      } | null

      if (!response.ok || !payload?.ok || !payload.path || !payload.url) {
        setError(payload?.message ?? "上传失败，请稍后重试")
        return
      }

      onPhotoChange({ path: payload.path, url: payload.url })
    } catch {
      setError("上传失败，请检查网络后重试")
    } finally {
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function handleGenerate() {
    if (!photo) return
    setError(null)
    setBusy("generating")
    try {
      const body = new FormData()
      body.append("image_path", photo.path)
      const result = await describePhotoAction(body)
      if (result.ok) onGenerated(result.description)
      else setError(result.message)
    } catch {
      setError("生成描述失败，请稍后重试")
    } finally {
      setBusy(null)
    }
  }

  function handleRemove() {
    onPhotoChange(null)
    setError(null)
  }

  const disabled = busy !== null

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor="photo-input">照片（可选）</FieldLabel>

      <input
        ref={inputRef}
        id="photo-input"
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="sr-only"
        onChange={handleFile}
        disabled={disabled}
      />

      {photo ? (
        <div className="flex flex-col gap-3">
          <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl bg-muted">
            <Image
              src={photo.url}
              alt="已上传的照片"
              fill
              sizes="(max-width: 480px) 100vw, 480px"
              className="object-cover"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 flex-1"
              onClick={handleGenerate}
              disabled={disabled}
            >
              {busy === "generating" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SparklesIcon data-icon="inline-start" aria-hidden="true" />
              )}
              用 AI 生成描述
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="size-11"
              onClick={handleRemove}
              disabled={disabled}
              aria-label="移除照片"
            >
              <TrashIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 w-full border-dashed"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          {busy === "uploading" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ImagePlusIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {busy === "uploading" ? "正在上传…" : "选择照片"}
        </Button>
      )}

      <FieldDescription>
        支持 JPEG / PNG / WebP / GIF，会自动压缩到 1600px。上传后可以让 AI
        帮你写描述。
      </FieldDescription>

      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}
