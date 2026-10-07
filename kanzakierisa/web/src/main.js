/**
 * 应用入口：依次安装 Pinia → Router → Vant，再挂载根组件。
 *
 * Pinia 必须在 Router 之前安装 —— 守卫与页面组件都可能在首次导航时就用到 store。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Vant from 'vant'

// ⚠️ 这一行不能少，少了 Vant 组件会渲染成裸 HTML（SPEC 05 常见坑 1）
import 'vant/lib/index.css'

import App from './App.vue'
import router from './router'
import './styles/global.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(Vant)

app.mount('#app')
