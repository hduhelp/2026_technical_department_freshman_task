<script setup>
/**
 * 帖子详情页。
 *
 * 这一页承担了两条跨阶段规则的前端落点：
 *
 * 1. **SPEC 7.2 联系方式三级可见性**：后端已经**在 SQL 层**决定好 contact
 *    是否返回，前端只按 `contact_visible` 渲染两种完全不同的 CTA，
 *    绝不二次判断。
 *
 * 2. **SPEC 7.3 / 07 §7 认领入口的四种互斥状态**（P6）。模板里的判断顺序是
 *
 *      自己是帖主  >  未登录  >  my_claim 存在  >  can_claim  >  兜底
 *
 *    `未登录` 之所以能插在 `my_claim` 之前：游客没有 token，详情接口返回的
 *    `my_claim` 恒为 null，两条分支不会同时命中，交换顺序也不改变结果。
 *
 *    为什么 `my_claim` 必须排在 `can_claim` **前面**：后端刻意把 `can_claim`
 *    做成了与列表接口语义一致的「静态准入判断」（found 帖、非本人、未 closed），
 *    它**不包含**「我已经申请过」这条信息 —— 那条信息由详情接口的 `my_claim`
 *    承载。所以一个已提交申请的人 `can_claim` 依然是 true，若先判 can_claim
 *    就会把「认领审核中」错显示成「这是我的」，让用户以为没提交成功。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showImagePreview, showSuccessToast, showToast } from 'vant'

import * as claimApi from '@/api/claim'
import * as postApi from '@/api/post'
import EmptyState from '@/components/EmptyState.vue'
import MatchList from '@/components/MatchList.vue'
import StatusActionSheet from '@/components/StatusActionSheet.vue'
import { useUserStore } from '@/store/user'
import {
  categoryLabel,
  claimStatusLabel,
  claimStatusTagType,
  formatTime,
  fromNow,
  statusLabel,
  statusTagType,
  typeColor,
  typeLabel,
} from '@/utils/format'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const post = ref(null)
const loading = ref(true)
const notFound = ref(false)

const images = computed(() => {
  const list = post.value?.images
  return Array.isArray(list) ? list : []
})

/**
 * 图片轮播的当前下标。
 *
 * ⚠️ 为什么需要自己维护 active：Vant 4 的 Swipe **只监听 touch 事件**
 * （Swipe.mjs 里只有 onTouchStart / onTouchMove / onTouchEnd / onTouchcancel，
 * 一个 onMouse* 都没有），默认指示器也是纯 div、没有 onClick。
 * 后果是**在桌面浏览器里用鼠标完全拖不动，也无法点圆点切换** ——
 * 演示时表现为「只能看到第一张」。
 *
 * 修法：左右加显式箭头 + 自定义可点击指示器，全部走 Swipe 实例暴露的
 * next() / prev() / swipeTo()，这样手机（触摸滑动）和桌面（点按）都能用。
 */
const swipeRef = ref(null)
const activeIndex = ref(0)
const hasMultiple = computed(() => images.value.length > 1)

function onSwipeChange(index) {
  activeIndex.value = index
}
function goPrev() {
  swipeRef.value?.prev()
}
function goNext() {
  swipeRef.value?.next()
}
function goTo(index) {
  swipeRef.value?.swipeTo(index)
}

/** 点图放大查看，顺带解决「看不清细节」的问题 */
function previewImage(index) {
  showImagePreview({
    images: images.value,
    startPosition: index,
    closeable: true,
    loop: false,
  })
}

const isAuthor = computed(() => post.value?.can_edit === true)
const isGuest = computed(() => !userStore.isLogin)
const canClaim = computed(() => post.value?.can_claim === true)
const isFound = computed(() => post.value?.type === 'found')
const contactVisible = computed(() => post.value?.author?.contact_visible === true)
const contact = computed(() => post.value?.author?.contact || '')

/**
 * 当前用户在这张帖子上自己提交的那条认领。未登录 / 未申请 / 列表接口恒为 null。
 * 后端明确保证 `voucher_code` 未通过时是 **null**（不是空串），
 * 所以全部用真值判断（常见坑 8）。
 */
