<script setup>
/**
 * 发布 / 编辑共用的帖子表单。
 *
 * 为什么必须复用而不是各写一份：字段级校验（标题 1–64、地点 ≤64、描述 ≤2000、
 * 图片 ≤3）在创建与编辑两侧完全一致。复制两份的结局一定是「改了一边忘了另一边」，
 * 用户的体验就是「发布能过、编辑报错」。这里只写一份，两侧只差一个 `initialValue`。
 *
 * 组件本身**不发请求**：只负责收集 + 校验 + 把 payload 通过 `submit` 抛出去，
 * 由页面决定调 create 还是 update。这样组件没有「mode」之类的分支状态，
 * 测试时也能单独挂载跑。
 */
import { computed, reactive, ref, watch } from 'vue'
import { showToast } from 'vant'

import ImageUploader from '@/components/ImageUploader.vue'
import { CATEGORIES, POST_TYPES } from '@/constants'
import { categoryLabel } from '@/utils/format'

const props = defineProps({
  /**
   * 编辑模式下传入的 PostDTO；发布时传 null。
   *
   * 是否存在即代表「是否编辑模式」—— 刻意不再加一个 `mode` prop，
   * 因为两个来源必然要同步，而多一个可能不同步的状态就是多一个 bug。
   */
  initialValue: { type: Object, default: null },
  /** 提交中，用于禁用按钮防重复提交 */
  submitting: { type: Boolean, default: false },
})

const emit = defineEmits(['submit'])

/** 与后端 PostService.applyFields 保持一致的上限（按 rune 计数，非字节） */
const MAX_TITLE_LEN = 64
const MAX_LOCATION_LEN = 64
const MAX_DESCRIPTION_LEN = 2000
/** 后端允许 happened_at 略微超前，与 service 的 happenedAtFutureTolerance 对齐 */
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000

const isEdit = computed(() => props.initialValue != null && props.initialValue.id != null)

const pad2 = (n) => String(n).padStart(2, '0')

/** 按 rune 计数长度：中文标题用 .length 会因代理对被高估 */
const runeLen = (s) => [...String(s ?? '')].length

/** 本地 Date → van-date-picker 需要的 ['YYYY','MM','DD']（必须补零，Vant 列值是补零字符串） */
const toDateArray = (d) => [String(d.getFullYear()), pad2(d.getMonth() + 1), pad2(d.getDate())]
/** 本地 Date → van-time-picker 需要的 ['HH','mm'] */
const toTimeArray = (d) => [pad2(d.getHours()), pad2(d.getMinutes())]

/** 新建时的默认值：时间默认「现在」，其余留空 */
function defaultForm() {
  const now = new Date()
  return {
    type: 'lost',
    title: '',
    category: 'other',
    location: '',
    description: '',
    images: [],
    dateValue: toDateArray(now),
    timeValue: toTimeArray(now),
  }
}

/** PostDTO → 表单值。happened_at 是 UTC RFC3339，`new Date` 会自动转本地时区 */
function fromPost(post) {
  const happened = new Date(post.happened_at)
  const safe = Number.isNaN(happened.getTime()) ? new Date() : happened
  return {
    type: post.type || 'lost',
    title: post.title || '',
    category: post.category || 'other',
    location: post.location || '',
    description: post.description || '',
    images: Array.isArray(post.images) ? [...post.images] : [],
    dateValue: toDateArray(safe),
    timeValue: toTimeArray(safe),
  }
}

const form = reactive(defaultForm())

/** 提交出去的干净快照，用于判断「是否有未保存的内容」以及重置基线 */
function snapshot() {
  return JSON.stringify({
    type: form.type,
    title: form.title.trim(),
    category: form.category,
    location: form.location.trim(),
    description: form.description,
    images: form.images,
    dateValue: form.dateValue,
    timeValue: form.timeValue,
  })
}

const baseline = ref(snapshot())

/**
 * 表单是否被改动过。
 *
 * 用「与基线快照比对」而不是监听每个字段：这样用户填完又手动清空的场景
 * 也能正确判定为「无改动」，不会在返回时弹一个莫名其妙的确认框。
 */
const isDirty = computed(() => snapshot() !== baseline.value)

/** 清空表单并把基线归位（发布成功后调用，避免返回时残留上一次的内容） */
function reset(post = null) {
  Object.assign(form, post ? fromPost(post) : defaultForm())
  baseline.value = snapshot()
}

// 常见坑 3：initialValue 是异步到达的（编辑页 onMounted 才拉到详情），
// 必须 watch 重新灌入，否则「从 A 帖返回再进 B 帖」会残留 A 的数据。
watch(
  () => props.initialValue,
  (post) => reset(post),
  { immediate: true },
)

