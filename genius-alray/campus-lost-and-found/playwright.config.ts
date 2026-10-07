import { defineConfig, devices } from "@playwright/test"
import { config } from "dotenv"

config({ path: ".env.local", quiet: true })
config({ path: ".env", quiet: true })

// E2E 只验证应用逻辑与安全边界，必须用确定性、零网络的 mock；
// .env.local 里配的真实模型（AI_PROVIDER=ai-sdk）会让 E2E 变得不确定并产生外部调用。
// 这里显式展开 process.env（不依赖 Playwright 的合并语义）再覆盖 AI_PROVIDER。
const webServerEnv: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === "string") webServerEnv[key] = value
}
webServerEnv.AI_PROVIDER = "mock"
// mock 的确定性延时：让「加载态」这种转瞬即逝的中间状态可被稳定断言
// （否则 mock 是瞬时的，永远看不到骨架屏/全屏加载，两套输入框那类 bug 就测不出来）
webServerEnv.MOCK_AI_DELAY_MS = "500"

export default defineConfig({
  testDir: "./tests/e2e",
  // 本地 Supabase 是共享状态，串行避免互相污染
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  // 移动端优先：主验收视口
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: {
    // 跑**构建产物**（next build && next start），不再跑 dev server：
    // - 测的就是真正会发布的东西：生产 bundle、生产 CSP、没有 dev 专属分支与浮层；
    // - 省掉 dev 的按路由即时编译，页面切换明显更快；
    // - 构建实测 ~9s（next/font 已缓存），比每条用例的 SSR 开销便宜得多。
    //
    // 注意：生产构建会注册 Service Worker，缓存行为因此也进了 E2E 覆盖面。
    // 09/12 里「人为拖慢图片请求」用的是跨域签名 URL，SW 不接管，拦截仍然有效。
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    // 必须是 false。设成 true 时，若 3000 端口上已有一个**更早启动的** server，
    // Playwright 会直接复用它 —— 那个进程可能是 dev server、也可能读的是 .env.local
    // 里的真实模型配置，于是 E2E 静默地在测别的东西（曾经表现为「模型需要更多角度」
    // 全部超时，一次跑 8 分钟还 4 个失败，却看不出任何环境错误）。
    // 另外跑构建产物时，「复用的那个产物是不是当前源码构建的」也无从验证。
    // 宁可让端口冲突直接报错，也不要复用来源不明的 server。
    reuseExistingServer: false,
    timeout: 300_000,
    env: webServerEnv,
  },
})