const myClaim = computed(() => post.value?.my_claim || null)
const myClaimStatus = computed(() => myClaim.value?.status || '')
const myVoucher = computed(() => myClaim.value?.voucher_code || '')
const myRejectReason = computed(() => myClaim.value?.reject_reason || '')

async function load() {
  loading.value = true
  notFound.value = false
  try {
    post.value = await postApi.detail(route.params.id)
  } catch {
    // 404 的业务错误已由拦截器提示过，这里只切到「不存在」视图
    post.value = null
    notFound.value = true
  } finally {
    loading.value = false
  }
}

/**
 * 为什么必须 watch 而不只是 onMounted：
 * `/posts/:id` 是**同一条路由记录**，从详情页点「可能有这些匹配」跳到另一帖时，
 * Vue Router 会复用本组件实例、只改 route.params，onMounted 不会再跑一次。
 * 只挂 onMounted 的后果是 URL 换了、标题/描述/图片/操作栏却还是上一帖的，
 * 「删除」「改状态」甚至会作用在错的那条帖子上。
 *
 * 用 `immediate: true` 顶替首屏的 onMounted：两者只留一个，避免首屏发两次详情请求。
 */
watch(() => route.params.id, load, { immediate: true })

/** 直接打开详情链接时没有历史记录，退回首页而不是白屏 */
function goBack() {
  if (window.history.state?.back) {
    router.back()
  } else {
    router.replace('/')
  }
}

function goEdit() {
  router.push(`/posts/${post.value.id}/edit`)
}

function goLogin() {
  router.push({ path: '/login', query: { redirect: `/posts/${post.value.id}` } })
}

function goMyClaims() {
  router.push('/me/claims')
}

// ===== 作者操作（P5）=====

/** 状态流转弹层。弹层自己调接口，成功后回调这里重拉详情 ——
 *  不本地改 status，以后端落库结果为准（P5 常见坑 4）。 */
const showStatusSheet = ref(false)

function openStatusFlow() {
  showStatusSheet.value = true
}

function onStatusSuccess() {
  load()
}

function onDelete() {
  showConfirmDialog({
    title: '删除帖子',
    message: `「${post.value.title}」删除后不可恢复，该帖下的认领申请也会一并删除。`,
    confirmButtonText: '删除',
    confirmButtonColor: '#ee0a24',
  })
    .then(async () => {
      await postApi.remove(post.value.id)
      showSuccessToast('已删除')
      // 常见坑 6：这里必须用 replace 而不是 router.back()。
      // 若用 back，浏览器的前进/后退缓存里仍留着这一页，
      // 用户回到列表再点进去会看到「刚删掉的帖子」。
      router.replace('/')
    })
    // 用户取消会 reject，吞掉
    .catch(() => {})
}

// ===== 认领入口（P6 / 07 §7）=====

function goClaimManage() {
  router.push({ path: '/claims/manage', query: { postId: post.value.id } })
}

// ---------- 提交认领 ----------
const showProof = ref(false)
const submitting = ref(false)
const proofForm = reactive({ proof: '' })

/** proof 的长度上限后端按 **rune** 算（10–500 个字符），
 *  `String.length` 数的是 UTF-16 code unit，一个 emoji 会算成 2，
 *  用 `Array.from` 取码点才和后端口径一致。
 *
 *  必须**先 trim 再计数**：提交的是 `proofForm.proof.trim()`，后端也算 trim 后的长度。
 *  若这里按原文计数，输入「（10 个空格）abc」前端会判成 10 字放行，
 *  实际提交只有 3 个字，必然换回一个 1001 —— 字数提示与提交同源才不会骗用户。 */
const proofLength = computed(() => Array.from(proofForm.proof.trim()).length)
const proofValid = computed(() => proofLength.value >= 10 && proofLength.value <= 500)

const proofTip = computed(() => {
  if (proofLength.value === 0) return '至少 10 个字，写清只有物主才知道的特征'
  if (proofLength.value < 10) return `还差 ${10 - proofLength.value} 个字`
  if (!proofValid.value) return '最多 500 个字'
  return ''
})

function openProof() {
  proofForm.proof = ''
  showProof.value = true
}

