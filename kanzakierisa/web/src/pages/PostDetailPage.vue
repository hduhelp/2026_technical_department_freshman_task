<script setup>
/**
 * 帖子详情页。
 *
 * 这一页承担了 SPEC 7.2「联系方式三级可见性」的前端落点：
 * 后端已经**在 SQL 层**决定好 contact 是否返回，前端只需按 `contact_visible`
 * 渲染两种完全不同的 CTA，绝不做二次判断。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showSuccessToast, showToast } from 'vant'

import * as postApi from '@/api/post'
import EmptyState from '@/components/EmptyState.vue'
import StatusActionSheet from '@/components/StatusActionSheet.vue'
import { useUserStore } from '@/store/user'
import {
  categoryLabel,
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

const isAuthor = computed(() => post.value?.can_edit === true)
const isGuest = computed(() => !userStore.isLogin)
const canClaim = computed(() => post.value?.can_claim === true)
const contactVisible = computed(() => post.value?.author?.contact_visible === true)
const contact = computed(() => post.value?.author?.contact || '')

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

onMounted(load)

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

function onClaim() {
  showToast('认领功能即将开放，敬请期待')
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
        <van-swipe
          v-if="images.length"
          :autoplay="0"
          indicator-color="#1989fa"
          class="detail-page__swipe"
        >
          <van-swipe-item v-for="(img, index) in images" :key="index">
            <img class="detail-page__img" :src="img" alt="帖子配图" />
          </van-swipe-item>
        </van-swipe>
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
      </section>

      <!-- 底部操作栏按身份渲染 -->
      <van-action-bar>
        <template v-if="isAuthor">
          <van-action-bar-button type="primary" text="编辑" @click="goEdit" />
          <van-action-bar-button type="warning" text="改状态" @click="openStatusFlow" />
          <van-action-bar-button type="danger" text="删除" @click="onDelete" />
        </template>
        <template v-else-if="isGuest">
          <van-action-bar-button type="primary" text="登录后联系" @click="goLogin" />
        </template>
        <template v-else-if="canClaim">
          <van-action-bar-button type="primary" text="这是我的" @click="onClaim" />
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

.detail-page__swipe {
  height: 240px;
}

.detail-page__img {
  width: 100%;
  height: 240px;
  object-fit: cover;
  display: block;
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
</style>
