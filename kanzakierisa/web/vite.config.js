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
})