async function submitProof() {
  if (submitting.value) return
  if (!proofValid.value) {
    showToast(proofTip.value || '请填写 10–500 字的认领证明')
    return
  }
  submitting.value = true
  try {
    await claimApi.apply(post.value.id, { proof: proofForm.proof.trim() })
    showSuccessToast('已提交，等待对方审核')
    showProof.value = false
    // 不本地造一个 pending 出来：重拉详情，以后端返回的 my_claim 为准
    await load()
  } catch {
    // 1001/1008/1010 的文案由拦截器 Toast；弹层不关，用户可以改证明
  } finally {
    submitting.value = false
  }
}

async function copyVoucher() {
  if (!myVoucher.value) return
  try {
    await navigator.clipboard.writeText(myVoucher.value)
    showToast('凭证码已复制')
  } catch {
    showToast('复制失败，请长按手动复制')
  }
}

async function copyContact() {
  if (!contact.value) return
  try {
    await navigator.clipboard.writeText(contact.value)
    showToast('已复制联系方式')
  } catch {
    showToast('复制失败，请长按手动复制')
  }
}
</script>

<template>
  <div class="page detail-page">
    <van-nav-bar title="帖子详情" left-arrow fixed placeholder @click-left="goBack" />

    <div v-if="loading" class="detail-page__loading">
      <van-loading type="spinner" vertical>加载中…</van-loading>
    </div>

    <EmptyState
      v-else-if="notFound"
      image="error"
      description="帖子不存在或已被删除"
    >
      <van-button round type="primary" size="small" @click="router.replace('/')">
        回到首页
      </van-button>
    </EmptyState>

    <template v-else-if="post">
      <!-- 图片：有图轮播，无图给占位 -->
      <div class="detail-page__media">
        <div v-if="images.length" class="detail-page__gallery">
          <van-swipe
            ref="swipeRef"
            :autoplay="0"
            :show-indicators="false"
            :loop="hasMultiple"
            class="detail-page__swipe"
            @change="onSwipeChange"
          >
            <van-swipe-item v-for="(img, index) in images" :key="index">
              <img
                class="detail-page__img"
                :src="img"
                alt="帖子配图"
                @click="previewImage(index)"
              />
            </van-swipe-item>
          </van-swipe>

          <!-- 左右箭头：桌面端鼠标无法拖动 touch-only 的 Swipe，必须给可点的控件 -->
          <template v-if="hasMultiple">
            <button
              type="button"
              class="detail-page__arrow detail-page__arrow--prev"
              aria-label="上一张"
              @click.stop="goPrev"
            >
              <van-icon name="arrow-left" size="16" />
            </button>
            <button
              type="button"
              class="detail-page__arrow detail-page__arrow--next"
              aria-label="下一张"
              @click.stop="goNext"
            >
              <van-icon name="arrow" size="16" />
            </button>
          </template>

          <!-- 右下角计数，任何时候都能看出总共有几张 -->
          <div class="detail-page__counter">{{ activeIndex + 1 }} / {{ images.length }}</div>

          <!-- 自定义可点击圆点（Vant 默认指示器是纯 div，点不动） -->
          <div v-if="hasMultiple" class="detail-page__dots">
            <span
              v-for="(img, index) in images"
              :key="index"
              class="detail-page__dot"
              :class="{ 'is-active': index === activeIndex }"
              @click.stop="goTo(index)"
            />
          </div>
        </div>

        <div v-else class="detail-page__noimg">
          <van-icon name="photo-o" size="30" />
          <span>发布者没有上传图片</span>
        </div>
      </div>

      <section class="detail-page__main">
        <div class="detail-page__tags">
          <span
            class="detail-page__type"
            :style="{ backgroundColor: typeColor(post.type) }"
          >
            {{ typeLabel(post.type) }}
          </span>
          <van-tag :type="statusTagType(post.status)" plain>
            {{ statusLabel(post.status) }}
          </van-tag>
        </div>

        <h1 class="detail-page__title">{{ post.title }}</h1>

        <van-cell-group inset class="detail-page__cells">
          <van-cell title="分类" :value="categoryLabel(post.category)" />
          <van-cell title="地点" :value="post.location || '未填写'" />
          <van-cell title="发生时间" :value="formatTime(post.happened_at)" />
          <van-cell
            title="发布时间"
            :value="`${formatTime(post.created_at)}（${fromNow(post.created_at)}）`"
          />
        </van-cell-group>

        <div class="detail-page__desc">
          <h2>详细描述</h2>
          <!-- 用户输入一律用插值渲染，严禁 v-html -->
          <p>{{ post.description || '发布者没有填写描述' }}</p>
        </div>

        <!-- ===== 我的认领状态（07 §7 的四种互斥状态）===== -->
        <div v-if="myClaim" class="claim-state" :class="`claim-state--${myClaimStatus}`">
          <div class="claim-state__head">
            <span class="claim-state__title">我的认领</span>
            <van-tag :type="claimStatusTagType(myClaimStatus)" plain>
              {{ claimStatusLabel(myClaimStatus) }}
            </van-tag>
          </div>

          <!-- pending：把自己的证明回显出来，用户才知道「等的是哪一份」 -->
          <template v-if="myClaimStatus === 'pending'">
            <p class="claim-state__tip">
              已提交，等待对方审核。通过后这里会出现 6 位凭证码。
            </p>
            <span class="claim-state__label">我提交的证明</span>
            <p class="claim-state__proof">{{ myClaim.proof }}</p>
          </template>

          <!-- approved：凭证码卡片。这是 P6 的核心交付物，做成最醒目的一块 -->
          <template v-else-if="myClaimStatus === 'approved'">
            <div class="claim-state__voucher">
              <span class="claim-state__label">认领凭证码</span>
              <div class="claim-state__code-row">
                <span class="claim-state__code">{{ myVoucher }}</span>
                <van-button size="small" round plain type="primary" @click="copyVoucher">
                  复制
                </van-button>
              </div>
            </div>
            <p class="claim-state__tip">请凭此码与对方线下交接，由对方在「认领管理」中核销。</p>
          </template>

          <!-- redeemed：交接已完成
               （正常路径下帖子会同时变 closed，但列表页的旧缓存 DTO 可能还没跟上） -->
          <template v-else-if="myClaimStatus === 'redeemed'">
            <div class="claim-state__voucher">
              <span class="claim-state__label">认领凭证码</span>
              <div class="claim-state__code-row">
                <span class="claim-state__code claim-state__code--done">{{ myVoucher }}</span>
                <van-icon name="passed" class="claim-state__done-icon" />
              </div>
            </div>
            <p class="claim-state__tip">已完成交接，望物归原主。</p>
          </template>

          <!-- rejected：必须给出理由，否则用户不知道该怎么补证 -->
          <template v-else-if="myClaimStatus === 'rejected'">
            <p class="claim-state__tip claim-state__tip--reject">
              认领未通过{{ myRejectReason ? '' : '（对方没有填写理由）' }}
            </p>
            <template v-if="myRejectReason">
              <span class="claim-state__label">拒绝理由</span>
              <p class="claim-state__reason">{{ myRejectReason }}</p>
            </template>
          </template>

          <span class="claim-state__link" @click="goMyClaims">查看全部认领记录 ›</span>
        </div>

        <div class="detail-page__author">
          <h2>发布者</h2>
          <div class="detail-page__author-row">
            <div class="detail-page__avatar">
              <van-icon name="user-o" size="20" color="#969799" />
            </div>
            <div class="detail-page__author-info">
              <div class="detail-page__author-name">
                {{ post.author?.nickname || '匿名同学' }}
              </div>
              <div v-if="contactVisible" class="detail-page__contact">
                {{ contact }}
              </div>
              <div v-else class="detail-page__contact detail-page__contact--muted">
                联系方式需认领后可见
              </div>
            </div>
            <van-button
              v-if="contactVisible"
              size="small"
              round
              plain
              type="primary"
              @click="copyContact"
            >
              复制
            </van-button>
          </div>
        </div>

        <!-- 「可能有这些匹配」：自行拉取，无匹配时整块不渲染 -->
        <MatchList :post-id="post.id" />
      </section>

      <!-- 底部操作栏按身份渲染 -->
      <van-action-bar>
        <template v-if="isAuthor">
          <!-- 只有 found 帖会收到认领申请，lost 帖上不给这个入口 -->
          <van-action-bar-button
            v-if="isFound"
            type="success"
            text="认领管理"
            @click="goClaimManage"
          />
          <!-- closed 是终态，后端对它的 PUT 固定返回 1007（docs/api.md 5.4）。
               详情接口的 can_edit 只回答「是不是作者」，不含状态判断，
               所以这里必须自己排除 closed，否则用户会白填一屏再被拒。 -->
          <van-action-bar-button
            v-if="post.status !== 'closed'"
            type="primary"
            text="编辑"
            @click="goEdit"
          />
          <van-action-bar-button type="warning" text="改状态" @click="openStatusFlow" />
          <van-action-bar-button type="danger" text="删除" @click="onDelete" />
        </template>
        <template v-else-if="isGuest">
          <van-action-bar-button type="primary" text="登录后联系" @click="goLogin" />
        </template>
        <template v-else-if="myClaim">
          <!-- 已申请：按钮降级为状态提示，不再让用户重复点击（重复提交会拿 1008） -->
          <van-action-bar-button
            :type="myClaimStatus === 'approved' ? 'success' : 'primary'"
            :text="`认领${claimStatusLabel(myClaimStatus)}`"
            @click="goMyClaims"
          />
        </template>
        <template v-else-if="canClaim">
          <van-action-bar-button type="primary" text="这是我的" @click="openProof" />
        </template>
        <template v-else>
          <van-action-bar-button type="primary" text="暂不可认领" disabled />
        </template>
      </van-action-bar>

      <StatusActionSheet
        v-if="isAuthor"
        v-model:show="showStatusSheet"
        :post-id="post.id"
        :status="post.status"
        @success="onStatusSuccess"
      />

      <!-- 认领证明弹层（07 §7：textarea 10–500 字 + 字数统计） -->
      <van-popup v-model:show="showProof" position="bottom" round>
        <div class="proof-sheet">
          <h3 class="proof-sheet__title">提交认领申请</h3>
          <p class="proof-sheet__hint">
            请写出只有物主才知道的特征（例如刻字、划痕、卡号尾号），这将是对方审核的依据。
          </p>

          <van-field
            v-model="proofForm.proof"
            type="textarea"
            rows="4"
            maxlength="500"
            placeholder="例如：卡套背面有一张皮卡丘贴纸，学号尾号 0421"
            class="proof-sheet__field"
          />

          <!-- 刻意不用 van-field 自带的 show-word-limit：它只给「当前/上限」，
               而这里的下限（10 字）才是用户真正需要被提示的那一半 -->
          <p
            class="proof-sheet__counter"
            :class="{ 'is-invalid': proofForm.proof.length > 0 && !proofValid }"
          >
            {{ proofLength }} / 500 字<span v-if="proofTip"> · {{ proofTip }}</span>
          </p>

          <div class="proof-sheet__actions">
            <van-button
              block
              round
              type="primary"
              :loading="submitting"
              :disabled="!proofValid"
              @click="submitProof"
            >
              提交申请
            </van-button>
            <van-button block round plain :disabled="submitting" @click="showProof = false">
              取消
            </van-button>
          </div>
        </div>
      </van-popup>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  padding-bottom: 0;
}

