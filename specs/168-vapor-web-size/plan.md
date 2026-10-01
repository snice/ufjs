# Plan: vapor web 包体——样式注入拆成叶子模块

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 只动 web 构建的导入位置；Flutter 不经 injectStyle |
| II 边界即契约 | 否 | — |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 验收 3/4 浏览器实测样式确实注入（拆模块最容易静默丢的就是副作用） |
| VI 注释记录权衡 | 是 | 叶子模块顶部注释写清「为什么不能从 fjs/web 导入」 |
| VII JS 能包就不要下 Dart | 否 | — |
| VIII 文档 | 是 | `docs/web.md`（样式注入一节如有）/ `docs/performance.md` 记包体数字 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime · web | `packages/fjs-runtime/src/web/inject-style.ts`（新） | `injectStyle` 本体（依赖只有 `css-compat.ts` 的 `rewriteFjsCss`） |
| JS runtime · web | `packages/fjs-runtime/src/web/index.ts` | 删本体，re-export |
| CLI | `packages/fjs/src/bundler/vue-plugin.ts` | 两处生成代码改导 `fjs/web-style`；`webAliases` 加该 specifier |
| CLI | `packages/fjs/src/vite.ts` | alias 加 `fjs/web-style` |
| 测试 | `packages/fjs/test/vue-plugin-vapor.test.ts` | 断言生成代码的导入 |
| 文档 | `docs/performance.md` | 包体数字 |

## 3. 方案

叶子模块 + 新 specifier。否掉的备选：
- **给 fjs-runtime 加 `"sideEffects": false` 让打包器摇掉组件**：`fjs/web` 的组件表是被
  `fjsComponents` 对象引用的，导入 `injectStyle` 不引用它，理论上可摇；但 web 组件模块里有
  顶层注册与全局状态，整包标无副作用风险大（base-css 安装、touch 全局监听等靠副作用），
  且 vite dev 不摇树。否掉。
- **生成代码直接 import 绝对路径**：绕过 alias 机制，`@ufjs/runtime` 作为 npm 包发布后路径
  不稳定。否掉，走与 `fjs/web` 同一套 alias。

## 4. 风险

- `css-compat.ts` 若自身拖重依赖，收益打折——实施时看 analyze。
- vite dev 的 alias 漏配会在 dev 下报解析失败（不会静默）。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
cd examples/vapor-app && pnpm exec fjs build --web --analyze
# 浏览器：vapor-app preview + vite dev；hello-fjs build:web + build:web:fjs
```
