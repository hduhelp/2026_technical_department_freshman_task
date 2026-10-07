import { config } from "dotenv"

// 离线测试默认强制使用确定性、零网络的 mock：
// .env.local 里可能配的是真实模型（AI_PROVIDER=ai-sdk），若不覆盖，
// 单元/RLS/E2E 会去打真实 API —— 既不确定又要花钱。
// 用 ??= 而不是直接赋值：显式指定时（例如 AI_PROVIDER=ai-sdk pnpm test:live）仍然生效；
// 且 dotenv 默认不覆盖已存在的变量，所以这里设的值不会被 .env.local 顶掉。
process.env.AI_PROVIDER ??= "mock"

// 本地开发/测试凭据（.env.local 已被 .gitignore 忽略）
config({ path: ".env.local", quiet: true })
config({ path: ".env", quiet: true })

import "@testing-library/jest-dom/vitest"
