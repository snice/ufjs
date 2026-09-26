# demo

Vue 3 + Vite fjs app。首页 `src/pages/index.vue` 是分类手风琴（同 examples/hello-fjs）：
条目由 `src/catalog.ts` 从路由表收集，每个页面在自己的 `<route>` 块里声明
`group`（基础能力 / 交互演示 / Vant / NutUI）和一句 `desc`，新增页面不用改首页；
没写 `group` 的页面不进目录。

两套第三方组件库并存，都是全局注册、两端同一份插件：
- **Vant 4**：`src/plugins/vant.ts` + App 端源码补丁 `vite/vant.ts`（specs/068 起）。
- **NutUI 4**（`@nutui/nutui@^4.3.14`）：`src/plugins/nutui.ts`，走逐组件入口
  `dist/packages/<comp>/index.mjs` 与 `style/css.mjs`，不走整包 barrel；类型见
  `src/nutui-components.d.ts` / `src/nutui-modules.d.ts`。首批 Button、Cell、
  CellGroup、Tag、Divider 和 `@nutui/icons-vue` 图标（specs/139）。

`@ufjs/iconmind`（源码在 `packages/fjs-iconmind`）是一个完整的 fjs 模块示例：
[IconMind](https://iconmind.dev) 图标包成一个 `<icon-mind />` 标签，App 上 Flutter
绘制，Web 上内联 SVG，`/icons` 页面用它。demo 对它就是一条 npm 依赖——和别人装它
的方式完全一样。

这个项目没有为它配置任何东西：模块自带构建步骤（`fjs.prepare`），每次
`fjs build` / `fjs dev` 前扫描源码里写了哪些 `<icon-mind name="…" />`，只生成那
几个图标的数据和类型（产物在 `.fjs/modules/iconmind/`，不进版本库）。名字来自
数据、扫不到的，写在根目录 `iconmind.json` 里。

`/drag` 和 `/dnd` 两个页面是触摸事件的例子：块拖拽（含多指）和拖拽排序
（网格 + 竖列表）。两个页面在浏览器、Android、iOS 上跑的是同一份代码，
细节见 [docs/ui-api.md](../docs/ui-api.md#触摸事件对齐-dom)。

`fjs modules` 可以看到模块链上了什么，细节见 [docs/modules.md](../docs/modules.md)
和模块自己的 README。

## Develop

```bash
pnpm install
pnpm run dev:web      # browser via Vite
pnpm run run:android  # Flutter Android host, created under .fjs/flutter
pnpm run run:ios      # Flutter iOS host, created under .fjs/flutter
pnpm run typecheck
```

## Build

```bash
pnpm run build
pnpm run build:bytecode
pnpm run build:pages
pnpm run build:web
pnpm run build:release  # split bytecode copied to .fjs/flutter/assets/fjs
pnpm run build:apk      # also runs flutter build apk
```

Pass Flutter build arguments after `--`:

```bash
pnpm run build:apk -- --debug
```
