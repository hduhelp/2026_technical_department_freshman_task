<script setup>
import { ref, reactive, onMounted } from 'vue'
import { request, query } from '../api'
import { campuses } from '../domain'
import PostCard from '../components/PostCard.vue'
import State from '../components/State.vue'
import Pagination from '../components/Pagination.vue'
const filters=reactive({post_type:'',keyword:'',campus:'',event_date_from:'',event_date_to:'',resolution_status:'active'})
const records=ref([]),page=ref(1),total=ref(0),loading=ref(true),error=ref('')
let generation=0
async function load(p=1){ const current=++generation; page.value=p;loading.value=true;error.value='';try{const data=await request('/posts?'+query({...filters,page:p,page_size:12}));if(current!==generation)return;records.value=data.records;total.value=data.total}catch(e){if(current===generation)error.value=e.message}finally{if(current===generation)loading.value=false}}
function reset(){Object.assign(filters,{post_type:'',keyword:'',campus:'',event_date_from:'',event_date_to:'',resolution_status:'active'});load()}
onMounted(()=>load())
</script>
<template><header class="hero"><div><span class="eyebrow">校园里的小事，值得被认真对待</span><h1>你在寻找的，<br>也许就在这里。</h1><p>发现失物线索，让拾到的物品找到主人。</p></div><a href="#publish" class="primary">＋ 发布信息</a></header><section class="panel search-panel"><form class="search-row" @submit.prevent="load()"><input v-model="filters.keyword" aria-label="搜索物品、地点或描述" placeholder="搜索物品名称、地点或描述"><button class="primary">搜索</button></form><div class="filter-row"><div class="segmented" aria-label="帖子类型"><button v-for="(label,value) in {'':'全部',lost:'寻物',found:'拾物'}" :class="{selected:filters.post_type===value}" @click="filters.post_type=value;load()">{{label}}</button></div><label class="inline-label">校区<select v-model="filters.campus" @change="load()"><option value="">全部校区</option><option v-for="(name,key) in campuses" :value="key">{{name}}</option></select></label><label class="inline-label">状态<select v-model="filters.resolution_status" @change="load()"><option value="active">进行中</option><option value="completed">已完成</option><option value="all">全部</option></select></label><details class="date-filter"><summary>日期范围</summary><div class="row"><label>开始日期<input v-model="filters.event_date_from" type="date"></label><label>结束日期<input v-model="filters.event_date_to" type="date"></label><button class="secondary" @click="load()">应用</button></div></details><button class="text-button" @click="reset">重置</button></div></section><div class="section-title"><h2>{{filters.keyword?'搜索结果':'最新信息'}}</h2><span class="muted">按首次发布时间排列</span></div><State :loading="loading" :error="error" :empty="!records.length" @retry="load(page)"/><div v-if="!loading&&!error" class="post-grid"><PostCard v-for="post in records" :key="post.id" :post="post"/></div><Pagination v-if="!loading&&!error&&total" :page="page" :total="total" @change="load"/></template>