.detail-page__loading {
  padding: 80px 0;
  text-align: center;
}

.detail-page__media {
  background: #fff;
}

.detail-page__gallery {
  position: relative;
}

.detail-page__swipe {
  height: 240px;
}

.detail-page__img {
  width: 100%;
  height: 240px;
  object-fit: cover;
  display: block;
  /* 桌面端用鼠标时给个手型，暗示可点开大图 */
  cursor: zoom-in;
}

/* 左右切换箭头 —— 桌面端唯一可行的切换方式（Vant Swipe 只认 touch） */
.detail-page__arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  /* 保证在图片之上 */
  z-index: 2;
}

.detail-page__arrow:hover {
  background: rgba(0, 0, 0, 0.55);
}

.detail-page__arrow--prev {
  left: 10px;
}

.detail-page__arrow--next {
  right: 10px;
}

/* 右下角「当前 / 总数」 */
.detail-page__counter {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 12px;
  line-height: 1.5;
  z-index: 2;
}

/* 自定义可点击圆点 */
.detail-page__dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  display: flex;
  justify-content: center;
  gap: 6px;
  z-index: 2;
}

.detail-page__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: width 0.2s, background 0.2s;
}

.detail-page__dot.is-active {
  width: 16px;
  border-radius: 4px;
  background: #1989fa;
}

