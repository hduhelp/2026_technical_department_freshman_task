<script setup>
import { imageURL } from '../api'
import { campuses, resolution, eventTime, reviewLabels } from '../domain'
defineProps({ post: Object, own: Boolean })
</script>
<template><a :href="'#post/' + post.id" class="post-card"><div class="cover"><img v-if="post.cover_url" :src="imageURL(post.cover_url,'cover')" :alt="post.item_name" loading="lazy"><span v-else class="no-photo">无图片</span></div><div class="card-body"><div class="row between"><span class="badge blue">{{ post.post_type === 'lost' ? '寻物' : '拾物' }}</span><span class="badge" :class="post.resolution_status">{{ resolution(post) }}</span></div><h3>{{ post.item_name }}</h3><p>⌂ &nbsp;{{ campuses[post.campus] }}</p><p>⌖ &nbsp;{{ post.location }}</p><p>◷ &nbsp;{{ eventTime(post) }}</p><span v-if="own" class="badge" :class="post.review_status">{{ reviewLabels[post.review_status] }}</span></div></a></template>
