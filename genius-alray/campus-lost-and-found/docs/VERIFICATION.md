# 验证记录

## 1. 怎么验

| 命令             | 覆盖                                                             |
| ---------------- | ---------------------------------------------------------------- |
| `pnpm verify`    | typecheck + lint + unit + rls + e2e（一条命令全量）              |
| `pnpm test:unit` | zod schema、db 错误映射、AI mock 契约、高德链接与唤起方案、PWA 清单/图标/SW/状态栏纪律、图片三态、安装按钮 |
| `pnpm test:rls`  | 安全矩阵：行级/列级权限、RPC 边界、客户端写入拒绝                |
| `pnpm test:e2e`  | 真实浏览器（Pixel 7）跑用户可见流程；**强制 `AI_PROVIDER=mock`**；webServer 是 `pnpm build && pnpm start`，即**测构建产物而不是 dev server** |
| `pnpm test:live` | 真实模型（DeepSeek）视觉 + 结构化输出；需要网络与 key            |
| `pnpm build`     | 生产构建（会类型检查 `tests/**`）                                |
| `pnpm db:prune-drafts` | 回收被放弃的发布草稿（登记行 + 存储对象）；默认 dry-run，`--apply` 才真删 |

前置：`pnpm db:start && pnpm db:env && pnpm db:reset`。

> **本轮（第 14 轮）的验证范围**：typecheck / lint / 单元与组件用例、以及生产构建在本机跑过；
> 安全矩阵与 E2E **需要本地 Supabase**（`pnpm db:start`），在容器运行时不可用的机器上跑不了。
> 因此 `tests/rls/14-rate-limits`（新增的发布限流断言）与 `tests/rls/16-prune-drafts`（草稿回收）
> 必须在有 Supabase 的机器上跑一次 `pnpm test:rls` 才算验证通过 —— 本文档不预支这个结论。
>
> **生产库落地记录（2026-10-07）**：8 个迁移已由 `supabase db push` 推到生产项目
> （`iehxleycijdqlglnfbby` / Southeast Asia (Singapore) / Postgres 17.11）。
> 核对方式是 `supabase gen types typescript --linked` 生成远端 schema，再与仓库里的
> `lib/database.types.ts` 逐行对比：**public schema 零差异** —— 9 张表、8 个函数、
> `publish_per_day` / `publish_per_week` 两列都在；仅有的差异是 CLI 版本带来的
> `__InternalSupabase` / `graphql_public` / `Args: never` 写法，与本项目 schema 无关。
>
> **PostgREST 冒烟（已补做，通过）**：网络恢复后直连生产项目验证了客户端身份边界 ——
> anon 读 `found_items(id)` → 200；读 `contact` → **42501**；读 `app_config` → 42501；
> 调 `consume_ai_quota` → 42501（permission denied for function）；调 `get_app_config()` → 200。
> service_role 读 `image_uploads` / `publish_drafts` / `app_config` → 均 200，
> 并读到 `publish_per_day=10` / `publish_per_week=30` —— 第 15 轮的显式授权与第 14 轮的发布限流
> **都已在生产生效**。仍未覆盖：真实浏览器里的端到端流程（那需要 `pnpm test:rls` / `pnpm test:e2e`，
> 前提是本机起得来 Supabase）。

## 2. 安全矩阵（tests/rls，18 个文件）

