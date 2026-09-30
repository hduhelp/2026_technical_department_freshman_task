"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef, useState, useTransition } from "react"
import { ChevronDownIcon, SparklesIcon } from "lucide-react"

import { PhotoField, type UploadedPhoto } from "@/components/post/photo-field"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { checkSimilarAction, createItemAction } from "@/lib/actions/items"
import type { SimilarItemView } from "@/lib/actions/state"
import { KIND_LABELS, LOCATION_SUGGESTIONS } from "@/lib/constants"
import {
  formatRelativeTime,
  formatSimilarity,
  toDateTimeLocalValue,
} from "@/lib/format"
import type { ItemKind } from "@/lib/supabase/types"
import {
  validateContact,
  validateDescription,
  validateHappenedAt,
  validateLocation,
  validateTitle,
} from "@/lib/validation"

export function PostForm({ kind }: { kind: ItemKind }) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [contact, setContact] = useState("")
  const [photo, setPhoto] = useState<UploadedPhoto | null>(null)

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [matches, setMatches] = useState<SimilarItemView[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [similarCount, setSimilarCount] = useState(0)
  const [photoVisible, setPhotoVisible] = useState(kind === "found")
  const [pending, startTransition] = useTransition()
  const happenedAtRef = useRef<HTMLInputElement>(null)

  /**
   * 时间字段不受控：默认值必须在挂载后写入 DOM。
   * 这样服务端渲染的空值不会与浏览器本地时间冲突（不会 hydration 不一致），
   * 而且写 DOM 正是 effect 该做的事，不会触发级联渲染。
   */
  useEffect(() => {
    const input = happenedAtRef.current
    if (input && !input.value) input.value = toDateTimeLocalValue()
  }, [])

  function readHappenedAt(): string {
    return happenedAtRef.current?.value ?? ""
  }

  function buildFormData(): FormData {
    const formData = new FormData()
    formData.set("kind", kind)
    formData.set("title", title)
    formData.set("description", description)
    formData.set("location", location)
    const happenedAt = readHappenedAt()
    formData.set(
      "happened_at",
      happenedAt ? new Date(happenedAt).toISOString() : ""
    )
    formData.set("contact", contact)
    formData.set("image_path", photo?.path ?? "")
    return formData
  }

  function localErrors(): Record<string, string> {
    const errors: Record<string, string> = {}
    const titleError = validateTitle(title)
    if (titleError) errors.title = titleError
    const descriptionError = validateDescription(description)
    if (descriptionError) errors.description = descriptionError
    const locationError = validateLocation(location)
    if (locationError) errors.location = locationError
    const happenedAtError = validateHappenedAt(readHappenedAt())
    if (happenedAtError) errors.happened_at = happenedAtError
    const contactError = validateContact(contact)
    if (contactError) errors.contact = contactError
    return errors
  }

  // 输入时防抖提示，提交前再弹一次确认，两处用的是同一个 Server Action
  useEffect(() => {
    const trimmedTitle = title.trim()
    const timer = window.setTimeout(async () => {
      if (trimmedTitle.length < 2) {
        setSimilarCount(0)
        return
      }
      const result = await checkSimilarAction(buildFormData()).catch(() => null)
      setSimilarCount(result?.ok ? result.items.length : 0)
    }, 600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, location])

  function applyGeneratedDescription(text: string) {
    const previous = description
    setDescription(text)
    let toastId = ""
    toastId = toast.add({
      title: "已生成描述",
      description: "可以继续手动修改，或撤销恢复原来的内容。",
      type: "success",
      actionProps: {
        children: "撤销",
        onClick: () => {
          setDescription(previous)
          toast.close(toastId)
        },
      },
    })
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      const state = await createItemAction(formData)
      setFieldErrors(state.fieldErrors ?? {})
      if (state.formError) {
        setFormError(state.formError)
        toast.add({ title: state.formError, type: "error" })
      }
    })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const errors = localErrors()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      setFormError("请先修正表单里标红的内容")
      return
    }

    const formData = buildFormData()
    setChecking(true)
    const result = await checkSimilarAction(formData).catch(() => null)
    setChecking(false)

    if (result?.ok && result.items.length > 0) {
      setMatches(result.items)
      setSheetOpen(true)
      return
    }

    submit(formData)
  }

  const busy = pending || checking

  return (
    <>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-1 flex-col gap-4 px-4 py-4"
      >
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-lg font-semibold">
            发布{KIND_LABELS[kind]}启事
          </h1>
          <p className="text-sm text-muted-foreground">
            {kind === "lost"
              ? "写清楚丢了什么、在哪丢的、什么时候丢的，捡到的人更容易找到你。"
              : "写清楚捡到了什么、在哪捡的、什么时候捡的，最好配一张照片。"}
          </p>
        </div>

        <FieldGroup>
          <Field data-invalid={Boolean(fieldErrors.title)}>
            <FieldLabel htmlFor="title">
              {kind === "lost" ? "丢了什么" : "捡到了什么"}
            </FieldLabel>
            <Input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                kind === "lost" ? "例如：黑色折叠雨伞" : "例如：蓝色保温杯"
              }
              maxLength={60}
              className="h-11"
              aria-invalid={Boolean(fieldErrors.title)}
            />
            <FieldDescription>一句话说清物品，最多 60 个字。</FieldDescription>
            {fieldErrors.title ? (
              <FieldError>{fieldErrors.title}</FieldError>
            ) : null}
          </Field>

          {kind === "lost" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setPhotoVisible((value) => !value)}
                aria-expanded={photoVisible}
              >
                <ChevronDownIcon
                  data-icon="inline-start"
                  aria-hidden="true"
                  className={photoVisible ? "rotate-180" : undefined}
                />
                {photoVisible ? "收起照片" : "添加照片（可选）"}
              </Button>
              {photoVisible ? (
                <PhotoField
                  photo={photo}
                  onPhotoChange={setPhoto}
                  onGenerated={applyGeneratedDescription}
                />
              ) : null}
            </>
          ) : (
            <PhotoField
              photo={photo}
              onPhotoChange={setPhoto}
              onGenerated={applyGeneratedDescription}
            />
          )}

          <Field data-invalid={Boolean(fieldErrors.description)}>
            <FieldLabel htmlFor="description">详细描述</FieldLabel>
            <Textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="颜色、品牌、外观特征、有没有贴纸或挂件……越具体越容易被认出来。"
              rows={5}
              maxLength={1000}
              className="min-h-28"
              aria-invalid={Boolean(fieldErrors.description)}
            />
            <FieldDescription>
              有照片的话可以点上面的「用 AI 生成描述」，再自己改。
            </FieldDescription>
            {fieldErrors.description ? (
              <FieldError>{fieldErrors.description}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.location)}>
            <FieldLabel htmlFor="location">地点</FieldLabel>
            <Input
              id="location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="例如：图书馆三楼自习区"
              maxLength={80}
              className="h-11"
              aria-invalid={Boolean(fieldErrors.location)}
            />
            <div className="flex flex-wrap gap-2">
              {LOCATION_SUGGESTIONS.map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant={location === item ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setLocation(item)}
                >
                  {item}
                </Button>
              ))}
            </div>
            {fieldErrors.location ? (
              <FieldError>{fieldErrors.location}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.happened_at)}>
            <FieldLabel htmlFor="happened_at">
              {kind === "lost" ? "什么时候丢的" : "什么时候捡到的"}
            </FieldLabel>
            <Input
              id="happened_at"
              ref={happenedAtRef}
              type="datetime-local"
              className="h-11"
              aria-invalid={Boolean(fieldErrors.happened_at)}
            />
            {fieldErrors.happened_at ? (
              <FieldError>{fieldErrors.happened_at}</FieldError>
            ) : null}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.contact)}>
            <FieldLabel htmlFor="contact">联系方式（可选）</FieldLabel>
            <Input
              id="contact"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="微信号 / QQ / 邮箱，只有登录用户能看到"
              maxLength={100}
              className="h-11"
              aria-invalid={Boolean(fieldErrors.contact)}
            />
            <FieldDescription>
              留了就只对登录用户可见；不留也不影响发布。
            </FieldDescription>
            {fieldErrors.contact ? (
              <FieldError>{fieldErrors.contact}</FieldError>
            ) : null}
          </Field>

          <Separator />

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          {similarCount > 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <SparklesIcon className="size-4" aria-hidden="true" />
              发现 {similarCount} 条相似帖子，提交前会再确认一次。
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="h-11 w-full"
            disabled={busy}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {checking ? "正在检查相似帖子…" : pending ? "正在发布…" : "提交"}
          </Button>
        </FieldGroup>
      </form>

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>发现 {matches.length} 条相似帖子</DrawerTitle>
            <DrawerDescription>
              先确认一下是不是同一个东西，不是的话可以继续提交。
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-2">
            {matches.map((item) => (
              <Link
                key={item.id}
                href={"/items/" + item.id}
                target="_blank"
                rel="noreferrer"
                className="block rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="flex items-stretch gap-3 rounded-2xl bg-card p-3 ring-1 ring-foreground/10">
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.title}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="line-clamp-2 text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.location} · {formatRelativeTime(item.happenedAt)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      相似度 {formatSimilarity(item.score)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <DrawerFooter>
            <Button
              variant="outline"
              size="lg"
              className="h-11 w-full"
              onClick={() => setSheetOpen(false)}
            >
              返回修改
            </Button>
            <Button
              size="lg"
              className="h-11 w-full"
              disabled={pending}
              onClick={() => {
                setSheetOpen(false)
                submit(buildFormData())
              }}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              仍然提交
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}
