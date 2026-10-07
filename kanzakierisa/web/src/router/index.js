/**
 * 路由表与全局前置守卫。
 *
 * 页面组件一律用「动态 import」懒加载，有三个好处：
 * 1. 首屏只加载当前页面的 chunk，移动端网络下体验更好；
 * 2. 打断 `request.js → router → 页面 → api → request.js` 的静态循环依赖，
 *    避免模块初始化阶段的 TDZ 报错；
 * 3. 构建产物按页面自动分包。
 */
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/',
    name: 'post-list',
    component: () => import('@/pages/PostListPage.vue'),
    // tabbar: true 表示该页面显示底部 TabBar（App.vue 读这个标记）
    meta: { title: '校园失物招领', tabbar: true },
  },
  {
    path: '/posts/:id',
    name: 'post-detail',
    component: () => import('@/pages/PostDetailPage.vue'),
    // 二级页面隐藏 TabBar；发布 / 编辑 / 认领管理同理
    meta: { title: '帖子详情', hideTabbar: true },
  },
  {
    path: '/publish',
    name: 'post-create',
    component: () => import('@/pages/PostCreatePage.vue'),
    meta: { title: '发布', requiresAuth: true, hideTabbar: true },
  },
  {
    path: '/posts/:id/edit',
    name: 'post-edit',
    component: () => import('@/pages/PostEditPage.vue'),
    meta: { title: '编辑帖子', requiresAuth: true, hideTabbar: true },
  },
  {
    path: '/me',
    name: 'me',
    component: () => import('@/pages/MePage.vue'),
    meta: { title: '我的', requiresAuth: true, tabbar: true },
  },
  {
    path: '/me/claims',
    name: 'my-claims',
    component: () => import('@/pages/MyClaimsPage.vue'),
    meta: { title: '我的认领', requiresAuth: true, hideTabbar: true },
  },
  {
    path: '/claims/manage',
    name: 'claim-manage',
    component: () => import('@/pages/ClaimManagePage.vue'),
    meta: { title: '认领管理', requiresAuth: true, hideTabbar: true },
  },
  // 兜底：未知路径回首页，避免白屏
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  // 前进到新页面时回到顶部，否则从长列表点进详情会停在页面中部
  scrollBehavior: () => ({ top: 0 }),
})

/**
 * 全局前置守卫：仅拦截 `meta.requiresAuth` 的页面。
 *
 * 这里直接读 localStorage 而不是读 Pinia，是为了让守卫不依赖 store 的初始化时机
 * （守卫可能早于 Pinia 安装执行）。
 */
router.beforeEach((to) => {
  if (to.meta.requiresAuth && !localStorage.getItem('token')) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
})

export default router
