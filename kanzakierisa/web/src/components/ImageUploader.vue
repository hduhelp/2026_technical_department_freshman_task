<script setup>
/**
 * 图片上传器（基于 `van-uploader`）。
 *
 * 设计要点：
 *
 * 1. **内部 `fileList` 才是 van-uploader 的真源**，对外只暴露 `string[]`（图片相对路径）。
 *    van-uploader 的每一项是 `{ file, url, objectUrl, status, message }` 这样的对象，
 *    直接把它往外抛会让表单数据里混进 File 对象；这里在每次变更后「投影」成 URL 数组再 emit。
 *
 * 2. **预检放在 `before-read`**。不合格的文件在前端直接拦下并给明确提示，
 *    不浪费一次网络往返；后端仍会独立校验（SPEC 10 双保险），前端这层只为体验。
 *
 * 3. **单张失败不影响其他张**。多选时逐张并发上传，失败的那张标记 `status: 'failed'`
 *    并显示「上传失败」蒙层，用户可点 × 删掉重传，其余成功项照常入库。
 *
 * 4. **删除只从数组移除，不调后端删文件**。后端 `uploads/` 目录不做回收，
 *    这一点已在 docs/code-guide.md 写明（P5 明确允许）。
 */
import { ref, watch } from 'vue'
import { showToast } from 'vant'

import { upload as uploadImage } from '@/api/upload'
import { ACCEPT_IMAGE_MIME, IMAGE_MIME_REGEXP, MAX_IMAGES, MAX_IMAGE_MB } from '@/constants'

const props = defineProps({
  /** 已上传图片的相对路径数组，如 ['/uploads/a.png'] */
  modelValue: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue'])

const MAX_BYTES = MAX_IMAGE_MB * 1024 * 1024

/** van-uploader 绑定用的列表（对象数组） */
const fileList = ref([])

/**
 * 记录「本组件最后一次 emit 出去的 URL 串」。
 *
 * 用途：`update:modelValue` 发出去后父组件会把值写回 props，触发下面那个 watch。
 * 若不加以区分，就会把用户刚刚放进来、正处于 `uploading` 的占位项一起抹掉
 * （表现为「刚选完图，缩略图闪一下没了」）。用它做一次自环判断即可。
 */
let lastEmitted = null

/** 把 van-uploader 的列表投影成 URL 数组并通知父组件 */
function emitUrls() {
  const urls = fileList.value
    .filter((item) => item.status !== 'failed' && !!item.url)
    .map((item) => item.url)
  lastEmitted = JSON.stringify(urls)
  emit('update:modelValue', urls)
}

/**
 * 用外部的 URL 数组重建列表（编辑页预填、表单重置时走这里）。
 *
 * 只放 `{ url }` 即可：`isImageFile` 会按 `.png/.jpg` 正则把它认成图片，
 * 预览组件读 `item.objectUrl || item.content || item.url`，落到最后一个分支。
 */
function rebuild(urls) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : []
  fileList.value = list.map((url) => ({ url, status: 'done', message: '' }))
}

watch(
  () => props.modelValue,
  (urls) => {
    const incoming = JSON.stringify(Array.isArray(urls) ? urls.filter(Boolean) : [])
    // 自己刚发出去的值回流，跳过，避免打断正在进行的上传
    if (incoming === lastEmitted) return
    rebuild(urls)
  },
  { immediate: true, deep: true },
)

/**
 * 选择文件后的前置校验。
 *
 * 三种处理，按「对用户最不意外」的原则区分：
 *
 * 1. **类型 / 体积不合格** —— 逐张提示并从本次选择中剔除，合格的照常进入上传，
 *    这样「选了 3 张图，其中 1 张是 3MB」不会导致另外两张也被一起退回。
 * 2. **超出剩余额度** —— 只保留前 N 张，多出来的一并丢弃并提示，不会静默吞掉。
 * 3. **全部不合格** —— 返回 false，van-uploader 会 `resetInput()` 直接丢弃本次选择。
 *
 * ⚠️ 返回值的语义容易踩坑：van-uploader 源码里
 *
 *     const response = props.beforeRead(file)
 *     if (!response) { resetInput(); return }
 *     if (isPromise(response)) { response.then(data => data ? readFile(data) : readFile(file)); return }
 *     readFile(file)          // ← 同步返回值只被当布尔用，不会被当成新的文件列表
 *
 * 也就是说**同步返回一个数组是无效的**，想替换待上传的文件必须返回 Promise。
 * 所以「有裁剪」的情况只能走 `Promise.resolve(裁剪后的数组)`。
 */
function beforeRead(file) {
  const files = Array.isArray(file) ? file : [file]

  const remain = MAX_IMAGES - fileList.value.length
  if (remain <= 0) {
    showToast(`最多上传 ${MAX_IMAGES} 张图片`)
    return false
  }

  const accepted = []
  let droppedByRule = 0

  for (const f of files) {
    if (!IMAGE_MIME_REGEXP.test(f.type || '')) {
      showToast('仅支持 png / jpg 格式的图片')
      droppedByRule += 1
      continue
    }
    if (f.size > MAX_BYTES) {
      const mb = (f.size / 1024 / 1024).toFixed(1)
      showToast(`图片 ${mb}MB，超过 ${MAX_IMAGE_MB}MB 上限`)
      droppedByRule += 1
      continue
    }
    // 额度已满：多出来的直接丢弃（下面统一提示），不再往上抬
    if (accepted.length >= remain) continue
    accepted.push(f)
  }

  if (accepted.length === 0) return false
  if (accepted.length === files.length) return true

  // 只有「被额度截断」时才额外提示；被类型/体积拦下的已经各自弹过文案了
  if (droppedByRule === 0) {
    showToast(`最多上传 ${MAX_IMAGES} 张图片，已保留前 ${accepted.length} 张`)
  }
  return Promise.resolve(accepted)
}

/**
 * 读取完成后的上传。
 *
 * P5 常见坑 5：`max-count > 1` 时 `file` 可能是数组 —— 虽然本组件没开 `multiple`
 * 时只会给单个对象，但这里统一按数组处理，将来打开多选不必再改这段。
 */
async function afterRead(file) {
  const items = Array.isArray(file) ? file : [file]

  await Promise.all(
    items.map(async (item) => {
      item.status = 'uploading'
      item.message = '上传中'
      try {
        // 响应拦截器已解包，这里拿到的直接是 { url }
        const { url } = await uploadImage(item.file)
        item.url = url
        item.status = 'done'
        item.message = ''
      } catch {
        // 失败文案已由 axios 拦截器 Toast 过一次，这里只负责把该项标红，
        // 让用户明确知道「是这一张没传上」而不是整批回滚
        item.status = 'failed'
        item.message = '上传失败'
      }
    }),
  )

  emitUrls()
}
</script>

<template>
  <div class="image-uploader">
    <van-uploader
      v-model="fileList"
      multiple
      :max-count="MAX_IMAGES"
      :accept="ACCEPT_IMAGE_MIME"
      result-type="file"
      :before-read="beforeRead"
      :after-read="afterRead"
      @delete="emitUrls"
    />

    <p class="image-uploader__hint">
      最多 {{ MAX_IMAGES }} 张，支持 png / jpg，单张不超过 {{ MAX_IMAGE_MB }}MB
    </p>
  </div>
</template>

<style scoped>
.image-uploader__hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #969799;
}
</style>
