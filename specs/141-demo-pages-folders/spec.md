# Spec: demo 页面按文件夹分组

- **ID**: 141-demo-pages-folders
- **状态**: done
- **日期**: 2026-09-26

## 1. 要解决什么

`demo/src/pages/` 下 15 个页面平铺，靠 `vant-` / `nutui-` 前缀区分，首页的四个分组
（基础能力 / 交互演示 / Vant / NutUI）在文件系统里看不出来。

## 2. 不做什么（Non-goals）

- 不改页面内容与首页分组逻辑（`catalog.ts` 仍按 `<route>` 的 `group` 分组）。
- 不改运行时 / CLI：文件路由已支持子目录（hello-fjs 的 `example/style/*.vue`）。

## 3. 用户可见的行为

| 分组 | 目录 | 路由 |
|------|------|------|
| 基础能力 | `pages/basic/` | `/basic/about`、`/basic/fetch`、`/basic/icons` |
| 交互演示 | `pages/interaction/` | `/interaction/drag`、`/interaction/dnd` |
| Vant | `pages/vant/` | `/vant/basic`、`/vant/feedback`、`/vant/float`、`/vant/form`、`/vant/more`、`/vant/nav`、`/vant/watermark` |
| NutUI | `pages/nutui/` | `/nutui/basic`、`/nutui/button` |

首页 `pages/index.vue` 不动（`/`）。首页条目的跳转路径来自路由表，自动跟随。

## 4. 两端约定（宪法 I）

纯文件搬迁，两端共用同一路由表，无差异。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter demo run typecheck` 通过（含重新生成的 `src/fjs-routes.d.ts`）。
2. `pnpm --filter demo run build` 与 `build:web` 成功。
3. demo web：首页四组条目可点进对应页；vant watermark 页「去 /about」按钮跳到 `/basic/about`。
4. `demo/bench/*.ts` 的页面 import 路径更新，`README.md` 里的路由名更新。

## 7. 待澄清

- 无（目录名取英文，与路由一致）。

## 8. 验收结果

1. ✅ `pnpm --filter demo run typecheck` 通过；`src/fjs-routes.d.ts` 重新生成为 `/basic/about` … `/vant/watermark`。
2. ✅ `pnpm --filter demo run build`（style prewarm 15 页）与 `build:web` 成功。
3. ✅ demo web：首页「基础能力 → about」跳到 `#/basic/about`；`#/nutui/basic` 正常渲染；
   `#/vant/watermark` 的「去 /basic/about」按钮跳转正确。
4. ✅ bench import 与 README 路由名已更新。
