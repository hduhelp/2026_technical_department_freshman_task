# UI 规范（当前版）

一句话：**操作尽可能少，每一屏尽可能空，空的一屏居中，框架整齐划一。**

## 1. 框架

- **没有底部导航栏**；全站唯一「我的」入口在**首页右上角**（标题栏 `showMe`，`data-testid="me-entry"`）；
  首页头像**左边**是「安装应用」按钮（`install-app`）—— 只在「能装且还没装」时出现，装完自己消失。
- **标题栏由 layout 统一提供**（`components/nav/title-bar.tsx` + `app/template.tsx`）。
  页面**不要自己画 header**；只有「标题依赖数据」或「返回要自定义」时用 `<PageTitle />` 覆盖（未传字段沿用路由默认）。
  路由默认：`/` 失物招领墙、`/publish` 发布招领、`/items/[id]` 物品详情（`item-back`）、
  `/items/[id]/claim` 认领信息（`pickup-cancel`）、`/me` 我的、`/me/profile` 我的信息、
  `/me/items/[id]/pickups` 认领人、`/terms` 服务条款、`/privacy` 隐私政策；`/login`、`/signup` 不显示标题栏。
  标题栏 sticky、无下边框，标题切换做淡入上移。
- **内容量不大的屏用 `my-auto` 居中**（不要 `justify-center`，小屏会裁顶）；列表页不要居中。
- **禁止选中 UI 文字**（`body { user-select: none }`，输入框例外），像原生 App。

## 2. 流程

| 路由                | 一屏只做一件事                                                     |
| ------------------- | ------------------------------------------------------------------ |
| `/`                 | 失物招领墙：发布入口 + 双列瀑布流；**未登录也能看**，点卡片去登录  |
| `/publish`          | 四屏向导：拍照 → 确认信息 → 怎么还 → 详细设置                      |
| `/items/[id]`       | 看物品（scroll-snap 轮播）+ 认领入口 / 查看认领信息                |
| `/items/[id]/claim` | 认领信息：认领指引 + 拾主联系方式/位置 + 其他认领人 + 「领错了？」 |
| `/me`               | 头像+姓名+手机号卡片（含退出登录）+ 我的发布 / 我的认领            |

**发布**：① 拍照（一行指引 + 网格，**最后一个是「添加照片」**，没有照片时它就是上传按钮；上限 3 张、不显示数量）
→ ② 确认信息（进入即自动识别，全屏 `LoadingOverlay`，**加载期间不渲染输入框**；失败可手填/重试）
→ ③ 两张**带描述的卡片**（代为保管 / 指定存放位置）
→ ④ 详细设置（代为保管 = 只读展示账号手机号；指定存放位置 = 「使用当前位置」可选 + **位置详情必填**）→ 发布。
点②的「下一步」时会先让 AI 看一遍这组照片（`photo-check-loading`）：通过直接进下一屏，不通过弹对话框给「继续拍照 / 仍然继续」，**可跳过**。

**认领**：详情页点「我要认领」→ 弹「诚信认领」二次确认（只读展示自己的姓名与手机号）→ 确认后**立刻跳转**认领信息屏。
已被别人认领也**允许认领**；认领信息屏展示其他认领人 + 警告 Alert 引导协商，底部「**领错了？**」可撤回（认领记录保留）。
已认领本人回详情页按钮变「查看认领信息」。

## 3. 文案

标题 ≤ 8 字；说明最多一句 ≤ 20 字；不解释内部机制；不用「点击/按钮/页面」指代 UI。
按钮用动词短语；**危险操作（退出登录、撤单、撤回认领）一律 danger 样式 + 二次确认**。

## 4. 电话与位置组件（必须复用）

