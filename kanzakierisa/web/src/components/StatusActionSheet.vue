<script setup>
/**
 * 状态流转弹层。
 *
 * 选项由**当前状态**推导，与后端 SPEC 7.1 的状态机白名单一一对应：
 *
 *   open    → 标记「已找到」→ matched ｜ 直接「结束」→ closed
 *   matched → 标记「已结束」→ closed
 *   closed  → 无可选项（终态）
 *
 * 这里只做「把合法选项列出来」，**合法性判定仍然在后端**：前端即便被绕过、
 * 发一个非法跳转，后端 `ValidateTransition` 也会返回 1007。
 * 前端这份表的价值是「不让用户点到注定失败的按钮」，不是安全边界。
 *
 * 请求由本组件发起（而不是抛给父页面各写一遍），成功后把最新 DTO 通过
 * `success` 抛出去让父页面决定怎么刷新 —— 详情页重拉详情，「我的」重拉列表。
 */
import { computed, ref } from 'vue'
import { showSuccessToast, showToast } from 'vant'

import * as postApi from '@/api/post'

const props = defineProps({
  /** 显隐，配合 v-model:show 使用 */
  show: { type: Boolean, default: false },
  /** 帖子 id */
  postId: { type: [Number, String], required: true },
  /** 帖子当前状态 */
  status: { type: String, default: '' },
})

const emit = defineEmits(['update:show', 'success'])

/** 状态 → 可选操作。key 必须与后端状态枚举完全一致 */
const OPTIONS = {
  open: [
    { name: '标记已找到', subname: '已确认物品下落 / 已归还', value: 'matched' },
    { name: '直接结束', subname: '不再需要继续寻找', value: 'closed' },
  ],
  matched: [{ name: '标记已结束', subname: '交接完成，帖子归档', value: 'closed' }],
  closed: [],
}

const actions = computed(() => OPTIONS[props.status] || [])
const isEmpty = computed(() => actions.value.length === 0)

const description = computed(() =>
  isEmpty.value ? '该帖子已结束，没有可执行的操作' : '',
)

const submitting = ref(false)

async function onSelect(action) {
  if (submitting.value) return
  submitting.value = true
  try {
    // 响应拦截器已解包，拿到的是后端落库后的最新 PostDTO
    const updated = await postApi.changeStatus(props.postId, action.value)
    showSuccessToast('状态已更新')
    emit('update:show', false)
    emit('success', updated)
  } catch {
    // 失败文案（1003 / 1007 / 乐观锁冲突）已由拦截器 Toast 过。
    // 不关闭弹层，用户可以直接换个选项或取消。
  } finally {
    submitting.value = false
  }
}

function onCancel() {
  if (submitting.value) {
    showToast('正在提交，请稍候')
    return
  }
  emit('update:show', false)
}
</script>

<template>
  <van-action-sheet
    :show="show"
    :actions="actions"
    :description="description"
    :cancel-text="isEmpty ? '知道了' : '取消'"
    :close-on-click-action="false"
    close-on-click-overlay
    @select="onSelect"
    @cancel="onCancel"
    @update:show="emit('update:show', $event)"
  />
</template>
