<script setup>
/**
 * 「可能有这些匹配」区块（07 第二部分 §4）。
 *
 * 三个刻意的取舍：
 *
 * 1. **区块自己拉数据**。匹配结果与帖子详情是两个独立接口，放在 PostDetailPage
 *    里会让那一页同时管两条互不相干的数据流；这里自包含，父页面只管传 postId。
 *
 * 2. **无匹配时整块不渲染**（07 §4 明确要求）。不是渲染一个空盒子，而是
 *    `v-if="list.length"` 直接摘掉 —— 一个「暂无匹配」的空卡片在详情页里
 *    只会占地方、还让人以为哪里坏了。因此加载中也不渲染，避免出现
 *    「先闪一个空块、再被填满」的抖动。
 *
 * 3. **失败静默**。匹配是锦上添花的信息，接口挂了不该在详情页弹 Toast
 *    干扰「查看/认领」这条主流程。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import * as claimApi from '@/api/claim'
import { fromNow, typeColor, typeLabel } from '@/utils/format'

const props = defineProps({
  postId: { type: [Number, String], required: true },
})

const router = useRouter()
const list = ref([])

onMounted(async () => {
  try {
    // 软鉴权接口：游客也能拿到，只是 contact 不外露
    const data = await claimApi.matches(props.postId)
    list.value = data?.list || []
  } catch {
    list.value = []
  }
})

function goDetail(item) {
  const id = item?.post?.id
  if (id && String(id) !== String(props.postId)) router.push(`/posts/${id}`)
}
</script>

<template>
  <section v-if="list.length" class="match-list">
    <h2 class="match-list__title">
      <van-icon name="fire-o" class="match-list__title-icon" />
      可能有这些匹配
      <span class="match-list__hint">按分类 / 地点 / 时间 / 标题自动比对</span>
    </h2>

    <div
      v-for="item in list"
      :key="item.post.id"
      class="match-item"
      @click="goDetail(item)"
    >
      <div class="match-item__head">
        <span
          class="match-item__type"
          :style="{ backgroundColor: typeColor(item.post.type) }"
        >
          {{ typeLabel(item.post.type) }}
        </span>
        <span class="match-item__score">{{ item.score }} 分</span>
      </div>

      <h3 class="match-item__title">{{ item.post.title }}</h3>

      <div class="match-item__meta">
        <span>{{ item.post.location || '未填写地点' }}</span>
        <span>{{ fromNow(item.post.happened_at) }}</span>
      </div>

      <!-- reasons 由后端给出（「分类相同」「地点相近」…），前端只负责排版 -->
      <div class="match-item__reasons">
        <van-tag
          v-for="(reason, index) in item.reasons"
          :key="index"
          type="primary"
          plain
          size="medium"
        >
          {{ reason }}
        </van-tag>
      </div>
    </div>
  </section>
</template>

<style scoped>
.match-list {
  margin-top: 16px;
  padding: 14px;
  background: #fff;
  border-radius: 8px;
}

.match-list__title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: #323233;
}

.match-list__title-icon {
  color: #ff976a;
  font-size: 16px;
}

.match-list__hint {
  flex: 1;
  font-size: 11px;
  font-weight: 400;
  color: #c8c9cc;
  text-align: right;
}

.match-item {
  padding: 10px 0;
  border-top: 1px solid #f2f3f5;
  cursor: pointer;
}

.match-item:first-of-type {
  border-top: 0;
  padding-top: 0;
}

.match-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.match-item__type {
  padding: 1px 6px;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  border-radius: 3px;
}

.match-item__score {
  font-size: 12px;
  font-weight: 600;
  color: #ee0a24;
}

.match-item__title {
  margin: 6px 0 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  color: #323233;
}

.match-item__meta {
  display: flex;
  gap: 10px;
  margin-top: 3px;
  font-size: 12px;
  color: #969799;
}

.match-item__reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
</style>