| #   | 断言                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------- |
| 1   | 未撤单物品（published / claimed）公开可读；withdrawn 仅拾主可读                                          |
| 2   | `contact` / `location_*` **列级 REVOKE**：客户端任何查询（含 `select(*)`）都 42501                       |
| 3   | 三张业务表对 anon/authenticated **只有 SELECT**，写入一律被拒                                            |
| 4   | 私有图片桶无客户端策略；只有服务端签名 URL 可读                                                          |
| 5   | `reveal_found_item_contact`：仅拾主本人或已认领者                                                        |
| 6   | `create_pickup`：认领即置 claimed；**允许多人认领**；拾主不能认领自己的；已撤单拒绝；本人重复提交 = 更新 |
| 7   | `withdraw_found_item`：仅 owner 且 status=published；已认领 → P0001                                      |
| 8   | `release_found_item_claim`：撤回只摘掉自己；还有人认领时物品保持 claimed，最后一个活跃认领撤回才回到 published；记录保留（`released_at`），可再认领 |
| 9   | `publish_found_item`：照片数量 1..max_photos；路径前缀必须是自己的 uid；in_place 必须有位置详情                                   |
| 10  | RPC 契约守卫：只给必填参数也能被解析（不能是 PGRST202）                                                  |
| 11  | `listMyItems` / `listMyPickups` 显式按 owner/picker 收窄（RLS 公开读之后必须自己做）                     |
| 12  | 源码纪律：禁止对 `found_items` 做星号 select                                                             |
| 13  | `profiles`：只能读写自己那一行；姓名/手机号 CHECK + 手机号唯一；**改手机号后登录账号同步到新号**（新号能登录、旧号不能、别人占用的号被拒） |
| 14  | `image_uploads`：只有上传者读得到自己的登记行；发布按 `p_upload_ids` 校验归属（引用他人 → 42501、不存在 → P0002、重复引用/已用过都被拒） |
| 15  | 频率限制：认领 1 小时 2 次 / 24 小时 5 次（重复提交不计数）；**发布 24 小时 10 条 / 7 天 30 条（第 10 条放行、第 11 条被拒；周阈值在当天额度没用完时也会生效；撤单不释放额度；按账号隔离）**；AI 配额每小时 10 次、按用户隔离；anon 不可调用 |
| 16  | 发布草稿：**一个用户只有一份**（主键保证，重复插入 → 23505）；客户端只读自己的、写一律走 RPC；挂载张数受 `max_photos` 限制；移除照片会删掉登记行并交回存储路径；发布成功后草稿清空 |
| 17  | 草稿回收：超过 30 天没动过的草稿连同**照片对象 + 上传登记行 + 草稿行**一起删除；还在用的草稿一根毫毛都不动；重复运行幂等（第二次什么都不删） |
| 18  | 撤回认领的多人语义：A、B 都认领后 A 撤回 → 物品仍 claimed、A 退出认领人名单且不再放行联系方式；B 也撤回后回到 published；撤回记录保留且可再认领；重复撤回 / 未认领者撤回 → 42501；不存在物品 → P0002 |

## 3. 端到端场景（tests/e2e）

第 9 轮把「按轮次累积的 16 个 spec」收敛为**按功能划分的 spec**：删掉重复的发布 / 认领主链路，
每类行为只留一条主链路 + 各自特有的断言；第 11 轮为 PWA 外壳补了 `11-pwa.spec.ts`，第 13 轮补了 `12-skeletons.spec.ts`，**第 10 轮补了 `13-draft.spec.ts`**，现共 **13 个**。
浏览器是 Pixel 7，`workers: 1`（本地 Supabase 是共享状态），强制 `AI_PROVIDER=mock`。
**跑的是构建产物**（`pnpm build && pnpm start`，见 §5 的取舍说明）。

| 文件                        | 覆盖                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `01-publish-wizard.spec.ts` | 四屏向导；拍照屏无文本表单/无步骤条；3 张上限且不提示数量；点「下一步」才检查照片（可跳过）；识别期间不渲染输入框；位置详情必填且界面不出现经纬度；**AI 配额用完后跳过识别、弹 warning 提示，仍可手动填写继续** |
| `02-claim-flow.spec.ts`     | 诚信认领二次确认（取消不写库）；确认后**立刻**跳认领信息；揭晓电话 / 位置；统一组件的二次确认                   |
| `03-multi-claim.spec.ts`    | 第二个人看到「已有人认领」仍可认领；认领信息屏列出其他认领人；拾主名单看到全部人选                             |
| `04-withdraw.spec.ts`       | 撤单二次确认 → 墙上消失 → 本人见已撤单 → 他人 404；已认领后无撤单按钮且 RPC P0001；「领错了？」撤回认领、记录保留 |
| `05-me.spec.ts`             | 注册即带个人信息、可修改、认领时只读展示；**改手机号后新号能登录、旧号不能**；标签页一屏一段列表；退出登录二次确认 |
| `06-rest-privacy.spec.ts`   | anon 与登录会话直连 PostgREST：公开列可读，`contact`/`location_*`/`select=*` 全 42501，私有桶直读被拒          |
| `07-wall.spec.ts`           | 未登录刷信息流；点卡片去登录并回跳详情；登录/注册页「随便看看」；分页「加载更多」（数据并发创建 + 显式 created_at 固定顺序）；**匿名只给最新一页（无「加载更多」，改为去登录）** |
| `08-item-detail.spec.ts`    | 相册 scroll-snap：计数器与圆点 aria-current 同步、圆点跳转、无横向溢出                                        |
| `09-reduced-motion.spec.ts` | 系统「减少动态效果」下四屏发布流程仍可完整走完                                                                |
| `10-title-bar.spec.ts`      | 标题栏唯一性（且位于 `main` 内）；路由标题与详情页覆盖；返回控件 testid；首页「我的」在视口右半边              |
| `11-pwa.spec.ts`           | PWA 外壳：manifest 链接与清单字段、图标可访问且是 PNG、apple-touch-icon / 双 theme-color；**未登录也能打开 `/offline`**（不能被 proxy 重定向）；`/sw.js` 不被缓存；**拦截安装提示** + 首页「安装应用」按钮调起原生安装弹窗 |
| `12-skeletons.spec.ts`     | 骨架屏：失物墙首屏**流式**——同一份 HTML 里骨架在前、真实卡片在后；详情页图片加载中显示骨架、加载完淡入（人为拖慢图片请求）；**图片失败时显示图标占位，不出现破图与 alt 文本**（直接掐断请求） |
| `13-draft.spec.ts`         | 发布草稿：跨访问保留同一份（照片与文案都在）、草稿里已有文案时**不被 AI 覆盖**、反复保存仍然只有一份；**从草稿移除照片会连存储对象一起删掉**（不留桶内孤儿） |

