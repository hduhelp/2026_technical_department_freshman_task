<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { session, restoreSession, logout } from './api'
import Login from './pages/Login.vue'
import Home from './pages/Home.vue'
import PostForm from './pages/PostForm.vue'
import PostDetail from './pages/PostDetail.vue'
import Mine from './pages/Mine.vue'
import Account from './pages/Account.vue'
import Admin from './pages/Admin.vue'
const admin = location.pathname.startsWith('/admin')
const route = ref(location.hash.slice(1) || (admin ? 'reviews' : 'home'))
function focusMain(){ document.getElementById('main')?.focus() }
function navigate() { route.value = location.hash.slice(1) || (admin ? 'reviews' : 'home'); window.scrollTo(0, 0) }
async function exit() { try { await logout() } catch(e) { session.notice = e.message } }
onMounted(() => { restoreSession(); window.addEventListener('hashchange', navigate) })
onUnmounted(() => window.removeEventListener('hashchange', navigate))
const menu = { reviews:'帖子审核', reports:'举报处理', posts:'帖子管理', users:'账号管理', logs:'操作记录' }
</script>
<template>
  <a class="skip" href="#main" @click.prevent="focusMain">跳到主要内容</a>
  <div v-if="session.checking" class="empty">正在检查登录状态…</div>
  <Account v-else-if="session.forced" forced />
  <Login v-else-if="!session.user" :admin="admin" />
  <div v-else-if="admin && session.user.role !== 'admin'" class="empty"><h1>此账号没有管理权限</h1><a href="/">返回用户端</a><button @click="exit">退出登录</button></div>
  <div v-else :class="{ 'admin-layout': admin }">
    <aside v-if="admin" class="sidebar"><a href="/admin" class="brand">杭电失物招领<small>管理端</small></a><nav><a v-for="(label,key) in menu" :key="key" :href="'#'+key" :class="{active:route.split('/')[0]===key}">{{ label }}</a></nav><div class="sidebar-foot"><a href="#account">{{ session.user.nickname }} · 账号设置</a><button class="text-button" @click="exit">退出登录</button></div></aside>
    <header v-else class="topbar"><a class="brand" href="#home">杭电失物招领</a><nav><a href="#home" :class="{active:route==='home'}">首页</a><a href="#publish" :class="{active:route==='publish'}">发布</a><a href="#mine" :class="{active:route.startsWith('mine')||route==='account'}">我的</a></nav><a href="#account" class="avatar-name"><span class="avatar">{{ session.user.nickname?.slice(0,1) }}</span>{{ session.user.nickname }}</a></header>
    <main id="main" tabindex="-1" :class="admin?'admin-main':'container'">
      <p v-if="session.notice" role="status" class="notice">{{ session.notice }} <button class="text-button" @click="session.notice=''">关闭</button></p>
      <Account v-if="route==='account'" />
      <Admin v-else-if="admin" :key="route" :route="route" />
      <Home v-else-if="route==='home'" />
      <PostForm v-else-if="route==='publish'||route.startsWith('edit/')" :key="route" :id="route.split('/')[1]" />
      <PostDetail v-else-if="route.startsWith('post/')" :key="route" :id="route.split('/')[1]" />
      <Mine v-else-if="route.startsWith('mine')" :key="route" :tab="route.split('/')[1]||'posts'" />
      <div v-else class="empty"><h1>页面不存在</h1><a href="#home">返回首页</a></div>
    </main>
    <footer v-if="!admin" class="footer">让遗失的物品，回到熟悉的人身边。<span>杭州电子科技大学 · 校园失物招领</span></footer>
  </div>
</template>
