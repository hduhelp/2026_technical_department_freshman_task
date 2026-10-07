<script setup>
/**
 * 认领卡片。`ClaimManagePage`（帖主视角）与 `MyClaimsPage`（申请人视角）共用。
 *
 * 为什么一张卡要承载两种视角：
 * 两个页面展示的是**同一条 claim 的两面**（申请人 / 审核人），字段几乎完全重合，
 * 差别只在「头部显示谁」和「底部有没有操作按钮」。拆成两个组件会让
 * `voucher_code` 的可见性、拒绝理由的排版各写一遍，很容易一处改一处漏。
 *
 * 操作请求由本组件自己发起（与 StatusActionSheet 同一约定），完成后只抛
 * `success` 让父页面重拉列表 —— 不本地改 status，以后端落库结果为准。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'

import * as claimApi from '@/api/claim'
import HonorCertificate from '@/components/HonorCertificate.vue'
import { claimStatusLabel, claimStatusTagType, formatTime } from '@/utils/format'

const props = defineProps({
  /** 认领 DTO（ClaimDTO / MyClaimDTO 的并集都能满足） */
  claim: { type: Object, required: true },
  /** manage=帖主视角（显示申请人 + 审核/核销操作）；mine=申请人视角（显示帖子 + 凭证码） */
  mode: { type: String, default: 'manage' },
  /** mine 模式下已通过/已交接时展示的帖主联系方式；为空则退化为「去详情页查看」 */
  contact: { type: String, default: '' },
  /** 帖主昵称。manage 模式下 claim.post 是 null，证书要的昵称/标题只能由页面传入 */
  ownerNickname: { type: String, default: '' },
  /** 帖子标题。同上，manage 模式的 claim 不带 post 摘要 */
  postTitle: { type: String, default: '' },
})

const emit = defineEmits(['success'])

const router = useRouter()

const isManage = computed(() => props.mode === 'manage')
const isPending = computed(() => props.claim.status === 'pending')
const isApproved = computed(() => props.claim.status === 'approved')
const isRedeemed = computed(() => props.claim.status === 'redeemed')
const isRejected = computed(() => props.claim.status === 'rejected')

// 后端明确约定：未通过时 `voucher_code` 是 null（不是空串），
// 因此这里用真值判断即可，不要写成 `!== ''`（常见坑 8）。
const voucher = computed(() => props.claim.voucher_code || '')
const rejectReason = computed(() => props.claim.reject_reason || '')

const post = computed(() => props.claim.post || null)

/** 证书上的物品标题：manage 模式靠页面传，mine 模式可以直接用 claim.post */
const certPostTitle = computed(() => props.postTitle || post.value?.title || '')

const certShow = ref(false)

function goPost() {
  if (post.value) router.push(`/posts/${post.value.id}`)
}

// ==================== 复制凭证码 ====================
async function copyVoucher() {
  if (!voucher.value) return
  try {
    await navigator.clipboard.writeText(voucher.value)
    showToast('凭证码已复制')
  } catch {
    showToast('复制失败，请长按手动复制')
  }
}

// ==================== 通过 ====================
const submitting = ref(false)

function onApprove() {
  showConfirmDialog({
    title: '通过认领',
    message: `通过后系统将生成 6 位凭证码，帖子会标记为「已找到」。请与「${
      props.claim.claimant?.nickname || '申请人'
    }」线下核对后再操作。`,
    confirmButtonText: '通过',
  })
    .then(async () => {
      if (submitting.value) return
      submitting.value = true
      try {
        await claimApi.review(props.claim.id, { action: 'approve' })
        showSuccessToast('已通过，请把凭证码告知对方')
        emit('success')
      } catch {
        // 1007/1010 等业务文案由拦截器给出，不本地改状态
      } finally {
        submitting.value = false
      }
    })
    .catch(() => {})
}

// ==================== 拒绝 ====================
const rejectShow = ref(false)
const rejectInput = ref('')

function openReject() {
  rejectInput.value = ''
  rejectShow.value = true
}

/**
 * `van-dialog` 的 before-close：返回 false 会阻止关闭。
 * 用它的意义是——接口失败时弹层不关，用户改一下理由可以直接重试，
 * 不必重新走一遍「点拒绝 → 弹层被清空」的流程。
 */