## 4. 值得留档的缺陷（都已在代码里修掉）

1. **PGRST202：可选参数没有 DEFAULT** —— supabase-js 会丢掉值为 `undefined` 的键，PostgREST 按「键集合」精确匹配函数，
   于是「只给必填参数」就找不到函数。所有可选参数必须写 `default null`。
2. **42702：RETURNS TABLE 的 OUT 参数与列名撞名** —— 一律给 OUT 参数加 `out_` 前缀（踩过两次）。
3. **两套输入框**：AI 生成描述时用骨架屏但**没有替换表单**，屏幕上同时出现骨架和输入框。改成全屏 `LoadingOverlay`，
   加载期间不渲染表单，并用 `MOCK_AI_DELAY_MS` 让这个瞬时状态可被断言。
4. **认领成功对勾被抢跑**（D-2）：认领成功后详情页立刻变成已认领，组件切分支被卸载、定时器被 cleanup 清掉，
   于是「不跳转」。改成**确认后立刻 `router.push`**。
5. **AI 只能用一次**：`abortSignal` 被放进模块级常量，等于进程启动时创建了一个 60 秒后触发的信号，
   服务跑过 60 秒后所有请求都被同一个已 abort 的信号打断。改为每次请求现建。
6. **DeepSeek 不支持 `response_format: json_schema`**（实测报错），必须关掉结构化输出、走 prompt + JSON 模式。
7. **Tailwind v4 的 `scale-*` 编译成 `scale:` 而不是 `transform:`** —— 想给点击反馈做过渡要把 `scale` 写进 `transition-property`。
8. **Next 16 开发态单实例锁**：同一项目同时跑两个 `next dev` 会互相拒绝；E2E 用 `reuseExistingServer: false`，
   端口被占会直接报错（宁可报错也不要复用一个来源不明的 server）。
9. **装到桌面后跳转时顶部状态栏闪白**：Next 每次客户端路由切换都会把 `<head>` 里由 metadata / viewport
   生成的元信息**整体移除再重建**（MutationObserver 实测：一次跳转会 remove + add `theme-color`、
   `apple-mobile-web-app-*`、`link[rel=manifest]`）。独立窗口里这一瞬间会掉回 manifest 的 `theme_color`，
   深色主题下就是一道白闪。修法：`components/pwa/status-bar-keeper.tsx` 把状态栏相关的 meta 镜像一份
   交给 DOM 直接持有（不归 React 管），兜底色也从白色改成品牌青柠。生产构建实测：跳转全程
   `theme-color` 最少仍有 2 个，被移除的只有 React 自己那一份。
10. **根目录 `app/loading.tsx` 会包住所有子路由（含 not-found）** —— 页面里抛 `notFound()` 时，
    流式响应已经把 200 发出去了，状态码改不回来：E2E 里「他人访问已撤单物品应 404」直接变 200，
    同一 describe 的下一个用例也跟着挂。首屏骨架必须放进路由组（`app/(wall)/loading.tsx`），只作用于 `/`。
