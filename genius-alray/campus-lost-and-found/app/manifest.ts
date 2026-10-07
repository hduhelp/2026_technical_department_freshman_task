import type { MetadataRoute } from "next"

/**
 * PWA 清单（Next 16 约定文件）。
 *
 * 放在 `app/` 根目录后，Next 会自动生成 `/manifest.webmanifest` 并在 <head> 注入
 * `<link rel="manifest">`。手机浏览器据此把站点「添加到主屏幕」，并以 standalone
 * 打开 —— 没有地址栏，看起来就是一个原生 App。
 *
 * 【图标为什么分两类】见 public/icons/：
 * - `icon-192.png` / `icon-512.png`：purpose=any，普通图标，四周留了 ~20% 余量；
 * - `icon-maskable-512.png`：purpose=maskable，背景满幅出血、图形缩到 78%，
 *   被安卓裁成圆形/圆角矩形（安全区是直径 80% 的圆）时不会切掉放大镜。
 *
 * 【颜色口径】`background_color` 是启动闪屏底色，`theme_color` 是状态栏的**兜底**底色
 * （页面里的 <meta name="theme-color"> 优先，深色下由 layout 的 viewport.themeColor
 * 覆盖成 #0a0a0a；manifest 里写不了 media query）。
 *
 * 两者都用品牌青柠 #9ae600（取色见 public/icons/icon.svg）：**刻意不用白色**。
 * 元信息在客户端路由切换时会有一瞬间空档，兜底色就是这时的状态栏颜色 ——
 * 用白色会在深色主题下闪一下白，用品牌色则始终像是有意为之。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // id 与 start_url 保持同源同路径：同一个站点不会在桌面出现两个图标
    id: "/",
    name: "校园失物招领",
    short_name: "失物招领",
    description: "拍照发布捡到的物品，浏览失物墙，留下领取信息找回失物。",
    lang: "zh-CN",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // 这个站本来就是移动端优先的单列布局，横屏只会更难受
    orientation: "portrait",
    background_color: "#9ae600",
    theme_color: "#9ae600",
    categories: ["utilities", "social"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // 长按图标弹出的快捷方式。未登录时点「发布」会被 proxy 送回登录页，
    // 登录页带 next 参数，登录完直接回到发布页。
    shortcuts: [
      {
        name: "去失物墙看看",
        short_name: "失物墙",
        url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        ],
      },
      {
        name: "发布招领",
        short_name: "发布",
        url: "/publish",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        ],
      },
    ],
  }
}