.detail-page__noimg {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 140px;
  color: #c8c9cc;
  font-size: 13px;
}

.detail-page__main {
  /* 底部留出固定操作栏的高度，否则最后一张卡片会被操作栏压住 */
  padding: 14px 12px calc(66px + env(safe-area-inset-bottom));
}

.detail-page__tags {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-page__type {
  padding: 2px 8px;
  color: #fff;
  font-size: 12px;
  line-height: 18px;
  border-radius: 4px;
}

.detail-page__title {
  margin: 10px 0 14px;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.4;
  color: #323233;
}

.detail-page__cells {
  margin: 0 0 4px;
}

.detail-page__desc,
.detail-page__author {
  margin-top: 16px;
  padding: 14px;
  background: #fff;
  border-radius: 8px;
}

.detail-page__desc h2,
.detail-page__author h2 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}

.detail-page__desc p {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: #646566;
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-page__author-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-page__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #f2f3f5;
  flex: 0 0 38px;
}

.detail-page__author-info {
  flex: 1;
  min-width: 0;
}

.detail-page__author-name {
  font-size: 14px;
  font-weight: 500;
  color: #323233;
}

.detail-page__contact {
  margin-top: 2px;
  font-size: 12px;
  color: #1989fa;
  word-break: break-all;
}

