<script setup>
/**
 * 帖子卡片。列表页与「我的帖子」共用。
 *
 * 只负责展示，不发起任何请求；点击整卡跳详情。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import {
  categoryLabel,
  fromNow,
  statusLabel,
  statusTagType,
  typeColor,
  typeLabel,
} from '@/utils/format'

const props = defineProps({
  post: { type: Object, required: true },
})

const router = useRouter()

// 首图作为缩略图；images 可能为 null（历史数据），这里统一兜底成空数组
const cover = computed(() => {
  const images = props.post.images
  return Array.isArray(images) && images.length > 0 ? images[0] : ''
})

// 已结束的帖子做整体降饱和，让「还在寻找中」的帖子在列表里更跳
const isClosed = computed(() => props.post.status === 'closed')

function goDetail() {
  router.push(`/posts/${props.post.id}`)
}
</script>

<template>
  <article class="post-card" :class="{ 'is-closed': isClosed }" @click="goDetail">
    <div class="post-card__body">
      <div class="post-card__top">
        <span class="post-card__type" :style="{ backgroundColor: typeColor(post.type) }">
          {{ typeLabel(post.type) }}
        </span>
        <van-tag :type="statusTagType(post.status)" plain>
          {{ statusLabel(post.status) }}
        </van-tag>
      </div>

      <h3 class="post-card__title">{{ post.title }}</h3>

      <div class="post-card__meta">
        <span class="post-card__chip">{{ categoryLabel(post.category) }}</span>
        <span v-if="post.location" class="post-card__chip">{{ post.location }}</span>
      </div>

      <div class="post-card__foot">
        <span>{{ post.author?.nickname || '匿名同学' }}</span>
        <span>{{ fromNow(post.happened_at) }}</span>
      </div>
    </div>

    <div v-if="cover" class="post-card__cover">
      <img :src="cover" alt="帖子配图" loading="lazy" />
    </div>
  </article>
</template>

<style scoped>
.post-card {
  display: flex;
  gap: 12px;
  padding: 12px;
  margin-bottom: 10px;
  background: #fff;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.post-card:active {
  transform: scale(0.985);
}

.post-card.is-closed .post-card__title {
  color: #969799;
}

.post-card__body {
  flex: 1;
  min-width: 0;
}

.post-card__top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.post-card__type {
  padding: 1px 6px;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  border-radius: 3px;
}

.post-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  color: #323233;
  /* 最多 2 行省略，防止长标题把卡片撑高破坏列表节奏 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.post-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.post-card__chip {
  max-width: 100%;
  padding: 1px 6px;
  color: #646566;
  font-size: 11px;
  line-height: 16px;
  background: #f7f8fa;
  border-radius: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-card__foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  color: #969799;
  font-size: 12px;
}

.post-card__cover {
  flex: 0 0 76px;
  width: 76px;
  height: 76px;
  overflow: hidden;
  border-radius: 6px;
  background: #f7f8fa;
}

.post-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
