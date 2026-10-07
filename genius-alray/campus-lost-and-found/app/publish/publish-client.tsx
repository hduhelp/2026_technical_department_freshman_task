"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CameraIcon, Loader2Icon, Trash2Icon } from "lucide-react"

import {
  DURATION,
  FadeIn,
  LoadingOverlay,
  StaggerItem,
  StaggerList,
  StepTransition,
  SuccessOverlay,
  TapScale,
} from "@/components/motion/primitives"
import { PhoneText } from "@/components/contact/phone-link"
import { PageTitle } from "@/components/nav/title-bar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

import {
  analyzeItemAction,
  publishItemAction,
  removeDraftPhotoAction,
  reviewPhotosAction,
  saveDraftAction,
} from "./actions"
import type { CustodyKind } from "@/lib/types"

// 与 lib/storage/validate.ts 保持一致（该模块 import 了 server-only，客户端不能引用）
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.8
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
/**
 * 识别看门狗：真实 provider（generateObject）没有显式超时，
 * 挂起时全屏 LoadingOverlay 会盖住「返回」，用户将永久卡在第 2 屏。
 * 超时后退化成「识别失败，自己填一下」+「识别物品」重试。
 */
const ANALYZE_TIMEOUT_MS = 25_000

type Phase = "idle" | "uploading" | "publishing"

/** 存进草稿的那一份快照 */
type DraftSnapshot = {
  title: string
  description: string
  custody: CustodyKind | null
  contact: string
  locationLabel: string
  lat: number | null
  lng: number | null
}
type AnalyzeState = "idle" | "running" | "done" | "error"

type Photo = {
  uploadId: string
  preview: string
  /** true = 本次会话新建的 blob 预览（需要 revoke）；false = 草稿带回来的签名 URL */
  local: boolean
}

/** 服务端读出来的草稿快照 */
type DraftProps = {
  title: string
  description: string
  custody: CustodyKind | ""
  locationLabel: string
  lat: number | null
  lng: number | null
  photos: Array<{ uploadId: string; url: string }>
}

type Props = {
  maxPhotos: number
  /** 账号里的手机号：选「代为保管」时直接用，不再让用户填 */
  defaultContact: string
  /** 唯一的草稿：每次打开发布页都从它恢复，因此看到的始终是同一份 */
  draft: DraftProps
}

/** 浏览器端压缩：最长边 ≤1600px、jpeg、质量 0.8，并压到 ≤2MB */
async function loadSource(
  file: File
): Promise<{ source: ImageBitmap | HTMLImageElement; revoke: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, revoke: () => bitmap.close() }
    } catch {
      // 某些浏览器/格式无法直接解码，退回 <img> 路径
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { source: image, revoke: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error("这张照片无法读取，请换一张（支持 jpeg / png / webp）")
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("照片压缩失败"))
      },
      "image/jpeg",
      quality
    )
  })
}

async function compressImage(file: File): Promise<File> {
  const { source, revoke } = await loadSource(file)
  const longest = Math.max(source.width, source.height)
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) {
    revoke()
    throw new Error("当前浏览器不支持照片压缩")
  }
  context.drawImage(source, 0, 0, width, height)
  revoke()

  let quality = JPEG_QUALITY
  let blob = await canvasToBlob(canvas, quality)
  while (blob.size > MAX_IMAGE_BYTES && quality > 0.4) {
    quality = Math.round((quality - 0.15) * 100) / 100
    blob = await canvasToBlob(canvas, quality)
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error("照片压缩后仍超过 2MB，请换一张或降低分辨率")
  }

  const baseName = file.name.replace(/\.[^./\\]+$/, "") || "photo"
  return new File([blob], baseName + ".jpg", { type: "image/jpeg" })
}

/** 上传只回一个不透明 upload id：存储路径完全由服务端决定，客户端拿不到也不需要 */
async function uploadImage(file: File) {
  const form = new FormData()
  form.append("file", file)

  const response = await fetch("/api/upload", { method: "POST", body: form })
  const data = (await response.json().catch(() => null)) as {
    uploadId?: string
    error?: string
  } | null
  if (!response.ok || !data?.uploadId) {
    throw new Error(data?.error ?? "照片上传失败，请重试")
  }
  return data.uploadId
}

