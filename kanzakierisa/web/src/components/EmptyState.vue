<script setup>
/**
 * 空状态。文案由调用方传入，目的是让「一条帖子都没有」和
 * 「筛选/搜索之后没命中」这两种场景给出不同引导。
 */
defineProps({
  description: { type: String, default: '暂无数据' },
  image: { type: String, default: 'search' },
})
</script>

<template>
  <van-empty :image="image" :description="description">
    <slot />
  </van-empty>
</template>