.detail-page__contact--muted {
  color: #969799;
}

/* ===== 我的认领状态卡片 ===== */
.claim-state {
  margin-top: 16px;
  padding: 14px;
  background: #fff;
  border-radius: 8px;
  border-left: 3px solid #1989fa;
}

.claim-state--approved {
  border-left-color: #07c160;
}

.claim-state--rejected {
  border-left-color: #ee0a24;
}

.claim-state--redeemed {
  border-left-color: #c8c9cc;
}

.claim-state__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.claim-state__title {
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}

.claim-state__tip {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: #646566;
}

.claim-state__tip--reject {
  color: #ee0a24;
}

.claim-state__label {
  display: block;
  margin-top: 10px;
  font-size: 12px;
  color: #969799;
}

.claim-state__proof,
.claim-state__reason {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: #646566;
  white-space: pre-wrap;
  word-break: break-word;
}

.claim-state__reason {
  color: #ee0a24;
}

.claim-state__voucher {
  margin-top: 12px;
  padding: 12px;
  background: linear-gradient(135deg, #e8fff3, #f7f8fa);
  border: 1px dashed #07c160;
  border-radius: 8px;
}

.claim-state__voucher .claim-state__label {
  margin-top: 0;
}

.claim-state__code-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
}

/* 凭证码是要念给对方 / 手抄的，等宽 + 大字距能显著降低听写错误 */
.claim-state__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 5px;
  color: #07c160;
}

.claim-state__code--done {
  color: #969799;
  text-decoration: line-through;
}

.claim-state__done-icon {
  font-size: 28px;
  color: #07c160;
}

.claim-state__link {
  display: inline-block;
  margin-top: 12px;
  font-size: 13px;
  color: #1989fa;
  cursor: pointer;
}

/* ===== 认领证明弹层 ===== */
.proof-sheet {
  padding: 20px 0 24px;
}

.proof-sheet__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  color: #323233;
}

.proof-sheet__hint {
  margin: 10px 16px 14px;
  font-size: 12px;
  line-height: 1.6;
  color: #969799;
}

.proof-sheet__field {
  /* van-field 自带 padding，这里只保证 textarea 的最小高度可读 */
  min-height: 96px;
}

.proof-sheet__counter {
  margin: 8px 16px 0;
  font-size: 12px;
  color: #969799;
  text-align: right;
}

.proof-sheet__counter.is-invalid {
  color: #ee0a24;
}

.proof-sheet__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 18px 16px 0;
}
</style>
