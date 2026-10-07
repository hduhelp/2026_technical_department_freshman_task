# shadcn 技能合规审计

> 依据：项目内技能目录 `.agents/skills/shadcn/`（`SKILL.md` + `rules/*.md`）。
> 本项目 `components.json` 的 style 为 `base-maia` —— 即技能所说的 **Base UI 项目**，而非 Radix / React Aria。
> 审计范围：`app/**`、`components/**`（不含 `components/ui/**` 这些 shadcn 生成物）、`lib/**`。

---

## 1. Toast（本次审计的起因）

技能原文（`SKILL.md:67-68`）：

> **Toast follows the project base.** Use `toast` from the `toast` component for Base UI projects. Use `toast()` from `sonner` for Radix and React Aria projects.

`rules/composition.md:91-113` 给出同样两分支的示例，Base UI 分支为：

```tsx
import { toast } from "@/components/ui/toast"

toast.add({ title: "Changes saved." })
```

**结论：本项目应使用 `@/components/ui/toast` 的 `toast.add({...})`，不应使用 sonner。**

处置：项目最初误用了 sonner（跟随旧习惯）。现已完成迁移：

- 新增 `components/ui/toast.tsx`（Base UI 原生，依赖仅 `cn` + `@base-ui/react`）
- 删除 sonner 依赖与对应包装组件
- 调用统一改写为 `toast.add({ type, title })`（当前 21 处）；`app/layout.tsx` 中 `<Toaster>` 改为 Provider 包裹整棵树
- 已在真实浏览器验证：错误密码登录弹出错误 toast（现文案「手机号或密码不正确」，见 `app/(auth)/actions.ts`），`toast-viewport` 正常挂载，无 page error

---

## 2. Base UI 的 render 组合（nativeButton）

技能原文（`rules/base-vs-radix.md:50-61`）：

> When `render` changes an element to a non-button (`<a>`, `<span>`), add `nativeButton={false}`.

```tsx
// Incorrect
<Button render={<a href="/docs" />}>Read the docs</Button>

// Correct
<Button render={<a href="/docs" />} nativeButton={false}>Read the docs</Button>
```

**结论：`render={<Link/>}` 渲染出 `<a>`，必须带 `nativeButton={false}`。**

处置：当前全仓 7 处（`app/(wall)/page.tsx`、`app/me/page.tsx` 2、`app/items/[id]/claim-actions.tsx`、
`app/items/item-wall.tsx`、`components/contact/phone-link.tsx`、`components/contact/location-link.tsx`）均已补齐。
已从 `@base-ui/react` 源码确认告警门（`internals/use-button/useButton.js`）：仅当 `nativeButton=true` 且真实 DOM 不是 `<BUTTON>` 时触发；补齐后不可能再命中。

> 语义说明：`nativeButton={false}` 之后 Base UI 仍会给该 `<a>` 加 `role="button"`（`useButton.js:183-187`）。
> 这是技能指定写法的既定行为，读屏会读成按钮。若未来需要纯链接语义，可改为不套 Button、直接给 `Link` 套 `buttonVariants()`；
> 但那会偏离技能给出的规范写法，故本期不改。

---

## 3. 逐条规则审计结果

| 技能规则                                       | 出处                   | 结果                                               |
| ---------------------------------------------- | ---------------------- | -------------------------------------------------- |
| Toast 跟随项目 base                            | SKILL.md:67            | ✅ 已迁移到 Base UI `toast`                        |
| `render` 换非按钮元素需 `nativeButton={false}` | base-vs-radix.md:50    | ✅ 7 处全部已补                                    |
| 禁止 `space-x-*` / `space-y-*`                 | styling.md:10          | ✅ 0 处违规                                        |
| 等宽高用 `size-*` 而非 `w-N h-N`               | styling.md:11          | ✅ 0 处违规                                        |
| 禁止手写 `dark:` 颜色覆盖                      | styling.md:13          | ⚠️ 6 处蓝色链接，见 §4                             |
| 用语义色 token，不用原始 Tailwind 颜色         | styling.md:20-60       | ⚠️ 同上 6 处，见 §4                                |
| 用 `truncate` 简写                             | styling.md:12          | ✅ 0 处违规                                        |
| 条件类名用 `cn()`                              | styling.md:14          | ✅ 0 处违规                                        |
| 不给 overlay 组件手写 z-index                  | styling.md:15          | ✅ 0 处违规                                        |
| `TabsTrigger` 必须在 `TabsList` 内             | composition.md:178-190 | ✅ 2 个 trigger 均在唯一 `TabsList` 内             |
| `Avatar` 必须配 `AvatarFallback`               | composition.md:194     | ✅ 未使用 Avatar                                   |
| Button 无 `isPending` / `isLoading` 属性       | composition.md:165-174 | ✅ 仅用 React 的 `useTransition()`，非 Button 属性 |

---

## 4. 已知且**有意保留**的偏差

| 项                | 技能建议                                                                                                | 现状                                                                                                                     | 理由                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 按钮 loading 指示 | `composition.md:165-174` 建议 `<Button disabled><Spinner data-icon="inline-start" />Saving...</Button>` | 6 处按钮用 `disabled` + 文案切换（「登录中…」「注册中…」「保存中…」「撤单中…」「撤回中…」「加载中…」），未引入 `Spinner` | 现有实现已满足 PRD 的「清晰的操作反馈」；引入 Spinner 要改十余处按钮，并让已冻结的 E2E 结果再次作废。**作为可选的收尾打磨项保留**，如需可按「冻结 → 全量重验」流程单独做一轮 |
| 蓝色链接          | `styling.md:13,20-60`：禁手写 `dark:` 覆盖、用语义色 token                                              | 6 处 `text-blue-600 dark:text-blue-400`（signup-form 2、phone-link 2、location-link 1、release-claim 1）                 | 蓝色是 `docs/UI-DESIGN.md` §4 指定的电话/位置链接样式；语义色 token 里没有链接蓝。**有意保留**                                                                               |

---

## 5. 复现审计的命令

```bash
# 规则 1-5、8
grep -rnE "space-[xy]-" --include=*.tsx app components | grep -v "components/ui/"
grep -rnE "\bw-([0-9]+) h-\1\b" --include=*.tsx app components | grep -v "components/ui/"
grep -rn "dark:" --include=*.tsx app components | grep -v "components/ui/"
grep -rnE "(bg|text|border)-(red|green|blue|gray|slate)-[0-9]{2,3}" --include=*.tsx app components | grep -v "components/ui/"

# nativeButton 完整性
grep -rn "nativeButton" --include=*.tsx app components | grep -v "components/ui/"
```
