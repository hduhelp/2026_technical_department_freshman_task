<script setup>
import { ref } from 'vue'
import { campuses, contactLabels, eventTime } from '../domain'
import Modal from './Modal.vue'
defineProps({post:Object,images:{type:Array,default:()=>[]}})
const preview=ref(null),copied=ref('')
async function copy(value){try{await navigator.clipboard.writeText(value);copied.value='已复制'}catch{copied.value='复制失败，请选中文字手动复制'}}
</script>
<template><div class="content-photos" v-if="images.length"><button class="main-photo" @click="preview=images[0]"><img :src="images[0]" :alt="post.item_name"></button><div class="thumbs"><button v-for="(url,i) in images" @click="preview=url" :aria-label="'查看照片 '+(i+1)"><img :src="url" alt=""></button></div></div><div v-else class="detail-no-photo">此帖子未上传照片</div><dl class="facts"><dt>校区</dt><dd>{{campuses[post.campus]}}</dd><dt>{{post.post_type==='found'?'拾获地点':'丢失地点'}}</dt><dd>{{post.location}}</dd><dt>{{post.post_type==='found'?'拾获时间':'丢失时间'}}</dt><dd>{{eventTime(post)}}</dd></dl><h3>物品描述</h3><p class="preserve">{{post.description}}</p><section class="contact-box"><h3>联系方式</h3><div v-for="c in post.contact_methods" class="row between"><span>{{contactLabels[c.type]}}　<span class="selectable">{{c.value}}</span></span><button class="text-button" @click="copy(c.value)">复制</button></div><p v-if="copied" role="status" class="fine">{{copied}}</p><small>请核实物品归属，通过以上方式与发布人联系。</small></section><Modal v-if="preview" title="查看照片" @close="preview=null"><img class="preview-image" :src="preview" :alt="post.item_name"><div class="thumbs"><button v-for="url in images" @click="preview=url"><img :src="url" alt="切换照片"></button></div></Modal></template>
