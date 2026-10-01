<script setup>
/**
 * 拾金不昧荣誉证书（07 §11 可选彩蛋）。
 *
 * **颁发给「拾主」**，也就是 `found` 帖的作者 —— 在这个系统里，
 * 提交认领的是**失主**，把东西交出去的是**帖主**。
 * 「拾金不昧」的主语只能是后者，所以入口放在帖主侧的「认领管理」页，
 * 而不是认领人侧的「我的认领」（07 §11 括号里的措辞与系统语义相反，
 * 这里按语义实现，并在汇报里注明）。
 *
 * 用 `<canvas>` 而不是 DOM 画证书，原因是**可保存**：
 * 画完之后 `toDataURL('image/png')` 直接产出一张图片，
 * 用户可以下载、发朋友圈。DOM 证书要变成图片还得再引一个截图库。
 *
 * 另一个好处是**可打印性可控**：画布上写死 720×520 的逻辑尺寸，
 * 与屏幕 DPR 无关，任何设备导出的都是同一张图。
 */
import { nextTick, onMounted, ref, watch } from 'vue'
import { showToast } from 'vant'

import { formatTime } from '@/utils/format'

const props = defineProps({
  /** 显隐，配合 v-model:show 使用 */
  show: { type: Boolean, default: false },
  /** 拾主昵称（= 帖主昵称） */
  nickname: { type: String, default: '' },
  /** 物品标题 */
  postTitle: { type: String, default: '' },
  /** 归还时间（claim.redeemed_at，UTC RFC3339） */
  redeemedAt: { type: String, default: '' },
})

const emit = defineEmits(['update:show'])

// 画布逻辑尺寸。写死而不是跟随容器，保证导出结果稳定
const W = 720
const H = 520

const COLOR = {
  paper: '#fffdf6',
  gold: '#c9a24a',
  ink: '#3a2f24',
  muted: '#8a7c68',
  seal: '#c0392b',
}

const canvas = ref(null)
const dataUrl = ref('')

