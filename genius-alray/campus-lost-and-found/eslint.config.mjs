import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // 模板自带的 eslint-plugin-react 7.x 与 ESLint 10 不兼容：
    // 自动探测 React 版本时会调用已被移除的 context.getFilename() 并直接崩溃。
    // 显式写死版本即可跳过探测（版本需与 package.json 里的 react 保持一致）。
    settings: { react: { version: "19.2.8" } },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Supabase CLI 的运行状态（HOME 指向 node_modules/.cache，避免写 ~/.supabase）
    "supabase/.temp/**",
    ".agents/**",
  ]),
]);

export default eslintConfig;
