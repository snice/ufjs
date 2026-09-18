# 页面与路由

ufjs 用**文件路由**：`src/pages/` 下的每个 `.vue` 文件就是一个页面。同一套 API 在 App 上驱动 Flutter 原生页面栈，在浏览器上驱动 vue-router。

## 文件即路由

```text
src/pages/index.vue          →  /              名字 index
src/pages/about.vue          →  /about         名字 about
src/pages/comp/button.vue    →  /comp/button   名字 comp-button
src/pages/user/[id].vue      →  /user/:id      名字 user-id
src/pages/[...all].vue       →  /*             名字 all（兜底页）
```

- 文件名转 kebab-case：`ButtonPage.vue` → `/button-page`
- `index.vue` 取父目录的路径
- `[id]` 是动态段，`[...rest]` 是 catch-all

查看当前完整路由表：

```bash
npx fjs routes                  # PATH / NAME / CHUNK / TARGET / FILE / META
npx fjs routes --platform web   # 只看 Web 端会包含的页面
```

两个文件命中同一路径时会给出告警。

## 生成页面

```bash
npx fjs create page about --title 关于       # src/pages/about.vue
npx fjs create page user/[id]               # 带动态段，模板顺手写好 useRoute()
npx fjs g page settings --platform app      # 只在 App 端存在的页面
npx fjs g page home --tab 0                 # tab 页
```

| 参数 | 说明 |
|---|---|
| `--title <text>` | 写进 `<route>` 的标题 |
| `--tab <n>` | 写进 `<route>` 的 tab 序号 |
| `--path <route>` | 覆盖由文件名推出的路径 |
| `--route-name <name>` | 覆盖由路径推出的名字 |
| `--platform <app\|web>` | 限定平台 |
| `--dry-run` / `--force` | 只打印 / 覆盖已有文件 |

## `<route>` 块

页面里可以写一个 `<route>` 块，内容是 JSON：

```vue
<route>
{ "title": "按钮", "group": "表单组件", "platforms": ["app"], "transition": "fjs-slide-up" }
</route>
```

- `path`、`name`、`platforms` 由生成器读取
- **其余所有字段都进 `route.meta`**，你可以放任何自定义数据（比如 `group`）
- `platforms` 缺省是 `["app", "web"]`。写 `["app"]` 表示只有 App 端有这个页面 —— Web 构建的路由表里根本不会出现它，代码也不会进 Web 产物。也可以用文件名后缀简写：`about.app.vue` / `about.web.vue`

因为路由表就是「当前平台真正存在的页面」，目录页可以直接读它：

```ts
import { routes } from 'fjs/pages';
const items = routes.filter((r) => r.meta?.group === '表单组件');
```

## 跳转与取参

`fjs/router` 是 vue-router 的一个子集，语义对齐：

```ts
import { useRouter, useRoute } from 'fjs/router';

const router = useRouter();
router.push('/comp/button');                          // 原生 push，有转场、可手势返回
router.push({ path: '/detail', query: { id: '3' } });
router.push({ name: 'user-id', params: { id: 7 } });  // 名字有类型检查
router.replace('/api');                               // 原地换页，不进栈（切 tab 用它）
router.back();                                        // = 平台返回
router.go(-2);                                        // 只支持负数

const route = useRoute();   // 响应式：path / params / query / meta / fullPath
```

- `useRoute()` 返回的是**当前组件所在页面**的 route，不是全局栈顶
- `params` / `query` 的值**永远是字符串**，已经 `decodeURIComponent`
- catch-all 页匹配到的那段在 `route.params.pathMatch` 里（不带前导斜杠）
- route 是响应式对象，派生值用 `computed`，别在 setup 里解构

### 路由名的类型提示

工具链把路由表写成 `src/fjs-routes.d.ts`，所以：

```ts
router.push({ name: 'user-id', params: { id: 7 } });   // ✅ 有补全
router.push({ name: 'user-idd' });                     // ❌ 编译错误：Did you mean "user-id"?
router.push('/user/7');                                // 路径只提示，不拦
```

CI 里想要这层校验，在 `vue-tsc` 之前先跑一次 `fjs build`（或 `vite build`）生成它。

## 页面外壳 Shell

`createFjsApp({ shell })` 的 shell 组件包在每个页面外面，拿到 `route` prop。导航栏、tabBar 写在这里一次即可：

```vue
<!-- src/Shell.vue -->
<script setup lang="ts">
import type { RouteLocation } from 'fjs/router';
defineProps<{ route: RouteLocation }>();
</script>

<template>
  <safe-area>
    <view class="shell">
      <NavBar :title="String(route.meta.title ?? '')" />
      <scroll-view class="body"><slot /></scroll-view>
      <TabBar v-if="typeof route.meta.tab === 'number'" :active="route.meta.tab" />
    </view>
  </safe-area>
</template>
```

`examples/hello-fjs/src/Shell.vue` 是一个完整的参考实现。

::: tip 长列表页面不要套滚动容器
如果某个页面自带 `list-view` 长列表，外壳的 `scroll-view` 会让它失去虚拟化。hello-fjs 的做法是在页面上写 `<route>{"scroll": false}</route>`，外壳读 `route.meta.scroll` 决定要不要包 `scroll-view`。
:::

## Tab 页

`meta.tab` 为数字的页面算作一组 tab 页。在 tab 页之间用 `router.replace` 切换时，**离开的那页不会销毁**：滚动位置、输入框、请求回来的数据都保留。

- 保活只在 tab 组内有效；`replace` 到非 tab 页，整组缓存丢掉
- 被保活的页面没有暂停：定时器、动画还在跑
- 默认 tab 切换**没有转场动画**

## 转场动画

```ts
createFjsApp({
  routes, shell,
  transition: 'fjs-slide',                                     // 全 app 统一
  // transition: false,                                        // 全关
  // transition: (nav) => (nav.kind === 'push' ? 'fjs-page' : false),
});
```

单个页面在 `<route>` 里写 `"transition": "fjs-slide-up"` 或 `false`。

| 名字 | 效果 |
|---|---|
| `fjs-page`（默认） | 各平台自带转场：iOS Cupertino、Android 看主题，Web 轻微右滑淡入 |
| `fjs-slide` | iOS 式整页右滑，**各端一致** |
| `fjs-fade` | 淡入淡出 |
| `fjs-slide-up` | 从底部升起（模态页） |
| `fjs-zoom` | Material 3 缩放淡入 |
| `false` | 无动画（返回手势照常可用） |

`nav.kind` 有五种：`initial`、`push`、`replace`、`pop`、`tab`。

## 页面生命周期

- `push` 进来的页面在返回后**卸载**（和原生一致），`onUnmounted` 照常触发
- 转场期间别做重活：JS 跑在 UI 线程上，一段重计算会让转场卡住。用 `onPageSettled` 等转场结束：

```ts
import { onPageSettled } from 'fjs/router';

onPageSettled(() => {
  buildTheExpensiveChart();   // 转场动画跑完才执行
});
```

它最多触发一次，没有转场的页面（首页、tab 切换）立即算 settled。原因见[线程模型](/advanced/threading)。

## Flutter 上发生了什么

App 端每个路由是一个真实的 Flutter `Route`，页面代码按需加载（分包构建时一页一个 chunk）。一次 `push` 大致是：

1. JS 解析路由，调宿主 `fjs.nav.push`
2. Dart 立刻开始原生转场，同时异步加载该页 chunk
3. chunk 加载完回派 `navMount`，JS 创建这一页的 Vue app 挂上去

所以转场不会等 JS 加载。细节见[原理：分包与热更新](/advanced/bundling)。
