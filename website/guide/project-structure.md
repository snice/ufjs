# 读懂项目结构

`fjs create` 生成的项目很小，但每个文件都有它的角色。这一篇逐个讲清楚，并说明哪些是**你写的**、哪些是**工具生成的**、哪些是**构建产物**。

## 目录总览

```text
my-app/
├─ package.json          依赖、脚本，以及 "fjs" 构建配置字段
├─ app.config.ts         原生应用配置：包名、权限、版本、屏幕方向、小程序 appid
├─ vite.config.ts        浏览器端 Vite 配置（挂了 fjs() 插件）
├─ index.html            浏览器端入口 HTML
├─ tsconfig.json         TS + Volar 配置（让编辑器认识 fjs 的标签）
├─ src/
│  ├─ main.ts            应用入口：各端共用
│  ├─ Shell.vue          页面外壳：每个页面都被它包一层
│  ├─ fjs-global.d.ts    把 fjs 的类型引进来
│  └─ pages/
│     └─ index.vue       首页 → 路由 "/"
└─ .gitignore
```

随着开发，还会陆续出现这些目录（都是**约定目录**，放进去就生效，不用注册）：

| 目录 | 作用 | 详见 |
|---|---|---|
| `src/pages/` | 每个 `.vue` 文件就是一个页面，路径即路由 | [页面与路由](./routing) |
| `src/components/` | 普通 Vue 组件，自己 import 使用 | [写第一个页面](./first-page) |
| `src/plugins/` | `app.use()` 类插件（pinia、i18n），自动收集 | [添加插件](./plugins) |
| `src/modules/` | 本地模块：可以直接 `npm publish` 的包 | [创建模块](./modules) |
| `src/workers/` | Worker 脚本，构建成 `/workers/<name>.js` | [事件、网络与状态](./events-and-data#worker) |
| `src/main.dart` | 项目级的 Dart 代码，注入 Flutter 宿主 | [Flutter 宿主](./flutter-host) |
| `public/` | 原样拷贝的静态文件，按根路径访问 | [静态资源](./assets) |
| `html/` | 给 `<web-view>` 打开的本地网页 | [静态资源](./assets) |

## 入口：`src/main.ts`

```ts
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import { plugins } from 'fjs/plugins';
import Shell from './Shell.vue';

createFjsApp({
  routes,
  plugins,
  shell: Shell,
}).mount();
```

这里导入的 `fjs/*` 都不是真实存在的 npm 包，而是**构建时解析的虚拟模块**：

| 导入 | 是什么 |
|---|---|
| `fjs/app` | `createFjsApp`：按平台创建应用。Flutter 上每个路由是一个原生页面；Web 上是 vue-router |
| `fjs/pages` | 扫描 `src/pages/**/*.vue` 生成的**路由表** |
| `fjs/plugins` | 收集 `src/plugins/*.ts` 和模块组件生成的**插件列表** |
| `fjs` | 运行时 API：`invokeHost`、`fetch`、`toast`、element API 等 |
| `fjs/router` | `useRouter` / `useRoute` / `onPageSettled` |

同一份 `main.ts` 在各端都能跑，因为构建时 `fjs/app`、`fjs/router` 会被 alias 到对应平台的实现。你的业务代码不需要写任何 `if (isWeb)`。

## 外壳：`src/Shell.vue`

```vue
<template>
  <safe-area>
    <view class="shell">
      <slot />
    </view>
  </safe-area>
</template>
```

`shell` 包在**每一个**页面外面，页面内容放进它的默认插槽。它还会拿到一个 `route` prop（当前页的 path、query、meta），所以导航栏、tabBar 这类每页都有的东西只写一次：

```vue
<script setup lang="ts">
import type { RouteLocation } from 'fjs/router';
defineProps<{ route: RouteLocation }>();
</script>

<template>
  <safe-area>
    <view class="shell">
      <text class="nav-title">{{ route.meta.title }}</text>
      <scroll-view class="body"><slot /></scroll-view>
    </view>
  </safe-area>
</template>
```

::: tip 注意标签
你会发现模板里写的不是 `div` / `span`，而是 `view` / `text` / `safe-area`。这些是 ufjs 的**内置标签**，在 Flutter 上对应 Widget，在浏览器里对应 DOM 组件，在小程序里对应同名组件。见[内置组件](./components)。
:::

## 页面：`src/pages/index.vue`

```vue
<route>
{"title": "my-app"}
</route>

<template>
  <view class="page">
    <text class="title">my-app</text>
  </view>
</template>

<style scoped>
.page { flex-grow: 1; align-items: center; justify-content: center; }
.title { font-size: 24px; font-weight: 700; color: #111827; }
</style>
```

除了标准的 `<template>` / `<script>` / `<style>`，页面还可以有一个 `<route>` 块，里面是 JSON：`title` 等字段会进 `route.meta`，`platforms` 可以限制页面只在某一端出现。

## 配置文件

### `package.json` 的 `fjs` 字段

构建相关的配置写在 `package.json` 的 `fjs` 字段里（默认没有，需要时再加）：

```json
{
  "fjs": {
    "shared": ["pinia"],
    "performance": { "nodeBudget": 800 },
    "mp": { "exclude": ["example/"] }
  }
}
```

完整字段见[配置参考](/reference/config)。

### `app.config.ts`

原生应用本身的配置：

```ts
import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
  version: '1.2.0+3',
  android: {
    applicationId: 'com.acme.demo',
    permissions: ['android.permission.INTERNET'],
  },
  ios: {
    bundleIdentifier: 'com.acme.demo',
    infoPlist: { NSCameraUsageDescription: '用于扫描二维码' },
  },
  wxmp: { appid: 'wx1234567890abcdef' },
});
```

`fjs run` 生成 Flutter 宿主时会把这些写进 `AndroidManifest.xml`、`Info.plist`、`pubspec.yaml`。

### `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fjs } from '@ufjs/cli/vite';

export default defineConfig({
  plugins: [fjs(), vue()],
  build: { outDir: 'dist/web' },
});
```

只有浏览器端用它。`fjs()` 插件负责生成虚拟模块、把内置标签映射到 DOM 组件、改写 fjs 特有的 CSS。

### `tsconfig.json` 与 `fjs-global.d.ts`

```jsonc
{
  "vueCompilerOptions": {
    "plugins": ["@ufjs/runtime/volar"],  // 让 Volar 按 fjs 的类型理解 text/image/button…
    "strictTemplates": true
  }
}
```

```ts
// src/fjs-global.d.ts
/// <reference types="@ufjs/runtime/ambient" />   // 所有 fjs/* 虚拟模块的类型
import '@ufjs/runtime/vue-global';                 // 内置标签的 props / 事件类型
```

有了这两处，编辑器里写 `<image mode="...">` 会有补全，属性写错是编译错误。

## 自动生成的文件

构建、`fjs dev` 或 Vite 启动时，工具链会在 `src/` 下生成几份声明文件，给编辑器提供补全。**不要手改，也不要提交**（模板的 `.gitignore` 已经忽略）：

| 文件 | 内容 |
|---|---|
| `src/fjs-routes.d.ts` | 路由名 → 路径，`router.push({ name })` 有补全和拼写检查 |
| `src/fjs-modules.d.ts` | 本地模块的裸导入类型 |
| `src/fjs-components.d.ts` | 模块提供的全局组件类型 |
| `src/fjs-assets.d.ts` | `public/`、`html/` 下的文件，`<image src>` 有补全 |

## 构建产物

| 目录 | 由谁产生 | 内容 |
|---|---|---|
| `dist/app/` | `fjs build` | App 端 JS bundle / `.fjsbundle` 字节码 |
| `dist/web/` | `vite build` / `fjs build --web` | 静态站点 |
| `dist/mp/` | `fjs build --mp` | 小程序工程，用微信开发者工具打开 |
| `.fjs/flutter/` | `fjs run` / `fjs build --release` | **生成的 Flutter 宿主工程** |

`.fjs/flutter` 是一个完整的 Flutter 项目，被 gitignore，随时可以删掉重建。当你需要长期改它（签名、原生插件）时，用 `fjs host eject` 把它移进仓库，见 [Flutter 宿主](./flutter-host)。

## 阅读示例项目

仓库里有几个完整示例，是学习写法的最好材料：

| 示例 | 看什么 |
|---|---|
| [`examples/hello-fjs`](https://github.com/snice/ufjs/tree/main/examples/hello-fjs) | **组件画廊**，所有内置组件、路由、tabBar、主题切换、canvas、WebGL、Worker，同时跑 Flutter / Web / 小程序 |
| [`demo`](https://github.com/snice/ufjs/tree/main/demo) | 标准 Vue 3 + Vite 项目，含 pinia、fetch、拖拽、模块 `@ufjs/iconmind` |
| [`examples/hello-js`](https://github.com/snice/ufjs/tree/main/examples/hello-js) | 不用 Vue，直接调 element API |
| [`packages/fjs-iconmind`](https://github.com/snice/ufjs/tree/main/packages/fjs-iconmind) | 一个完整的**模块**：API + Flutter Widget + Web 替身 + 构建钩子 |

推荐的阅读顺序：先看 `hello-fjs/src/main.ts` 和 `Shell.vue`（外壳怎么做 NavBar 和 TabBar），再看 `src/pages/index.vue`（首页怎么读路由表生成目录），然后挑感兴趣的组件页看。
