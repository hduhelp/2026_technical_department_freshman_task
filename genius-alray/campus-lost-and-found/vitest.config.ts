import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // server-only 在普通 Node 环境下 import 就会抛错（它防的是「被误打进
      // 客户端包」）。用例要直接验证服务端模块（如草稿回收）的行为，
      // 所以换成 tests/stubs/server-only.ts 这个空实现。
      "server-only": fileURLToPath(
        new URL("tests/stubs/server-only.ts", import.meta.url)
      ),
    },
  },
  test: {
    // 默认 node 环境；需要 DOM 的用例在文件顶部标注
    // // @vitest-environment jsdom
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // 直连本地 Supabase 的用例较慢
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
