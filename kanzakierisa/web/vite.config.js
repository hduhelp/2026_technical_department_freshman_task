import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 监听 0.0.0.0：手机连同一个 Wi-Fi 时可以用 http://<电脑IP>:5173 直接打开，
    // 这是「移动端优先」这条产品定位在开发期的必要开关（默认只听 localhost 就打不开）。
    host: true,
    proxy: {
      // 开发期把后端接口与静态上传目录都代理到 Go 服务，避免跨域。
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  // ⚠️ preview 有自己独立的 proxy 配置，**不会**继承上面的 server.proxy。
  // 不显式写一遍的话，`npm run preview` 打开的是构建产物，但它发出的 /api 请求
  // 会打到 preview 服务器自己身上并 404 —— 页面能开、数据全是空的。
  // P5 验收要求「npm run preview 也能正常用」，所以这里复刻一份。
  preview: {
    port: 4173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