11. **「查看定位」在高德网页版上还要再点一次**：`uri.amap.com` 的 `callnative=1` 只是高德自己的落地页，
    用户还得在那一页再点「打开高德地图」。要一步进 App 必须直接跳 `iosamap://` / `androidamap://`；
    安卓更稳的是 `intent://` + `S.browser_fallback_url` —— 没装 App 时 Chrome 会自己回落网页版，
    而不是停在 `ERR_UNKNOWN_URL_SCHEME` 错误页（那样连兜底的 JS 都没机会跑）。
12. **改手机号把自己锁在门外**：账号是「手机号派生的内部邮箱」，但保存「我的信息」时只更新了
    `profiles.phone`、没动 `auth.users.email` —— 改完号之后资料显示新号，登录却只认**旧**号。
    修法：保存资料时先经 Admin API（`email_confirm: true`，不依赖邮箱确认策略）把登录账号同步到新号，
    再写 `profiles`；资料那一步失败就把登录账号回滚，绝不留半成品。见 `lib/auth/login-phone.ts`。
13. **匿名访客点「加载更多」必然报错**：翻页 action 对未登录直接返回「请先登录」，但按钮一直渲染着 ——
    墙上超过一页时点一下就是一条错误提示。修法：匿名只给最新一页，把按钮换成「登录后查看更多」。
14. **照片归属靠「路径前缀」判定**：客户端传 `p_paths`，服务端只比对 `like uid || '/%'`。
    前缀匹配既挡不住 `uid/../victim/x.jpg`（URL 解析器会把 `..` 归一化掉，签名请求实际打到别人的对象上），
    也把「存储路径」变成了客户端契约。修法：新增 `image_uploads` 登记表，发布改收
    `p_upload_ids uuid[]`，路径只由服务端生成与使用（见 `20261006120000_uploads_and_limits.sql`）。
15. **「实名认领」只存在于客户端**：`create_pickup(p_item_id, p_name, p_phone)` 的姓名手机号由
    调用方自由提交、只校验长度 —— 谁都能拿假名字换到拾主的联系方式。修法：RPC 只收
    `p_item_id`，姓名手机号一律从 `profiles` 取（多传参数会被 PostgREST 直接拒掉）。
16. **手机号可被批量采集**：注册不验证号码 + 认领即揭晓，一个账号就能遍历失物墙收集
    拾主与所有认领人的手机号。修法：认领限流 1 小时 2 次 / 24 小时 5 次；AI 调用限流
    10 次/小时（超限跳过识别并弹 warning toast）。阈值在 `app_config`，**由 RPC 强制**，
    直连 PostgREST 也绕不过。
17. **上传只信客户端声明的 MIME**：`file.type` 是任意字符串，桶的 `allowed_mime_types`
    校验的也是同一个值，于是任意字节都能被声明成 image/jpeg 存进私有桶。修法：按文件头
    魔数比对（`sniffImageMime`），对不上直接 415。
18. **全站没有任何安全响应头**：站内存着姓名与手机号，却是裸奔。修法：`next.config.ts`
    下发 CSP（放行 Supabase origin）/ nosniff / Referrer-Policy / frame-ancestors /
    Permissions-Policy，非 dev 额外发 HSTS，并关掉 `X-Powered-By`。
19. **未发布的照片会成为桶内孤儿**：上传成功后对象就躺在私有桶里，删照片只清了数据库、
    放弃发布也没有任何回收。修法（第 10 轮）：引入**单例草稿** —— 照片在落桶那一刻就挂到草稿上，
    移除照片时「登记行 + 对象」一起删；被放弃的草稿由 `pnpm db:prune-drafts` 整体回收
    （`scripts/prune-drafts.mjs`，默认 dry-run、30 天；线上改成 Vercel Cron 自动跑，见第 14 轮条目）。

20. **发布环节完全没有限流**：认领与 AI 都上了限流，发布本身却毫无约束 —— 一个账号可以
    无限往公开的失物墙上灌条目（每条最多 3 张 2MB 照片）。免费版 Supabase 只有 1GB 存储，
    约 170 条就能打满，而失物墙是所有人都会看的，被刷等于对全体用户不可用。
    修法（第 14 轮）：`app_config.publish_per_day=10` / `publish_per_week=30`，在
    `publish_found_item` 内按 owner 统计最近 24 小时 / 7 天**创建**的条目（撤单的也计入，
    否则「发完就撤」就是绕过限流的免费通道），超限抛 P0001 并给出可读文案。
