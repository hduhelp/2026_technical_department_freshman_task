# 校园失物招领

手机端优先的校园失物招领站：拍照发布拾到的物品、在公开失物墙上浏览、认领时留下联系方式。
匿名可看失物墙，发布与认领需要登录（手机号 + 密码 + 人机校验）。

技术栈：Next.js 16（App Router / Server Actions）、React 19、TypeScript、Supabase（Postgres / Auth / Storage）、
Tailwind CSS 4、Base UI（shadcn 组件，style `base-maia`）。AI 只用来读照片：识别物品名称与描述，
并给出「通过 / 建议补拍」建议，经 Vercel AI SDK 以 OpenAI 兼容协议接入。
PWA：可添加到主屏幕，带离线页。

## 本地跑起来

前置：Node 22（`package.json` 的 `engines` 已钉住）、pnpm、可用的容器运行时（本机是 rootless podman）；
Supabase CLI 已是项目 devDependency。

```bash
pnpm install
pnpm db:start     # 起本地 Supabase（已排除 vector 等用不到的容器）
pnpm db:env       # 从 supabase status 生成 .env.local
pnpm db:reset     # 重放 supabase/migrations 下的迁移
pnpm dev          # http://localhost:3000
```

`pnpm db:env` 会写 `.env.local`（已被忽略，模板见 `.env.example`）。
AI 默认 `AI_PROVIDER=mock`，不联网也能走完发布与浏览。
人机校验默认关闭（`NEXT_PUBLIC_TURNSTILE_SITE_KEY` 为空）—— 本地与自动化测试都不依赖外网。

账号：注册填真实姓名 + 手机号 + 密码；内部把手机号映射成
`<手机号>@$NEXT_PUBLIC_AUTH_EMAIL_DOMAIN` 的内部邮箱，不发短信验证码（见 `lib/env.ts` 的 `phoneToEmail`）。

## 常用脚本

| 命令                                               | 作用                                           |
| -------------------------------------------------- | ---------------------------------------------- |
| `pnpm dev`                                         | 开发服务器（:3000）                            |
| `pnpm build` / `pnpm start`                        | 生产构建 / 启动；构建会一并类型检查 `tests/**` |
| `pnpm typecheck` / `pnpm lint`                     | 静态检查                                       |
| `pnpm test`                                        | typecheck + lint + 单元与组件测试              |
| `pnpm test:rls`                                    | 安全矩阵（列级保密、RPC 边界、限流、草稿回收） |
| `pnpm test:e2e`                                    | Playwright（Pixel 7，强制 `AI_PROVIDER=mock`） |
| `pnpm verify`                                      | 以上除 live 之外的全部                         |
| `pnpm test:live`                                   | 真实模型视觉识别，需要网络与 key               |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:reset` | 本地 Supabase 生命周期                         |
| `pnpm db:env`                                      | 由本地 Supabase 生成 `.env.local`              |
| `pnpm db:types`                                    | 由本地库生成 `lib/database.types.ts`           |
| `pnpm db:status` / `pnpm db:check`                 | 查看状态 / 探测数据库连通性                    |
| `pnpm db:prune-drafts`                             | 回收被放弃的发布草稿（登记行 + 存储对象）；默认 dry-run，`--apply` 才删；线上由 Vercel Cron 每天自动跑 |

测试前置：`pnpm db:start && pnpm db:env && pnpm db:reset`。
E2E 要求 3000 端口空闲——配置里是 `reuseExistingServer: false`，宁可端口冲突报错，也不复用来源不明的 dev server。

## 环境变量

变量名与默认值以 `lib/env.ts` 为准，模板见 `.env.example`。除了 Supabase 三件套，还有几个容易被忽略的：

| 变量 | 作用 |
| --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile 的 **sitekey**（公开值）。留空 = 不渲染人机校验；**线上留空等于注册无门槛** |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` / `AI_BASE_URL` | 接真实模型时必填；`AI_BASE_URL` 留空回落到 `https://api.deepseek.com/v1` |
| `CRON_SECRET` | Vercel Cron 调 `/api/cron/prune-drafts` 的共享密钥；留空则该接口一律 401 |
| `ALLOW_MOCK_AI=1` | 只在「生产环境确实要用 mock AI」时设：不设的话生产部署会被构建拦住 |

## 部署到 Vercel + Supabase

### 1. Supabase（只有一个生产项目）

```bash
supabase login                                   # 或 export SUPABASE_ACCESS_TOKEN=...
supabase link --project-ref <project-ref>
supabase db push                                 # 重放 supabase/migrations 下的全部迁移
supabase gen types typescript --project-ref <ref> --schema public > lib/database.types.ts
```