- `<PhoneLink phone />`：电话图标 + 号码，蓝色，点击二次确认后 `tel:` 拨号。
- `<PhoneText phone />`：同样样式但不可点击（展示自己的信息时用）。
- `<LocationLink label lat lng />`：定位图标 + **「查看定位」**，蓝色，点击二次确认后用**高德**打开
  （位置详情展示在确认框里）。**任何情况下都不显示经纬度**；坐标是 WGS84，交给高德前在 `lib/geo.ts` 转 **GCJ-02**。
- 手机端「查看定位」**直接唤起高德 App**（一步，不经过高德网页版那个还要再点一次的中间页）：
  iOS 用 `iosamap://viewMap|poi`；安卓 Chromium 用
  `intent://…​#Intent;scheme=androidamap;package=com.autonavi.minimap;S.browser_fallback_url=…;end`；
  其他安卓浏览器退回 `androidamap://`。约 2 秒内没被 App 接管（没装高德 / scheme 被拦）就退到网页版。
- 桌面端、微信/QQ 等内嵌浏览器（自定义 scheme 必被拦）直接打开 `https://uri.amap.com/…` 网页版。

## 5. 动效（唯一出入口 `@/components/motion/primitives`）

`DURATION.fast|base|slow`、`FadeIn`、`StaggerList/StaggerItem`、`TapScale`、`StepTransition`、`Collapse`、
`SuccessOverlay`、`LoadingOverlay`、`MotionBar`；`PageTransition` 已由 `app/template.tsx` 挂好，页面不要再用。

时长只用 `DURATION`、曲线用 `EASE_OUT`；位移 ≤ 24px、缩放 ≥ 0.95；**无限循环只允许加载指示器**；
Server Component 优先用 CSS 反馈，不要为动效改成客户端组件；无障碍由 `MotionProvider`（`reducedMotion="user"`）统一处理；
元素始终留在 DOM 里（用 opacity/transform），断言用的 testid 不要挂在会卸载的容器上。

## 6. 账号

**手机号就是账号**：注册填真实姓名 + 手机号 + 密码并勾选同意条款；登录用手机号 + 密码（无验证码，内部映射成 `<phone>@<域名>`）。
个人信息注册即必填，可在 `/me/profile` 修改（支持 `?next=` 回来源页），认领时直接复用。
未登录可看首页信息流；登录/注册页都有「随便看看」回首页。

## 7. testid 清单

改 UI 时同步这份清单；`tests/e2e/**` 优先按它定位元素，少量断言仍会用到文案与结构（如「已认领」角标、标题栏数量）。

- 墙：`publish-entry` `wall-empty` `wall-error` `item-wall` `item-card` `load-more` `wall-no-more`
- 详情：`item-back` `item-owner-notice` `pickup-open` `pickup-view-info` `pickup-claimed` `pickup-withdrawn`
  `gallery-track` `gallery-dot-N` `gallery-counter`
- 认领：`claim-confirm` `claim-confirm-profile` `claim-confirm-name` `claim-confirm-ok` `claim-confirm-cancel`
  `claim-error` `claim-guide` `pickup-revealed` `reveal-contact` `reveal-location` `claim-info` `claim-info-name`
  `claim-others` `claim-other-phone` `claim-release` `claim-release-open` `claim-release-confirm` `claim-release-ok`
  `claim-release-cancel`
- 发布：`photo-add` `photo-check-loading` `photo-advice-dialog` `photo-advice-retake` `photo-advice-skip`
  `analyze-loading` `custody-kept` `custody-in-place` `publish-success`
- 我的：`profile-entry` `sign-out` `sign-out-confirm` `sign-out-cancel` `sign-out-ok` `withdraw-open`
  `withdraw-confirm` `withdraw-cancel` `withdraw-ok` `me-pickup-card` `profile-name` `profile-phone` `profile-submit`
  `picker-phone-<pickupId>`
- 组件/其它：`phone-link` `phone-call-dialog` `phone-call-confirm` `phone-call-cancel` `location-link`
  `map-open-dialog` `map-open-confirm` `map-open-cancel` `title-bar` `me-entry` `browse-without-login`