21. **生产环境会静默跑假 AI**：`AI_PROVIDER` 默认 `mock`，云端忘了配时站点照样
    「识别成功」，只是结果永远是写死的那几条 —— 不报错、不告警、只有翻日志才看得出来。
    修法：`lib/deploy-env.ts` 在生产**构建**时直接失败，`lib/env.ts` 在运行期再兜一层；
    确实要用 mock 必须显式设 `ALLOW_MOCK_AI=1`。
22. **「构建成功但线上用不了」的 CSP 陷阱**：CSP 的 Supabase origin 是构建时从
    `NEXT_PUBLIC_SUPABASE_URL` 算出来的，构建环境缺这个变量时它退化成空串、
    **构建照样成功**，而线上所有浏览器端 Supabase 请求（登录、直读公开列）会被 CSP 拦掉。
    修法：同一个部署前哨把「缺必需变量 / URL 非法」变成构建失败，并在文档里把
    「该变量必须对构建环境可见」写成上线清单的一条。
23. **注册没有任何人机门槛**：账号是手机号且不发短信验证码，脚本可以批量注册并占走真实
    用户的号码（`profiles.phone` 唯一，号码被占的真人反而注册不了）。
    修法（第 14 轮）：接入 Cloudflare Turnstile，`captchaToken` 随
    `signUp` / `signInWithPassword` 交给 Supabase 校验；sitekey 为空时整块不渲染
    （本地与自动化测试不依赖外网）；令牌是一次性的，提交失败后自动换一张新挑战。
24. **预览部署会带上生产密钥**：Vercel 的预览站默认公开，若它也拿到
    `SUPABASE_SERVICE_ROLE_KEY`，任何拿到链接的人都能对生产库注册与写入。
    修法（配置侧，代码只能提醒）：构建时若发现 `VERCEL_ENV=preview` 且存在该密钥就打警告，
    文档里要求把密钥作用域限制为 Production / 给预览单独建项目 / 开启 Deployment Protection。

25. **上线后上传图片必挂：`permission denied for table image_uploads`（42501）** —— 之前的迁移只显式
    grant 了 `found_items` / `found_item_images` 与各 RPC 的 execute，**其余表一律指望 Supabase 平台的
    「新建表自动授权」**（`auto_expose_new_tables` / postgres 的 default privileges）。那个机制只对
    **由 `postgres` 角色创建**的对象生效，而 `supabase db push` 用的是 CLI 的临时登录角色
    （`cli_login_postgres`），云端新项目又已默认要求显式 GRANT —— 于是表建出来了，`service_role`
    却一个权限都没有，`/api/upload` 落库那一步直接 42501（存储对象倒是传上去了，所以表象是
    「照片传不上去」而不是「整个发布挂掉」）。
    本地 `db reset` 用 postgres 跑迁移、且 `config.toml` 的开关默认按 `true` 走，所以**本地永远复现不出来**。
    修法：新增 `20261007130000_explicit_grants.sql`，把 service_role 需要的表权限显式写死；
    同时把 `auto_expose_new_tables` 设成 `false`，让本地与云端同一套规则。
    回归防线：`tests/rls/17-server-privileges.test.ts`（服务端身份到底能不能干活）。
26. **弱网下「点了没反应」**（两处，同一类问题：等待期间没有任何可见反馈）：
    - **首页「我捡到了东西」**：按钮是 `<Link>`，发布页要查 4 次库 + 签一次图片 URL，
      手机网络下要等一两秒，期间界面还停在首页、按钮毫无变化。修法：在 `<Link>` 内部用
      `useLinkStatus()` 读这次导航的 pending，导航一开始就切成「正在打开…」+ 转圈
      （`app/(wall)/publish-entry.tsx`）。
    - **发布页的「发布」按钮**：`handlePublish` 整段跑在 `startTransition` 里，
      而 **transition 内的 setState 会被 React 推迟到 transition 结束才提交** ——
      `setPhase("publishing")` 因此要等 `publishItemAction` 返回才生效，按钮文案/转圈永远不出现
      （`isPending` 确实会让按钮禁用，但没有可见反馈，看着就是卡死）。修法：`run()` 先同步置
      `phase`（紧急更新）再进 transition，并把「只弹提示」的前置校验移出 transition。