// ===== 分类选择器 =====
const showCategoryPicker = ref(false)
const categoryColumns = CATEGORIES.map((item) => ({ text: item.label, value: item.value }))

function onCategoryConfirm({ selectedValues }) {
  form.category = selectedValues[0]
  showCategoryPicker.value = false
}

// ===== 发生时间选择器 =====
const showTimePicker = ref(false)

/**
 * 日期可选范围。
 *
 * `min-date` / `max-date` 必须显式给：Vant 两者的默认值都是「当前时刻」，
 * 不设的话用户连昨天都选不到。
 *
 * maxDate 刻意放宽到「一年后」而不是 `now + 1h`：
 * 「发生时间不能晚于当前时间 + 1 小时」这条规则由后端权威执行（SPEC 10），
 * 前端如果直接把日历卡死，用户就没有机会看到这条规则的存在，
 * 只会觉得「日历坏了」。放宽为一年后，既能正常选到过去的日期，
 * 又能在选错时由下面的提交校验给出明确提示。
 */
const minDate = new Date(2020, 0, 1)
const maxDate = (() => {
  const d = new Date()
  return new Date(d.getFullYear() + 1, d.getMonth(), d.getDate())
})()

function onHappenedConfirm(values) {
  // van-picker-group 的 confirm 事件把子选择器的结果按顺序组成数组
  const [dateValues, timeValues] = values
  if (Array.isArray(dateValues) && dateValues.length === 3) {
    form.dateValue = dateValues.map(String)
  }
  if (Array.isArray(timeValues) && timeValues.length === 2) {
    form.timeValue = timeValues.map(String)
  }
  showTimePicker.value = false
}

const happenedAtText = computed(() =>
  form.dateValue?.length === 3 && form.timeValue?.length === 2
    ? `${form.dateValue.join('-')} ${form.timeValue.join(':')}`
    : '',
)

// ===== 提交 =====
function onSubmit() {
  // 提交中再点一次会发出第二个请求，直接吞掉
  if (props.submitting) return

  if (!POST_TYPES.some((item) => item.value === form.type)) {
    showToast('请选择帖子类型')
    return
  }

  const title = form.title.trim()
  if (!title) {
    showToast('请填写标题')
    return
  }
  if (runeLen(title) > MAX_TITLE_LEN) {
    showToast(`标题不能超过 ${MAX_TITLE_LEN} 个字符`)
    return
  }
  if (runeLen(form.location.trim()) > MAX_LOCATION_LEN) {
    showToast(`地点不能超过 ${MAX_LOCATION_LEN} 个字符`)
    return
  }
  if (runeLen(form.description) > MAX_DESCRIPTION_LEN) {
    showToast(`描述不能超过 ${MAX_DESCRIPTION_LEN} 个字符`)
    return
  }
  if (!happenedAtText.value) {
    showToast('请选择发生时间')
    return
  }

  // 本地时区字符串会被 ES 规范按「本地时间」解析，再转 UTC ISO。
  // 形如 '2026-10-01T13:30:00' → '2026-10-01T05:30:00.000Z'
  const local = new Date(`${form.dateValue.join('-')}T${form.timeValue.join(':')}:00`)
  if (Number.isNaN(local.getTime())) {
    showToast('发生时间格式不正确，请重新选择')
    return
  }
  if (local.getTime() - Date.now() > FUTURE_TOLERANCE_MS) {
    // 与后端错误文案保持一致，避免同一问题出现两种说法
    showToast('发生时间不能晚于当前时间')
    return
  }

  emit('submit', {
    type: form.type,
    title,
    category: form.category,
    location: form.location.trim(),
    happened_at: local.toISOString(),
    description: form.description,
    images: [...form.images],
  })
}

// 供父页面使用：返回时二次确认、提交成功后清空
defineExpose({ isDirty, reset })
</script>

