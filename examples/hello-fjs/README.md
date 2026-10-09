# hello-fjs — 组件示例大全

小程序 / [hello uni-app](https://hellouniapp.dcloud.net.cn) 风格的组件画廊：
导航栏 + 分类手风琴 + 底部 tabBar，每个内置标签一个详情页。全部用 Vue 3 SFC
写成，**同一份源码跑 Flutter 和浏览器两个平台**。

```
index.html             # Vite 的 web 入口
vite.config.ts         # plugins: [fjs(), vue()]
src/
  main.ts              # createFjsApp({ routes, shell })，两平台通用
  Shell.vue            # 外壳：safe-area [导航栏 | 滚动页面 | tabBar]
  catalog.ts           # 首页目录：从生成的路由表里推导，不手写页面清单
  components/          # NavBar / TabBar / Panel（演示小节卡片）
                       #   页面里一律写 `@/components/Panel.vue`——`@/` 是
                       #   `src/`，Flutter / web / Vite 三条流水线都认
  pages/               # 文件即路由，每个文件带一个 <route> 块
    index.vue          #   /        内置组件（tab 0）
    api.vue            #   /api     toast / 定时器 / Worker / 引擎信息（tab 1）
    about.vue          #   /about   关于（tab 2）
    comp/*.vue         #   /comp/*  每个内置标签一个详情页（rich-text.vue 兼作
                       #   spec 034 的两端对拍页：段落 / 列表 / 表格 / 图片数）
```

## 跑起来

```bash
pnpm install
```

```bash
pnpm build             # Flutter：单包 dist/app/bundle.js
pnpm build:pages       # Flutter：分包 shared.js + bundle.js + pages/*.js
pnpm build:web         # 浏览器：vite build → dist/web（静态站点）
pnpm typecheck         # vue-tsc --noEmit
```

```bash
pnpm dev               # fjs dev（单包），配合 examples/fjs-go 连上
pnpm dev:pages         # fjs dev --pages（分包，验证 prelude + 按需 chunk）
pnpm dev:web           # vite，http://localhost:5173
```

跑到真机 / 模拟器上（首次会在 `.fjs/flutter/` 里生成 Flutter 宿主工程）：

```bash
pnpm run:android
pnpm run:ios
pnpm build:release     # 分包字节码拷进 .fjs/flutter/assets/fjs
pnpm build:apk         # 再跑一次 flutter build apk
```

Android release 运行前，如果 Flutter 使用的 JDK 与终端里的 Java 不一致，先指定 JDK 17：

```bash
flutter config --jdk-dir=$(/usr/libexec/java_home -v 17)
cd .fjs/flutter/android
./gradlew --stop
cd -
pnpm run:android
```

web 这一端有两条路，两条都从 `src/pages` 走同一张路由表、同一套平台门控：

- `pnpm dev:web` / `pnpm build:web` —— **标准 Vite**（`@vitejs/plugin-vue` +
  `@ufjs/cli/vite` 的 `fjs()` 插件）。HMR、`vite build` 的按页 chunk，跟普通
  Vue 3 + Vite 工程完全一样，`fjs create` 的模板给的也是这套。
- `pnpm dev:web:fjs` / `pnpm build:web:fjs` —— CLI 自带的 esbuild web 构建
  （`fjs build --web`），不需要 Vite。输出同样落在 `dist/web`。

不用 Flutter 也能看一眼帧输出：

```bash
../../packages/flutter_fjs/native/build-native/fjsrun dist/app/bundle.js
```

## 这个示例在验证什么

- **路由**：`router.push('/comp/button')` 在 Flutter 上是一个**原生 Navigator
  页面**（平台转场 + 手势返回），在 web 上是 vue-router。页面代码只写一次。
- **tabBar**：`router.replace('/api')`——栈里只有首页时原地换页，不进栈。
- **自动路由表**：`src/pages` 扫出来的，`catalog.ts` 直接读 `routes` 生成首页
  目录，所以不会出现「目录里有、页面没有」。
- **平台门控**：`pages/comp/refresh.vue` 的 `<route>` 里写了
  `"platforms": ["app"]`——下拉刷新是原生手势，web 构建里这一页整个不存在，
  首页手风琴也自动少一条。
- **手势 + 过渡**：示例页的「交互游戏 / 2048」一步滑动里不插入也不删除节点，
  16 个方块的位置和缩放都写在 `transform` 上，靠一条 `transition` 插值——
  两端同一套 CSS。
- **第三方动画库**：示例页「动画演示 / Anime.js」——Anime.js v4 动的是普通
  响应式对象，Vue 把值绑到 `transform` 上，两端同一份源码。App 端没有
  `window`，Anime.js 会去找 `setImmediate`，`src/adapters/anime/native-polyfills.ts`
  把它接到宿主的 `requestAnimationFrame` 上（必须在 `animejs` 之前 import）。
- **three.js 持续渲染**：示例页「交互游戏 / 3D 飞机大战」每帧几十个物体在动。
  `@ufjs/webgl` 没有 instanced draw，所以飞机零件合成一个 Mesh，子弹 / 碎片
  各用一块动态顶点缓冲一批画完，整场 draw call 控制在三十个以内。
- **PixiJS 消消乐**：示例页「交互游戏 / 消消乐 PixiJS」——第二个直接吃
  `@ufjs/webgl` 命令流的第三方渲染库。pixi v7 把 context 识别为 WebGL2 靠
  `instanceof WebGL2RenderingContext`，`src/adapters/pixi/native-shims.ts` 在原生宿主
  把伪造类插进 context 的原型链（web 上原生满足，模块整体 no-op），并把
  pixi 的 EventSystem 垫掉——触摸换算格子是页面自己的事。小程序构建里
  这一页被 `fjs.mp.exclude` 排除。
- **LeaferJS 消消乐**：示例页「交互游戏 / 消消乐 LeaferJS」——同一个玩法换成
  `@leafer-ui/miniapp` 画 canvas 2d，App / Web / 小程序三端同一份。
  `src/adapters/leafer/platform.ts` 在没有 `wx` 的两端给 Leafer 一个假宿主（离屏画布是
  空桩），关掉局部重绘，并给 App 端 context 补真正的 `roundRect`。代价是页面
  只能用直接画上屏的矢量图形：不用 Leafer 的 Text / 图片 / 分组透明度 / 交互。
  页面文件名刻意叫 `leafer-match3`：`fjs.mp.exclude` 是子串匹配，
  `match3-leafer` 会被 pixi 页那条 `example/game/match3` 一起排掉。
- **微信小游戏原样移植**：示例页「交互游戏 / 飞机大战（微信移植）」（specs/214）——
  微信官方示例小游戏整体拷进 `src/plane-war/minigame/`（唯一非原样文件是
  `js/libs/tinyemitter.js` 的两行 ESM 包装，UMD 原文件为 `tinyemitter.umd.cjs`
  字节未动），`src/plane-war/wx-adapter.ts` 补出 `wx.createCanvas /
  createImage / onTouch* / getWindowInfo` 和 `GameGlobal` 后直接跑。fjs canvas
  的 width/height 只读而 render.js 会赋值，适配层给的是可写包装；游戏传给
  `drawImage` 的图片壳经 ctx 代理换成 `loadCanvasImage` 句柄。生命周期同微信：
  离开页面（返回 / 被覆盖）即销毁——rAF 垫片按表取消游戏的挂起帧，重进就是
  全新一局。已知降级：音频静音、震动 no-op（ufjs 暂无音频能力）。注意
  `src/adapters/leafer/platform.ts` 的 wx 判定带 `createOffscreenCanvas` 特征
  校验——本页的全局 `wx` 不能让 leafer 误判成小程序。
- **分包**：`pnpm build:pages` 后 `dist/app/bundle.js` 只有 ~2.4 KB，vue + 运行时 +
  外壳都在 `shared.js` 里，每个页面 6–12 KB 按需加载。

细节见 [docs/routing.md](../../docs/routing.md)、[docs/web.md](../../docs/web.md)、
[docs/ui-api.md](../../docs/ui-api.md)。