async function onRejectBeforeClose(action) {
  if (action !== 'confirm') return true
  if (submitting.value) return false

  const reason = rejectInput.value.trim()
  if (!reason) {
    showToast('请填写拒绝理由，申请人会在「我的认领」看到它')
    return false
  }

  submitting.value = true
  try {
    await claimApi.review(props.claim.id, { action: 'reject', reject_reason: reason })
    showSuccessToast('已拒绝')
    emit('success')
    return true
  } catch {
    return false
  } finally {
    submitting.value = false
  }
}

// ==================== 核销 ====================
const redeemShow = ref(false)
const redeemInput = ref('')

function openRedeem() {
  redeemInput.value = ''
  redeemShow.value = true
}

// 凭证码字母表不含小写与小写易混字符，输入即转大写，少一次「为什么提示码错误」
function onRedeemInput(value) {
  redeemInput.value = value.toUpperCase().replace(/\s/g, '')
}

async function onRedeemBeforeClose(action) {
  if (action !== 'confirm') return true
  if (submitting.value) return false

  const code = redeemInput.value.trim()
  if (code.length !== 6) {
    showToast('凭证码是 6 位')
    return false
  }

  submitting.value = true
  try {
    await claimApi.redeem(props.claim.id, { voucher_code: code })
    showSuccessToast('核销成功，帖子已结束')
    emit('success')
    return true
  } catch {
    // 1011 凭证码错误：留在弹层里允许重输
    return false
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <article class="claim-card" :class="`claim-card--${claim.status}`">
    <!-- 头部：manage 显示申请人，mine 显示关联帖子 -->
    <header class="claim-card__head">
      <template v-if="isManage">
        <van-icon name="user-o" class="claim-card__head-icon" />
        <span class="claim-card__head-main">
          {{ claim.claimant?.nickname || '匿名同学' }}
        </span>
      </template>
      <template v-else>
        <!-- 用户输入一律插值，严禁 v-html -->
        <span class="claim-card__head-main claim-card__head-main--link" @click="goPost">
          {{ post?.title || '帖子已删除' }}
        </span>
        <van-icon
          v-if="post"
          name="arrow"
          class="claim-card__head-icon"
          @click="goPost"
        />
      </template>

      <van-tag :type="claimStatusTagType(claim.status)" plain>
        {{ claimStatusLabel(claim.status) }}
      </van-tag>
    </header>

    <!-- 认领证明 -->
    <div class="claim-card__block">
      <span class="claim-card__label">
        {{ isManage ? '对方的认领证明' : '我提交的认领证明' }}
      </span>
      <p class="claim-card__proof">{{ claim.proof }}</p>
    </div>

    <!-- 拒绝理由：双方都能看到，申请人据此知道该怎么补证 -->
    <div v-if="isRejected && rejectReason" class="claim-card__block claim-card__block--reject">
      <span class="claim-card__label">拒绝理由</span>
      <p class="claim-card__reason">{{ rejectReason }}</p>
    </div>

    <!-- 凭证码：仅「申请者本人」或「帖主」能拿到（07 §6），拿到就有值 -->
    <div v-if="voucher" class="claim-card__voucher">
      <div class="claim-card__voucher-main">
        <span class="claim-card__label">认领凭证码</span>
        <span class="claim-card__code">{{ voucher }}</span>
      </div>
      <van-button size="small" round plain type="primary" @click="copyVoucher">
        复制
      </van-button>
    </div>

    <!-- mine 模式：通过后展示帖主联系方式，这是 7.2 三级可见性的第三条 -->
    <div v-if="!isManage && (isApproved || isRedeemed)" class="claim-card__block">
      <span class="claim-card__label">对方联系方式</span>
      <p v-if="contact" class="claim-card__contact">{{ contact }}</p>
      <p v-else class="claim-card__contact claim-card__contact--muted" @click="goPost">
        点此进入帖子详情查看
      </p>
    </div>

    <footer class="claim-card__foot">
      <span>提交于 {{ formatTime(claim.created_at) }}</span>
      <span v-if="claim.redeemed_at">交接于 {{ formatTime(claim.redeemed_at) }}</span>
    </footer>

    <!-- 操作区（仅帖主视角） -->
    <div v-if="isManage && isPending" class="claim-card__ops">
      <van-button
        size="small"
        round
        type="primary"
        :loading="submitting"
        @click="onApprove"
      >
        通过
      </van-button>
      <van-button
        size="small"
        round
        plain
        type="danger"
        :disabled="submitting"
        @click="openReject"
      >
        拒绝
      </van-button>
    </div>
    <div v-else-if="isManage && isApproved" class="claim-card__ops">
      <!-- 文案写成动作而不是状态：approved 只是「已通过、还没核销」，
           写成「对方已核销」会让人以为不必再操作，与旁边的提示和点击行为都相反 -->
      <van-button size="small" round type="success" @click="openRedeem">
        核销凭证码
      </van-button>
      <span class="claim-card__ops-tip">请让对方出示凭证码后核销</span>
    </div>
    <div v-else-if="isManage && isRedeemed" class="claim-card__ops">
      <van-button size="small" round type="warning" @click="certShow = true">
        领取拾金不昧证书
      </van-button>
      <span class="claim-card__ops-tip">谢谢你把东西送回来</span>
    </div>
    <div v-else-if="isManage && isRejected" class="claim-card__ops">
      <span class="claim-card__ops-tip">已拒绝，对方可补充证明后重新提交</span>
    </div>

    <!-- 拒绝理由弹层 -->
    <van-dialog
      v-model:show="rejectShow"
      title="拒绝认领"
      show-cancel-button
      confirm-button-text="确认拒绝"
      confirm-button-color="#ee0a24"
      :before-close="onRejectBeforeClose"
    >
      <div class="claim-card__dialog">
        <van-field
          v-model="rejectInput"
          type="textarea"
          rows="2"
          maxlength="255"
          show-word-limit
          autofocus
          placeholder="说明不通过的原因，例如「物品特征描述不符」"
        />
      </div>
    </van-dialog>

    <!-- 核销弹层 -->
    <van-dialog
      v-model:show="redeemShow"
      title="核销凭证码"
      show-cancel-button
      confirm-button-text="确认核销"
      :before-close="onRedeemBeforeClose"
    >
      <div class="claim-card__dialog">
        <van-field
          :model-value="redeemInput"
          label="凭证码"
          maxlength="6"
          autofocus
          placeholder="输入对方出示的 6 位凭证码"
          @update:model-value="onRedeemInput"
        />
        <p class="claim-card__dialog-tip">核销后帖子会变为「已结束」，不可撤销</p>
      </div>
    </van-dialog>

    <!-- 拾金不昧证书（07 §11 彩蛋，颁给拾主） -->
    <HonorCertificate
      v-if="isManage"
      v-model:show="certShow"
      :nickname="ownerNickname"
      :post-title="certPostTitle"
      :redeemed-at="claim.redeemed_at"
    />
  </article>
</template>

<style scoped>
.claim-card {
  padding: 12px;
  margin-bottom: 10px;
  background: #fff;
  border-radius: 8px;
}

/* 已拒绝 / 已交接整体降饱和，让「待审核」在列表里最跳 */
.claim-card--rejected,
.claim-card--redeemed {
  opacity: 0.78;
}

.claim-card__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f2f3f5;
}

.claim-card__head-icon {
  color: #969799;
  font-size: 16px;
  flex: 0 0 auto;
}

.claim-card__head-main {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: #323233;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.claim-card__head-main--link {
  color: #1989fa;
  cursor: pointer;
}

.claim-card__block {
  margin-top: 10px;
}

.claim-card__label {
  display: block;
  font-size: 12px;
  color: #969799;
}

.claim-card__proof,
.claim-card__reason,
.claim-card__contact {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: #646566;
  white-space: pre-wrap;
  word-break: break-word;
}

.claim-card__reason {
  color: #ee0a24;
}

.claim-card__contact {
  color: #1989fa;
}

.claim-card__contact--muted {
  color: #969799;
  cursor: pointer;
}

/* ===== 凭证码 ===== */
.claim-card__voucher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #ecf5ff, #f7f8fa);
  border: 1px dashed #a0cfff;
  border-radius: 8px;
}

.claim-card__voucher-main {
  min-width: 0;
}

/* 凭证码是本页最重要的信息：等宽 + 大字距，手抄/念给对方都不容易错 */
.claim-card__code {
  display: block;
  margin-top: 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #1989fa;
}

.claim-card__foot {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  font-size: 12px;
  color: #969799;
}

.claim-card__ops {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #f2f3f5;
}

.claim-card__ops-tip {
  flex: 1;
  font-size: 12px;
  color: #969799;
}

.claim-card__dialog {
  padding: 14px 0 6px;
}

.claim-card__dialog-tip {
  margin: 10px 16px 0;
  font-size: 12px;
  line-height: 1.5;
  color: #969799;
}
</style>