/** 按 maxWidth 折行。中文按字符宽度均分即可，不必逐字测量 */
function wrapText(ctx, text, maxWidth) {
  const lines = []
  let line = ''
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

function draw(ctx, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  // ---- 纸面 ----
  ctx.fillStyle = COLOR.paper
  ctx.fillRect(0, 0, W, H)

  // 双线边框：外粗内细是证书的通用视觉语言
  ctx.strokeStyle = COLOR.gold
  ctx.lineWidth = 5
  ctx.strokeRect(16, 16, W - 32, H - 32)
  ctx.lineWidth = 1.5
  ctx.strokeRect(30, 30, W - 60, H - 60)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // ---- 标题 ----
  ctx.fillStyle = COLOR.ink
  ctx.font = 'bold 46px "Songti SC", "SimSun", "Microsoft YaHei", serif'
  ctx.fillText('拾金不昧  荣誉证书', W / 2, 112)

  ctx.fillStyle = COLOR.muted
  ctx.font = '14px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText('CERTIFICATE  OF  HONESTY', W / 2, 150)

  ctx.strokeStyle = COLOR.gold
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(170, 176)
  ctx.lineTo(W - 170, 176)
  ctx.stroke()

  // ---- 正文 ----
  // 这一行由「固定文案 + 变量昵称 + 固定文案」三段拼成，整体居中。
  // 三段各自 measureText 后累加再算起点，而不是给昵称写死偏移量 ——
  // 偏移量写法在昵称长度变化时会立刻露馅（要么重叠、要么豁口）。
  const nickname = props.nickname || '这位同学'
  const FIXED_FONT = '22px "Songti SC", "SimSun", "Microsoft YaHei", serif'
  const NAME_FONT = 'bold 26px "Songti SC", "SimSun", "Microsoft YaHei", serif'
  const prefix = '兹有 '
  const suffix = ' 同学，于'

  ctx.font = FIXED_FONT
  const wPrefix = ctx.measureText(prefix).width
  const wSuffix = ctx.measureText(suffix).width
  ctx.font = NAME_FONT
  const wName = ctx.measureText(nickname).width

  ctx.textAlign = 'left'
  let x = (W - (wPrefix + wName + wSuffix)) / 2

  ctx.fillStyle = COLOR.ink
  ctx.font = FIXED_FONT
  ctx.fillText(prefix, x, 226)
  x += wPrefix

  ctx.fillStyle = COLOR.seal
  ctx.font = NAME_FONT
  ctx.fillText(nickname, x, 226)
  x += wName

  ctx.fillStyle = COLOR.ink
  ctx.font = FIXED_FONT
  ctx.fillText(suffix, x, 226)

  ctx.textAlign = 'center'

  const titleLines = wrapText(ctx, `「${props.postTitle || '拾获物品'}」`, W - 220).slice(0, 2)
  titleLines.forEach((line, i) => {
    ctx.fillStyle = COLOR.seal
    ctx.font = 'bold 24px "Songti SC", "SimSun", "Microsoft YaHei", serif'
    ctx.fillText(line, W / 2, 282 + i * 38)
  })

  ctx.fillStyle = COLOR.ink
  ctx.font = '22px "Songti SC", "SimSun", "Microsoft YaHei", serif'
  ctx.fillText('予以归还，分文不取。', W / 2, 282 + titleLines.length * 38 + 6)
  ctx.fillText('以诚待人，拾金不昧，特此表彰。', W / 2, 282 + titleLines.length * 38 + 48)

  // ---- 落款：印章 ----
  const sealY = H - 88
  ctx.strokeStyle = COLOR.seal
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(138, sealY, 44, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = COLOR.seal
  ctx.font = 'bold 20px "Songti SC", "SimSun", serif'
  ctx.fillText('★', 138, sealY - 12)
  ctx.font = '13px "Songti SC", "SimSun", "Microsoft YaHei", serif'
  ctx.fillText('校园', 138, sealY + 10)
  ctx.fillText('失物招领', 138, sealY + 28)

  // ---- 落款：日期 ----
  // 证书上只写日期，不写时分 —— 「归还于 15:36」是日志口径，不是证书口径
  const day = (formatTime(props.redeemedAt) || '').slice(0, 10) || '—'
  ctx.textAlign = 'right'
  ctx.fillStyle = COLOR.muted
  ctx.font = '13px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText('归还日期', W - 96, sealY - 14)
  ctx.fillStyle = COLOR.ink
  ctx.font = '20px "Menlo", "Consolas", monospace'
  ctx.fillText(day, W - 96, sealY + 16)
}

function render() {
  const el = canvas.value
  if (!el) return
  // 2 倍超采样：导出 1440×1040，放大看也不糊
  const dpr = 2
  el.width = W * dpr
  el.height = H * dpr
  const ctx = el.getContext('2d')
  draw(ctx, dpr)
  dataUrl.value = el.toDataURL('image/png')
}

onMounted(() => {
  if (props.show) render()
})

/**
 * ⚠️ 必须在 DOM 更新**之后**再画。
 *
 * `van-popup` 是懒渲染的：内容要到 `show` 变 true 的那个更新周期才挂进 DOM。
 * 而 Vue 的 `watch` 默认是 `flush: 'pre'`（更新前触发），此时 `canvas.value`
 * 还是 null，`render()` 会静默 return —— 结果就是弹层里出现一块 300×150 的空白
 * （canvas 的 HTML 默认尺寸）。
 *
 * 所以这里同时做两件事：`flush: 'post'` 把回调挪到更新之后，
 * 再 `await nextTick()` 兜一层（Vant 内部自己是靠 watcher 置 `shouldRender`，
 * 两个 watcher 的先后顺序不该由我们来赌）。
 */
watch(
  () => props.show,
  async (val) => {
    if (!val) return
    await nextTick()
    render()
  },
  { flush: 'post' },
)

watch(
  () => [props.nickname, props.postTitle, props.redeemedAt],
  async () => {
    if (!props.show) return
    await nextTick()
    render()
  },
  { flush: 'post' },
)

function download() {
  if (!dataUrl.value) return
  const a = document.createElement('a')
  a.href = dataUrl.value
  a.download = `拾金不昧证书-${props.nickname || '同学'}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  showToast('已保存到下载目录')
}
</script>

<template>
  <van-popup
    :show="show"
    position="center"
    round
    :style="{ width: '88%', maxWidth: '420px' }"
    @update:show="emit('update:show', $event)"
  >
    <div class="cert-sheet">
      <h3 class="cert-sheet__title">拾金不昧荣誉证书</h3>
      <p class="cert-sheet__hint">长按图片可保存，也可以点下面的按钮直接下载</p>

      <div class="cert-sheet__canvas-wrap">
        <canvas ref="canvas" class="cert-sheet__canvas" />
      </div>

      <div class="cert-sheet__actions">
        <van-button block round type="primary" @click="download">保存为图片</van-button>
        <van-button block round plain @click="emit('update:show', false)">关闭</van-button>
      </div>
    </div>
  </van-popup>
</template>

<style scoped>
.cert-sheet {
  padding: 20px 18px 22px;
}

.cert-sheet__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  color: #323233;
}

.cert-sheet__hint {
  margin: 8px 0 14px;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
  color: #969799;
}

.cert-sheet__canvas-wrap {
  /* 画布内部按 720×520 绘制，这里只控制显示尺寸，等比缩放 */
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
}

.cert-sheet__canvas {
  display: block;
  width: 100%;
  height: auto;
}

.cert-sheet__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
}
</style>