function errorTitle(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function PublishClient({ maxPhotos, defaultContact, draft }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<1 | -1>(1)

  /** 草稿里已经有文案 → 不自动跑 AI，也不让它覆盖用户写过的东西 */
  const restoredDraftText = Boolean(
    draft.title.trim() || draft.description.trim()
  )
  const restoredPhotoKey = draft.photos.map((photo) => photo.uploadId).join("|")

  const [photos, setPhotos] = useState<Photo[]>(() =>
    draft.photos.map((photo) => ({
      uploadId: photo.uploadId,
      preview: photo.url,
      local: false,
    }))
  )
  const [removing, setRemoving] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase>("idle")
  const [uploadNote, setUploadNote] = useState("")

  const [title, setTitle] = useState(draft.title)
  const [description, setDescription] = useState(draft.description)
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>("idle")
  const [analyzedKey, setAnalyzedKey] = useState(
    restoredDraftText ? restoredPhotoKey : ""
  )
  /** 点「下一步」时正在让 AI 看一遍照片 */
  const [checking, setChecking] = useState(false)
  /** 非空 = 「建议补拍」对话框打开，内容是 AI 的一句话理由 */
  const [retakeReason, setRetakeReason] = useState<string | null>(null)

  const [custody, setCustody] = useState<CustodyKind | "">(draft.custody)
  const [contact] = useState(defaultContact)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    draft.lat !== null && draft.lng !== null
      ? { lat: draft.lat, lng: draft.lng }
      : null
  )
  const [locationLabel, setLocationLabel] = useState(draft.locationLabel)
  const [locating, setLocating] = useState(false)
  const [published, setPublished] = useState(false)

  const uploadIds = photos.map((photo) => photo.uploadId)
  /** 照片集合的指纹：变化即需要重新识别 */
  const analysisKey = uploadIds.join("|")

  const uploadIdsRef = useRef<string[]>([])
  const keyRef = useRef("")
  const requestedRef = useRef("")
  /** 上一次真正发起识别的照片指纹：同一个 key 的重试不清空用户写过的内容 */
  const lastAnalyzeKeyRef = useRef(restoredDraftText ? restoredPhotoKey : "")
  /** 识别请求序号：看门狗超时后，迟到的返回不能再落地 */
  const analyzeSeqRef = useRef(0)
  /** 防止连点「下一步」重复发起检查 */
  const checkBusyRef = useRef(false)
  /** 用户是否改过字段：识别结果只补空、不覆盖（草稿里已有的文案也算「用户写的」） */
  const editedRef = useRef({
    title: Boolean(draft.title.trim()),
    description: Boolean(draft.description.trim()),
  })

  useEffect(() => {
    uploadIdsRef.current = photos.map((photo) => photo.uploadId)
  }, [photos])

  useEffect(() => {
    keyRef.current = analysisKey
  }, [analysisKey])

  // 只释放本次会话创建的 blob 预览；草稿带回来的签名 URL 不能 revoke
  const previewsRef = useRef<string[]>([])
  useEffect(() => {
    previewsRef.current = photos
      .filter((photo) => photo.local)
      .map((photo) => photo.preview)
  }, [photos])
  useEffect(() => {
    return () => {
      for (const url of previewsRef.current) URL.revokeObjectURL(url)
    }
  }, [])

  /**
   * 把当前快照整份写进草稿。**整体覆盖**而不是增量 patch：
   * 「哪个字段没传」这种歧义在设计上就不存在。
   * 失败只弹提示、不打断流程 —— 草稿存不下不该让人发布不了。
   */
  const persistDraft = useCallback(
    async (patch: Partial<DraftSnapshot> = {}): Promise<boolean> => {
      const result = await saveDraftAction({
        title,
        description,
        custody: custody === "" ? null : custody,
        contact,
        locationLabel,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        ...patch,
      })
      if (!result.ok) {
        toast.add({ type: "error", title: result.error })
        return false
      }
      return true
    },
    [title, description, custody, contact, locationLabel, coords]
  )

  /** 第 2 屏的「下一步」：先把文案落进草稿，再进下一步 */
  async function handleInfoNext() {
    await persistDraft()
    goTo(2)
  }

  const runAnalyze = useCallback(
    async (key: string) => {
      const seq = (analyzeSeqRef.current += 1)

      // 换了照片才清掉上一组的 AI 文案；同一组照片的「识别物品」重试保留用户已写内容
      const isRetry = key === lastAnalyzeKeyRef.current
      lastAnalyzeKeyRef.current = key
      // 恢复的草稿不动它的文案：即使换了照片也不清空，AI 只补空字段
      if (!isRetry && !restoredDraftText) {
        editedRef.current = { title: false, description: false }
        setTitle("")
        setDescription("")
      }

      setAnalyzeState("running")

      // 看门狗：provider 挂起时给用户一个出口（mock 固定会返回，E2E 走不到）
      const watchdog = window.setTimeout(() => {
        if (seq !== analyzeSeqRef.current) return
        analyzeSeqRef.current += 1 // 让迟到的返回作废
        setAnalyzeState("error")
      }, ANALYZE_TIMEOUT_MS)

      try {
        const result = await analyzeItemAction(uploadIdsRef.current)
        if (seq !== analyzeSeqRef.current || key !== keyRef.current) return
        if (!result.ok) {
          // 配额用完：提示一次（warning toast），表单照常渲染让用户手填
          if (result.quotaExceeded) {
            toast.add({ type: "warning", title: result.error })
          }
          setAnalyzeState("error")
          return
        }
        const { title: nextTitle, description: nextDescription } = result.result
        if (nextTitle) {
          setTitle((prev) => (editedRef.current.title ? prev : nextTitle))
        }
        if (nextDescription) {
          setDescription((prev) =>
            editedRef.current.description ? prev : nextDescription
          )
        }
        setAnalyzedKey(key)
        setAnalyzeState("done")
      } catch {
        if (seq === analyzeSeqRef.current && key === keyRef.current) {
          setAnalyzeState("error")
        }
      } finally {
        window.clearTimeout(watchdog)
      }
      // restoredDraftText 由 props 决定、整个生命周期不变，放进来只是为了让 lint 满意
    },
    [restoredDraftText]
  )

  // 进入第 2 屏自动识别；照片集合变化后重新识别
  useEffect(() => {
    if (step !== 1 || !analysisKey) return
    if (analyzedKey === analysisKey || requestedRef.current === analysisKey) {
      return
    }
    requestedRef.current = analysisKey
    void runAnalyze(analysisKey)
  }, [step, analysisKey, analyzedKey, runAnalyze])

  // 发布成功后盖屏约 900ms，再回首页
  useEffect(() => {
    if (!published) return
    const timer = window.setTimeout(() => router.push("/"), 900)
    return () => window.clearTimeout(timer)
  }, [published, router])

  const busy = isPending || phase !== "idle"
  const remaining = Math.max(0, maxPhotos - photos.length)
  const canLeavePhotoStep = photos.length > 0 && !busy && !checking
  const canLeaveInfoStep =
    title.trim().length > 0 && description.trim().length > 0 && !busy

  /** 标题栏的「返回」：第 2/3 屏退回上一步（稳定引用，避免每次渲染都重注册） */
  const handleHeaderBack = useCallback(() => {
    goTo(step - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  function goTo(next: number) {
    setDirection(next > step ? 1 : -1)
    // 第 2 屏：先同步进入加载态，避免 effect 生效前渲染出一帧空表单；
    // 只有确实会发起识别时才置 running（重试态/已识别过的不置，否则会卡住）
    if (
      next === 1 &&
      analyzedKey !== analysisKey &&
      requestedRef.current !== analysisKey
    ) {
      setAnalyzeState("running")
    }
    setStep(next)
  }

  /**
   * 拍照屏的「下一步」：只在这里让 AI 看一次照片。
   * - 通过 / 服务端失败 / 异常 → 直接进第 2 屏（建议永远不阻塞，也不弹错误）；
   * - 建议补拍 → 只弹一个对话框，用户可以「仍然继续」。
   */
  async function handlePhotoNext() {
    if (checkBusyRef.current || photos.length === 0) return
    checkBusyRef.current = true
    setChecking(true)
    try {
      const result = await reviewPhotosAction(uploadIdsRef.current)
      if (!result.ok && result.quotaExceeded) {
        // AI 配额用完：跳过拍照建议直接进下一屏，只提示一次
        toast.add({ type: "warning", title: result.error })
        goTo(1)
        return
      }
      if (result.ok && !result.advice.ok) {
        setRetakeReason(result.advice.reason.trim() || "换个角度再拍一张")
        return
      }
      goTo(1)
    } catch {
      // 服务端失败静默降级：直接进入第 2 屏
      goTo(1)
    } finally {
      checkBusyRef.current = false
      setChecking(false)
    }
  }

  function openPicker() {
    inputRef.current?.click()
  }

  /**
   * 跑一段「会改服务端状态」的异步任务，期间把界面锁住。
   *
   * 【为什么 phase 必须在 transition 外面置】run 的整段是一个 async transition，
   * 而 transition 里的 setState 会被 React 压到这次 transition 结束才提交 ——
   * 原来的 setPhase("publishing") 因此要等 publishItemAction 返回才生效：
   * 弱网下用户看到的就是「点了发布，按钮十几秒一动不动」，明明 isPending 为真，
   * 却没有任何可见反馈，像卡死。先同步置 phase 再进 transition，反馈就是即时的。
   */
  function run(phase: Exclude<Phase, "idle">, task: () => Promise<void>) {
    setPhase(phase)
    startTransition(async () => {
      try {
        await task()
      } catch (error) {
        toast.add({
          type: "error",
          title: errorTitle(error, "操作失败，请重试"),
        })
      } finally {
        setPhase("idle")
        setUploadNote("")
      }
    })
  }

  function handleFiles(files: File[]) {
    if (files.length === 0) return
    // 前置检查同步做完：这类「只弹个提示」的分支不该先闪一下 loading
    if (remaining === 0) {
      toast.add({
        type: "error",
        title: "每个物品最多 " + maxPhotos + " 张照片",
      })
      return
    }

    const batch = files.slice(0, remaining)
    if (batch.length < files.length) {
      toast.add({
        type: "info",
        title: "最多再上传 " + remaining + " 张，已忽略多余照片",
      })
    }

    run("uploading", async () => {
      for (let index = 0; index < batch.length; index += 1) {
        setUploadNote("正在上传第 " + (index + 1) + "/" + batch.length + " 张…")
        const compressed = await compressImage(batch[index])
        const uploadId = await uploadImage(compressed)
        const photo = {
          uploadId,
          preview: URL.createObjectURL(compressed),
          local: true,
        }
        // 逐张入 state：整批中途失败时，已成功的照片不能丢（否则预览 URL 与存储对象都成孤儿）
        uploadIdsRef.current = [...uploadIdsRef.current, photo.uploadId]
        setPhotos((prev) => [...prev, photo])
      }

      // 【第 8 轮】不报张数：「最多 3 张、不提示数量」是明确的 UI 要求
      toast.add({ type: "success", title: "照片已上传" })
    })
  }

  function removePhoto(uploadId: string) {
    // 先让服务端把草稿登记行和存储对象都删掉，再淡出。
    // 删除失败就留着这张 —— 界面不能比服务端更「超前」，否则会留下孤儿对象。
    const target = photos.find((photo) => photo.uploadId === uploadId)
    startTransition(async () => {
      const result = await removeDraftPhotoAction(uploadId)
      if (!result.ok) {
        toast.add({ type: "error", title: result.error })
        return
      }
      setRemoving((prev) =>
        prev.includes(uploadId) ? prev : [...prev, uploadId]
      )
      window.setTimeout(() => {
        if (target?.local) URL.revokeObjectURL(target.preview)
        setPhotos((prev) => prev.filter((photo) => photo.uploadId !== uploadId))
        setRemoving((prev) => prev.filter((item) => item !== uploadId))
        uploadIdsRef.current = uploadIdsRef.current.filter(
          (item) => item !== uploadId
        )
      }, DURATION.fast * 1000)
    })
  }

  function retryAnalyze() {
    if (!analysisKey || analyzeState === "running") return
    requestedRef.current = analysisKey
    void runAnalyze(analysisKey)
  }

  function locate() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      toast.add({
        type: "error",
        title: "当前浏览器不支持定位，请填写位置描述",
      })
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        }
        setCoords(next)
        setLocating(false)
        void persistDraft(next)
        toast.add({ type: "success", title: "已获取当前位置" })
      },
      () => {
        setCoords(null)
        setLocating(false)
        toast.add({
          type: "error",
          title: "定位失败或被拒绝，请填写位置描述",
        })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  /** 点选一张卡片后，进入下一屏做详细设置（联系方式自动用账号手机号 / 设置存放位置） */
  function pickCustody(next: CustodyKind) {
    setDirection(1)
    setCustody(next)
    setStep(3)
    void persistDraft({ custody: next })
    if (next === "in_place" && !coords) locate()
  }

  function handlePublish() {
    // 校验全是本地判断，同步做完再进提交 —— 校验不过就不会出现「闪一下正在发布」
    if (uploadIds.length === 0) {
      toast.add({ type: "error", title: "请至少上传一张照片" })
      return
    }
    if (!title.trim()) {
      toast.add({ type: "error", title: "请填写物品名称" })
      return
    }
    if (!description.trim()) {
      toast.add({ type: "error", title: "请填写物品描述" })
      return
    }
    if (!custody) {
      toast.add({ type: "error", title: "请选择保管方式" })
      return
    }
    if (custody === "kept" && contact.trim().length < 5) {
      toast.add({
        type: "error",
        title: "账号缺少手机号，请先在「我的」里补充",
      })
      return
    }
    // 位置详情必填：定位只是补充，失主最终要靠这句话找到东西
    if (custody === "in_place" && locationLabel.trim().length < 1) {
      toast.add({ type: "error", title: "请填写位置详情" })
      return
    }

    run("publishing", async () => {
      const result = await publishItemAction({
        uploadIds,
        title: title.trim(),
        description: description.trim(),
        custody,
        contact: contact.trim(),
        locationLabel: locationLabel.trim(),
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      })
      if (!result.ok) {
        toast.add({ type: "error", title: result.error })
        return
      }

      // 【第 7 轮】不再弹 toast：整屏对勾（SuccessOverlay）已经是很强的正向反馈
      setPublished(true)
    })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/*
        标题栏由 layout 统一提供（components/nav/title-bar.tsx），页面里不再自己画。
        这里只覆盖「返回」：第 2/3 屏退回上一步，第 1 屏沿用路由默认（回首页）。
        onBack 用 useCallback 稳定引用，避免每次渲染都重新注册标题栏配置。
      */}
      <PageTitle
        title="发布招领"
        onBack={step === 0 ? undefined : handleHeaderBack}
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(event) => {
          // FileList 是「活」的：必须先拷成数组再清空 input
          const files = Array.from(event.target.files ?? [])
          event.target.value = ""
          handleFiles(files)
        }}
      />

      <StepTransition
        stepKey={step}
        direction={direction}
        className="flex min-w-0 flex-1 flex-col"
      >
        {step === 0 ? (
          // 这一屏只做拍照，内容不多：整块（大按钮 / 网格 + 下一步）垂直居中
          <div className="my-auto flex min-w-0 flex-col gap-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              把物品放在光线好的地方，拍清楚整体和明显的特征。
            </p>

            {/* 照片列表：最后一个是「添加照片」，没有照片时它就是上传按钮 */}
            <StaggerList className="grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <StaggerItem
                  key={photo.uploadId}
                  className={cn(
                    "relative overflow-hidden rounded-xl bg-muted transition-opacity duration-[180ms]",
                    removing.includes(photo.uploadId)
                      ? "opacity-0"
                      : "opacity-100"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.preview}
                    alt="已上传照片"
                    className="h-24 w-full object-cover"
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="destructive"
                    aria-label="删除这张照片"
                    className="absolute top-1 right-1"
                    disabled={busy}
                    onClick={() => removePhoto(photo.uploadId)}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </StaggerItem>
              ))}

              {photos.length < maxPhotos ? (
                <StaggerItem key="add-photo">
                  <button
                    type="button"
                    data-testid="photo-add"
                    disabled={busy}
                    onClick={openPicker}
                    className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-xl bg-muted text-xs text-muted-foreground transition-colors hover:bg-muted/70 active:scale-[0.98] disabled:opacity-50"
                  >
                    <CameraIcon className="size-5" aria-hidden />
                    添加照片
                  </button>
                </StaggerItem>
              ) : null}
            </StaggerList>

            {phase === "uploading" ? (
              <p className="text-sm text-muted-foreground" role="status">
                {uploadNote || "正在上传照片…"}
              </p>
            ) : null}

            <TapScale>
              <Button
                type="button"
                size="lg"
                className="h-12 w-full text-base"
                disabled={!canLeavePhotoStep}
                onClick={handlePhotoNext}
              >
                下一步
              </Button>
            </TapScale>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-base font-semibold">确认信息</h2>
              <p className="text-xs text-muted-foreground">
                AI 写的，可以直接改
              </p>
            </div>

            {analyzeState === "error" ? (
              <FadeIn className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-3 py-2">
                <p className="text-sm">识别失败，自己填一下</p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={retryAnalyze}
                >
                  识别物品
                </Button>
              </FadeIn>
            ) : null}

            {/*
              加载期间不渲染表单：骨架屏与输入框同时出现会出现两套输入框（第 2 轮 bug）。
              等待态交给全屏 LoadingOverlay，识别结束（成功或失败）再渲染填好的表单。
            */}
            {analyzeState === "running" ? null : (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="title">物品名称</Label>
                  <Input
                    id="title"
                    value={title}
                    maxLength={60}
                    placeholder="例如：黑色皮质钱包"
                    onChange={(event) => {
                      editedRef.current.title = true
                      setTitle(event.target.value)
                    }}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="description">物品描述</Label>
                  <Textarea
                    id="description"
                    value={description}
                    maxLength={600}
                    placeholder="例如：黑色长方形钱包，表面有一处贴纸，里面有几张卡"
                    onChange={(event) => {
                      editedRef.current.description = true
                      setDescription(event.target.value)
                    }}
                  />
                </div>
              </>
            )}

            <div className="mt-auto pt-2">
              <TapScale>
                <Button
                  type="button"
                  size="lg"
                  className="h-12 w-full text-base"
                  disabled={!canLeaveInfoStep}
                  onClick={handleInfoNext}
                >
                  下一步
                </Button>
              </TapScale>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="my-auto flex min-w-0 flex-col gap-3">
            <h2 className="font-heading text-base font-semibold">怎么还</h2>

            <button
              type="button"
              data-testid="custody-kept"
              disabled={busy}
              onClick={() => pickCustody("kept")}
              className="flex flex-col gap-1 rounded-2xl bg-muted/60 px-4 py-3 text-left transition-colors hover:bg-muted active:scale-[0.99] disabled:opacity-60"
            >
              <span className="text-sm font-medium">代为保管</span>
              <span className="text-xs text-muted-foreground">
                我先收着，失主联系我，当面取回
              </span>
            </button>

            <button
              type="button"
              data-testid="custody-in-place"
              disabled={busy}
              onClick={() => pickCustody("in_place")}
              className="flex flex-col gap-1 rounded-2xl bg-muted/60 px-4 py-3 text-left transition-colors hover:bg-muted active:scale-[0.99] disabled:opacity-60"
            >
              <span className="text-sm font-medium">指定存放位置</span>
              <span className="text-xs text-muted-foreground">
                东西放在某处，失主自己去取
              </span>
            </button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="my-auto flex min-w-0 flex-col gap-5">
            {custody === "kept" ? (
              <div className="flex flex-col gap-2">
                <h2 className="font-heading text-base font-semibold">
                  联系方式
                </h2>
                <p className="text-xs text-muted-foreground">
                  用你账号里的手机号，失主会直接打给你
                </p>
                <PhoneText phone={contact} className="text-base" />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <h2 className="font-heading text-base font-semibold">
                  存放位置
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={locating || busy}
                  onClick={locate}
                >
                  {locating ? "正在定位…" : "使用当前位置"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {coords
                    ? "已获取定位，可以少写一点"
                    : "没拿到定位，写清位置详情也能发布"}
                </p>
                {/* 位置详情必填：不显示经纬度，只让用户写一句人话 */}
                <Label htmlFor="locationLabel">位置详情</Label>
                <Input
                  id="locationLabel"
                  value={locationLabel}
                  maxLength={200}
                  required
                  placeholder="例如：图书馆 3 楼自习区靠窗第三排"
                  onChange={(event) => setLocationLabel(event.target.value)}
                />
              </div>
            )}

            <TapScale>
              <Button
                type="button"
                size="lg"
                className="h-12 w-full text-base"
                disabled={busy}
                onClick={handlePublish}
              >
                {phase === "publishing" ? (
                  <>
                    <Loader2Icon className="animate-spin" aria-hidden />
                    正在发布…
                  </>
                ) : (
                  "发布"
                )}
              </Button>
            </TapScale>
          </div>
        ) : null}
      </StepTransition>

      <LoadingOverlay
        show={checking}
        message="AI 正在看照片…"
        testId="photo-check-loading"
      />

      <LoadingOverlay
        show={analyzeState === "running"}
        message="AI 正在写描述…"
        testId="analyze-loading"
      />

      {/* 建议补拍：只是建议，用户可以「仍然继续」 */}
      <Dialog
        open={retakeReason !== null}
        onOpenChange={(open) => {
          if (!open) setRetakeReason(null)
        }}
      >
        <DialogContent
          data-testid="photo-advice-dialog"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>建议补拍</DialogTitle>
            <DialogDescription>{retakeReason ?? ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              data-testid="photo-advice-retake"
              onClick={() => setRetakeReason(null)}
            >
              继续拍照
            </Button>
            <Button
              type="button"
              data-testid="photo-advice-skip"
              onClick={() => {
                setRetakeReason(null)
                goTo(1)
              }}
            >
              仍然继续
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SuccessOverlay
        show={published}
        message="发布成功"
        testId="publish-success"
      />
    </div>
  )
}