- 离线页：`offline-retry`
- 安装：`install-app` `install-ios-dialog`
- 骨架 / 图片：`wall-skeleton` `wall-loading-more` `item-cover`（+`-skeleton` / `-error`）
  `gallery-image-N`（+`-skeleton` / `-error`）

## 8. 共享件与纪律

- 共享件（页面只准用、不准改）：`components/nav/title-bar.tsx`、`components/motion/**`、
  `components/contact/**`、`components/claim/release-claim.tsx`、`app/template.tsx`。
- 数据层只走 `lib/db/**`；schema/RPC/授权只改 `supabase/migrations/**`（改完由 Lead 跑 `pnpm db:reset` + `pnpm db:types`）。

---

## 9. 手机 / PWA

- 「添加到主屏幕」后以 **standalone** 打开（没有地址栏）：清单在 `app/manifest.ts`，图标在 `public/icons/`
  （`icon.svg` 是源文件，导出 192/512 与满幅 maskable；iOS 主屏图标是 `app/apple-icon.png`）。
- 状态栏颜色跟主题走：manifest 的 `theme_color` 是品牌青柠 `#9ae600`（见 `app/manifest.ts`），页面里由 `layout.tsx` 的 `viewport.themeColor` 按主题给 `#ffffff` / `#0a0a0a`。
- **离线页 `/offline` 必须免登录可达**（它被 Service Worker 预缓存）：否则未登录访客装的 PWA 会把登录页当成离线页。
- Service Worker（`public/sw.js`）只在**生产构建**注册，且只缓存静态资源与离线页；
  业务页面（含登录态的 HTML）一律 network-first、不写缓存。
- **安装入口**：`beforeinstallprompt` 一触发就 `preventDefault()` 拦掉浏览器自带的安装提示，
  改由首页标题栏的「安装应用」按钮调 `prompt()`（该事件只能用一次，用完即弃）；
  已经以 standalone 打开（= 装过）或设备不支持时，按钮不渲染、不留空位。
- **状态栏不闪白**：Next 每次客户端路由切换都会重建 `<head>` 元信息，独立窗口里这一瞬间会掉回
  manifest 的兜底色。`components/pwa/status-bar-keeper.tsx` 把状态栏相关的 meta 镜像一份交给
  DOM 直接持有（不归 React 管），manifest 的 `theme_color` / `background_color` 也从白色改成品牌青柠。

---

## 10. 骨架屏与图片

- **所有图片一律用 `components/media/skeleton-image.tsx`，不要裸 `<img>`**：加载中撑出占位比例 +
  呼吸骨架，加载完淡入（`motion-reduce` 下不做过渡），失败换成图标 + 一句话 ——
  **任何状态都不许露出浏览器的破图与 alt 文本**。`fill` 用于尺寸由外部固定的容器
  （正方形轮播位、80px 缩略图），`aspectClassName` 给占位比例（自然模式下加载完即撤掉，
  让图片按真实宽高比撑开，瀑布流才有错落）。
- 失物墙首屏骨架在 `app/(wall)/loading.tsx` —— **必须挂在路由组里**：放根目录会包住所有子路由，
  详情页的 `notFound()` 会因流式响应已发出 200 而退化成 200（见 VERIFICATION §4.11）。
  它是**服务端流式**吐出来的第一段 HTML，覆盖首次进入 / 刷新 / 从桌面图标启动；
  客户端跳转时 Next 会等响应到齐再整屏切换（§5 已知限制）。
  「加载更多」时在瀑布流里补两张 `wall-loading-more` 占位卡，别让用户盯着不动的按钮。
- 骨架是**装饰**：`aria-hidden`、不参与朗读；图片的 `alt` 始终留在 DOM 上（失败时靠 `opacity-0` 藏起来，
  屏幕阅读器仍然读得到）。