`db push` 会一并建好私有桶 `item-images`、写入 `app_config` 默认阈值、装好全部 RPC 与列级 REVOKE。

> **权限必须显式 GRANT**：云端的新项目不再自动给 `anon` / `authenticated` / `service_role` 授权
> （本地 `config.toml` 的 `auto_expose_new_tables` 也已设成 `false` 与云端对齐）。所有权限都写在
> `supabase/migrations/` 里，`20261007130000_explicit_grants.sql` 补的是 `service_role` 的整表权限 ——
> 少了它，线上表现是上传图片报 `permission denied for table image_uploads`（42501），而本地全绿。
**控制台里必须手动设置的项**（`supabase/config.toml` 只作用于本地，`db push` 不会带上云）：

| 位置                                                    | 设置                                                     | 为什么                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Authentication → Sign In / Providers → Email            | **关掉 Confirm email**                                   | 账号是「手机号派生的内部邮箱」，`@campus.local` 收不到确认信；开着的话注册拿不到 session，用户永远登不进去 |
| Authentication → Bot and Abuse Protection               | 开 CAPTCHA protection，provider = Turnstile，填 **secret** | 注册没有其他门槛；sitekey 填到 Vercel 的 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`                      |
| Authentication → URL Configuration                      | Site URL / Redirect URLs 填线上域名                       | 邮件模板与跳转用                                                                             |
| Project Settings → API                                  | 取 URL / anon key / service_role key                      | 填到 Vercel 环境变量                                                                         |

### 2. Vercel

Root Directory 选 `genius-alray/campus-lost-and-found`，环境变量（**Production 作用域**）：

| 变量 | 说明 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **必须对构建环境可见**：CSP 的 `connect-src` / `img-src` 在构建时由它算出来，缺了会「构建成功但浏览器端全被拦」 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端专用，**不要**加 `NEXT_PUBLIC_` 前缀 |
| `NEXT_PUBLIC_AUTH_EMAIL_DOMAIN` | 与 Supabase 那边一致 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare 的 sitekey（公开值） |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` | 接真模型；**生产留空会让构建失败**（默认 mock 会静默跑假识别），确实要 mock 就设 `ALLOW_MOCK_AI=1` |
| `CRON_SECRET` | 一串长随机值；Vercel Cron 会带 `Authorization: Bearer $CRON_SECRET` |

构建期由 `lib/deploy-env.ts` 把关（缺变量 / URL 非法 / 生产仍是 mock AI → 直接失败），
部署完再核一眼 CSP 里有没有 Supabase origin 与 `challenges.cloudflare.com`：

```bash
curl -sI https://<你的域名> | grep -i content-security-policy
```

**预览部署的注意事项**：Vercel 的预览站默认公开可访问。若预览也拿到了 `SUPABASE_SERVICE_ROLE_KEY`，
拿到链接的人就能对**生产库**注册与写入 —— 建议把密钥的环境作用域限制为 Production，或给预览单独建一个
Supabase 项目，并开启 Deployment Protection。构建时对此会打警告。

### 3. 定时清理

`vercel.json` 配了每天 03:00（UTC）打一次 `/api/cron/prune-drafts`，回收 30 天没动过的发布草稿
（存储对象 + 登记行 + 草稿）。Hobby 计划每天只能跑一次，正好够用；本地手动跑用 `pnpm db:prune-drafts`。

## 文档

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) —— 需求与安全模型
- [docs/PLAN.md](docs/PLAN.md) —— 架构约定、里程碑、测试策略
- [docs/UI-DESIGN.md](docs/UI-DESIGN.md) —— UI 规范与 testid 清单
- [docs/VERIFICATION.md](docs/VERIFICATION.md) —— 验证记录与已知限制
- [docs/SKILL-AUDIT.md](docs/SKILL-AUDIT.md) —— shadcn 技能合规审计

## 目录

    app/         页面与 Server Actions：(auth) 登录注册、(wall) 失物墙、publish、items、me、api/upload、api/cron
    components/  nav 标题栏、motion 动效、auth 人机校验、contact 电话/位置、claim、media、pwa、ui（shadcn）
    lib/         db 数据访问、ai 提供方、supabase 客户端、storage、validation zod schema、geo、env、deploy-env
    supabase/    migrations（10 个）与本地配置
    tests/       unit、component、rls、e2e、live
    docs/        需求、计划、UI 规范、验证记录、技能审计
    vercel.json  定时任务（草稿回收）配置
