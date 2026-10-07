// server-only 的测试替身（见 vitest.config.ts 里的别名说明）。
// 测试跑在 Node 里，这里不需要「禁止被打进客户端包」那道构建期防护；
// 换成空实现后，用例就能直接 import 服务端模块（例如 lib/db/prune-drafts.ts）。
export {}