<template>
  <van-form class="post-form" @submit="onSubmit">
    <van-cell-group inset class="post-form__group">
      <!-- 类型整行铺满，不塞进 field 的 input 槽：
           390px 宽的屏幕上，field 的 input 区被 label 挤掉一截，
           两个大按钮里的「我捡到东西」会被折成两行。 -->
      <van-cell title="类型" :required="true" class="post-form__type-cell" />
      <div class="post-form__type-wrap">
        <van-radio-group
          v-model="form.type"
          direction="horizontal"
          class="post-form__types"
          :disabled="isEdit"
        >
          <label
            v-for="item in POST_TYPES"
            :key="item.value"
            class="post-form__type"
            :class="{
              'is-active': form.type === item.value,
              'is-disabled': isEdit,
            }"
          >
            <van-radio :name="item.value" icon-size="16px">
              <span class="post-form__type-label">{{ item.label }}</span>
              <span class="post-form__type-desc">
                {{ item.value === 'lost' ? '我丢了东西' : '我捡到东西' }}
              </span>
            </van-radio>
          </label>
        </van-radio-group>
      </div>
    </van-cell-group>

    <van-cell-group inset class="post-form__group">
      <van-field
        v-model="form.title"
        label="标题"
        placeholder="一句话说清是什么，如「黑色卡套校园卡」"
        :required="true"
        :maxlength="MAX_TITLE_LEN"
        show-word-limit
      />

      <van-field
        :model-value="categoryLabel(form.category)"
        label="分类"
        placeholder="请选择分类"
        readonly
        is-link
        @click="showCategoryPicker = true"
      />

      <van-field
        v-model="form.location"
        label="地点"
        placeholder="如「下沙校区图书馆 3 楼」"
        :maxlength="MAX_LOCATION_LEN"
        show-word-limit
      />

      <van-field
        :model-value="happenedAtText"
        label="发生时间"
        placeholder="请选择丢失 / 拾到的时间"
        readonly
        is-link
        :required="true"
        @click="showTimePicker = true"
      />
    </van-cell-group>

    <van-cell-group inset class="post-form__group">
      <van-field
        v-model="form.description"
        label="详细描述"
        type="textarea"
        rows="4"
        autosize
        placeholder="补充颜色、特征、内含物等，方便对方核对（≤2000 字）"
        :maxlength="MAX_DESCRIPTION_LEN"
        show-word-limit
      />
    </van-cell-group>

    <van-cell-group inset class="post-form__group">
      <van-cell title="图片（选填）" />
      <div class="post-form__uploader">
        <ImageUploader v-model="form.images" />
      </div>
    </van-cell-group>

    <div class="post-form__submit">
      <van-button
        block
        round
        type="primary"
        native-type="submit"
        :loading="submitting"
        loading-text="提交中…"
      >
        {{ isEdit ? '保存修改' : '立即发布' }}
      </van-button>
      <p v-if="isEdit" class="post-form__tip">「失物 / 招领」类型创建后不可修改</p>
    </div>

    <!-- 分类选择 -->
    <van-popup v-model:show="showCategoryPicker" position="bottom" round>
      <van-picker
        title="选择分类"
        :columns="categoryColumns"
        :model-value="[form.category]"
        @confirm="onCategoryConfirm"
        @cancel="showCategoryPicker = false"
      />
    </van-popup>

    <!-- 发生时间选择：日期 + 时间两栏，由 van-picker-group 提供统一确认按钮 -->
    <van-popup v-model:show="showTimePicker" position="bottom" round>
      <van-picker-group
        title="选择发生时间"
        :tabs="['选择日期', '选择时间']"
        next-step-text="下一步"
        @confirm="onHappenedConfirm"
        @cancel="showTimePicker = false"
      >
        <van-date-picker
          v-model="form.dateValue"
          :min-date="minDate"
          :max-date="maxDate"
          :show-toolbar="false"
        />
        <van-time-picker v-model="form.timeValue" :show-toolbar="false" />
      </van-picker-group>
    </van-popup>
  </van-form>
</template>

<style scoped>
.post-form {
  padding-bottom: 24px;
}

.post-form__group {
  margin-top: 12px;
}

/* 类型选择：cell 只留标题，控件整行铺满 */
.post-form__type-cell {
  padding-bottom: 4px;
}

.post-form__type-wrap {
  padding: 4px 16px 14px;
}

.post-form__types {
  display: flex;
  flex: 1;
  gap: 10px;
}

/* 两张大按钮：等宽、可整块点击。
   用 label 包住 van-radio，点文字即选中，点击热区覆盖整张卡片。 */
.post-form__type {
  flex: 1;
  padding: 10px 10px;
  border: 1px solid #ebedf0;
  border-radius: 8px;
  background: #f7f8fa;
  cursor: pointer;
  transition: all 0.15s ease;
}

.post-form__type.is-active {
  border-color: #1989fa;
  background: #e8f3ff;
}

.post-form__type.is-disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.post-form__type :deep(.van-radio) {
  align-items: flex-start;
}

.post-form__type :deep(.van-radio__label) {
  margin-left: 6px;
}

.post-form__type-label {
  font-size: 15px;
  font-weight: 600;
  color: #323233;
}

.post-form__type-desc {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.3;
  color: #969799;
  white-space: nowrap;
}

.post-form__uploader {
  padding: 12px 16px 16px;
}

.post-form__submit {
  margin: 20px 16px 0;
}

.post-form__tip {
  margin: 10px 0 0;
  font-size: 12px;
  text-align: center;
  color: #969799;
}
</style>