27. **撤回认领会把别人的认领一起作废**：`release_found_item_claim` 无条件把物品从 `claimed` 改回
    `published`。第 7 轮起允许多人认领后，A、B 都认领时 A 点「领错了？」→ 物品变回「待认领」，
    B 的认领被无声作废，第三人还能再认领。单看 `pickups` 行是否存在也修不掉 —— 「认领记录保留」
    意味着撤回者那一行还在，只判断「有没有别人的行」会让最后一个撤回的人把物品永远卡在 claimed。
    修法（第 18 轮）：`pickups` 增加 `released_at`（null = 仍在认领），撤回只打时间戳；还有人活跃
    认领就保持 claimed，清零才回到 published；认领人名单与 `reveal_found_item_contact` 也只认活跃记录。
    回归防线：`tests/rls/18-release-claim.test.ts`。修复随新增迁移
    `20261007140000_release_claim_guard.sql` 下发，生产需要重新 `supabase db push` 才会生效。

## 5. 已知限制

- **Service Worker 只在生产构建注册**（`pnpm dev` 与 E2E 都不注册），所以缓存行为没有浏览器自动化覆盖，
  只有 `tests/unit/pwa.test.ts` 的静态纪律断言 + 生产构建下的人工/命令行核对；
- 失物墙骨架的宽高比是**猜的**（数据库里没有图片尺寸列）：占位高度不可能和真实图片完全一致，
  图片加载完仍会有一次高度收敛；换来的是「卡片不会塌成 0 高、也不露破图」；
- 首屏骨架靠**服务端流式**（HTML 第 ~4KB 就是骨架，真实卡片在 ~33KB 处），覆盖的是首次进入 /
  刷新 / 从桌面图标启动；**客户端跳转**时 Next 16 会等 RSC 到齐再整屏切换，这时看不到 loading 骨架
  （实测：把 RSC 拖慢 3s，骨架只在响应落地前后闪 ~40ms）。所以 E2E 断言的是流式 HTML 的先后顺序，
  而不是「跳转时看得见骨架」那种掷骰子的瞬时状态；
- 「一步进高德 App」与「状态栏不闪白」都依赖真机（手机浏览器 + 已安装高德 / 已装到桌面），
  自动化只覆盖**方案判定**（`planAmapLaunch` 纯函数：iOS scheme、安卓 intent、桌面与内嵌浏览器回落）
  与**镜像 meta 是否会被 Next 的重建带走**（`status-bar-keeper.test.tsx`）；
- 相册滑动只用 `scrollLeft` 驱动断言，未覆盖真实多点触控；
- 真实模型抖动时可能触发 60s 服务端超时 / 25s 客户端看门狗，走「识别失败，自己填一下」降级（功能正确）；
- **草稿回收有了调度器，但只覆盖 Vercel**：从草稿移除照片会连对象一起删，上传了却没发布的照片
  都属于该用户唯一那份草稿，超过 30 天没动过就由 `/api/cron/prune-drafts`（`vercel.json` 每天 03:00）
  整体回收；本地只能手动 `pnpm db:prune-drafts`。Hobby 计划每天只允许一次 cron，够用；
  若换到不跑 cron 的托管方式，这条要另找调度器（pg_cron / 外部 cron）。
  回收是「每份草稿独立」的：任何一份失败只跳过它自己，下一轮接着删，不会留下半删状态；
- **人机校验没有自动化交互覆盖**：Turnstile 需要真实浏览器与 Cloudflare 脚本，E2E 里
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 为空（不渲染、不注入第三方脚本），因此自动化只覆盖了
  「开关为关时的行为」（组件用例）与「CSP 是否放行 `challenges.cloudflare.com`」（响应头用例）；
  真正的挑战交互要在预览或生产环境人工过一遍；
- **E2E 跑的是构建产物**（`pnpm build && pnpm start`）而不是 dev server：测的就是真正会发布的东西
  （生产 bundle、生产 CSP、没有 dev 专属分支与浮层），而且明显更快 —— 同一批用例实测用例总时长
  从 105.8s 降到 78.3s（**-26%**），构建本身只要 ~9s。代价：生产构建会注册 Service Worker，
  缓存行为因此也进了 E2E 覆盖面（09/12 拖慢图片用的是跨域签名 URL，SW 不接管，拦截仍然有效）；
- **E2E 仍然是串行的**（`workers: 1`）：失物墙用例（`07-wall` 的分页断言、`12-skeletons` 的流式顺序）
  依赖「墙上有多少条、谁更新」，并行执行会引入不确定性。第 9 轮的批量选图、AI mock 延时
  （800→500ms）、分页数据并发创建 + 显式 `created_at` 都保留着；**要再上一个台阶只能并行**，
  前提是先把墙上内容的断言改成不依赖全局条数。
