# 仓库地图

这一部分写给想读 ufjs 自身源码、排查框架层问题、或者给 ufjs 贡献代码的人。先看全局，再看[沿一次点击读源码](./reading-path)，最后是[本地开发与调试](./contributing)。

```bash
git clone https://github.com/snice/ufjs && cd ufjs
```

## 顶层目录

| 路径 | 语言 | 是什么 |
|------|------|--------|
| `packages/fjs` | TS | npm 包 `@ufjs/cli`：命令行、打包、dev server、小程序编译 |
| `packages/fjs-runtime` | TS | npm 包 `@ufjs/runtime`：element API、op 编码、Vue 渲染器、CSS 引擎、路由、Web 适配层、wx 运行时 |
| `packages/flutter_fjs` | Dart + C++ | pub 包 `flutter_fjs`：QuickJS 引擎、FFI、镜像树、Widget 渲染 |
| `packages/fjsc` | C++ 产物 | 字节码编译器（按平台发 npm 的预编译二进制） |
| `packages/fjs-iconmind` `fjs-webview` `fjs-webgl` `fjs-spine` | TS + Dart | 官方模块，也是写模块的范例 |
| `demo` | Vue | 标准 Vue 3 + Vite 项目，create → run → build 的回归验证场 |
| `examples/hello-fjs` | Vue | 组件画廊，多端同源 |
| `examples/hello-js` | TS | 不用框架，直接调 element API |
| `examples/fjs-go` | Dart | 调试客户端 App |
| `examples/bench` | Vue | 性能基准 |
| `docs/` | md | 技术文档（面向框架开发者，比本站更细） |
| `specs/` | md | 每个需求一个目录：spec / plan / tasks，记录了每个设计决策的来龙去脉 |

JS 侧是 pnpm workspace，Flutter 侧走 pub 的 path 依赖。

## 三层对应三个包

```text
@ufjs/cli (packages/fjs)          构建期：把你的源码变成 bundle / 字节码 / 小程序
        │
@ufjs/runtime (packages/fjs-runtime)   运行期 JS：打进 bundle，跑在 QuickJS 里
        │  JSI
flutter_fjs (packages/flutter_fjs)     运行期原生：C++ 引擎 + Dart 渲染
```

## `packages/fjs`：CLI

```text
src/
  cli.ts              命令分发入口（esbuild entry → dist/cli.js）
  vite.ts             Vite 插件 fjs()（esbuild entry → dist/vite.js）
  config.ts           defineConfig（@ufjs/cli/config）
  commands/           一个命令一个文件：create、run、host、add、module、doctor…
  bundler/            esbuild 层：build.ts（含分包）、vue-plugin.ts（SFC 编译）、analyze.ts
  dev/                dev server：server.ts、热更新判断、局域网发现、二维码
  mp/                 小程序编译：wxml.ts、script.ts、css.ts、project.ts、subpackage.ts
  project/            读用户工程：config.ts（fjs 字段）、pages.ts（路由扫描）、plugins.ts、modules.ts、assets.ts
  registry/           fjs add 的数据：packages.json
  template/           create 用的项目模板
```

想知道某条命令做了什么，从 `src/commands/<命令>.ts` 读起。`fjs run` 生成宿主的全部逻辑在 `commands/run.ts`（`ensureFlutterHost`、`writeHostPubspec`、`writeHostMain`）。

## `packages/fjs-runtime`：运行时

```text
src/
  index.ts            'fjs' 的导出：element API、invokeHost、fetch、toast…
  ui/
    element.ts        element API + 事件注册表 + __fjsDispatchEvent
    ops.ts            op 帧编码（和 Dart 的 ui_ops.dart 是同一协议的两半）
    touch.ts          触摸事件对象
  vue/renderer.ts     Vue 自定义渲染器（nodeOps + patchProp）
  css/                CSS 引擎：parser.ts 解析、style.ts 级联 / 继承 / :active
  app/                createFjsApp：flutter.ts / web.ts 两份实现
  router/             fjs/router：flutter.ts / web.ts / match.ts / settled.ts
  components/         用 JS 拼出来的标签：canvas、textarea、picker、form、rich-text
  canvas/             2D 状态机与绘制命令编码
  net/fetch.ts        fetch 实现
  host.ts             invokeHost、timers、toast
  host-async.ts       invokeHostAsync
  worker.ts           Worker
  web/                Web 端：内置标签的 DOM 组件、基础样式表、CSS 改写
  wx/                 小程序端运行时：reactivity 胶水、事件、路由、fetch
  tags.json           内置标签清单（唯一来源，d.ts 和 Volar 数据都从它生成）
  vue-global.d.ts     内置标签的 props / 事件类型
  native-global.d.ts  __fjs 的类型（JSI 边界唯一的类型描述，手写）
```

## `packages/flutter_fjs`：Flutter 插件

```text
native/
  quickjs/            内嵌的 QuickJS-ng 源码
  include/fjs.h       纯 C ABI（Dart FFI 绑定的就是它）
  src/vm.cpp          VM 生命周期、eval、字节码加载、事件派发、pump
  src/natives.cpp     JS 可调用的原生函数（uiOps、invokeHost、fibonacci…）
  tools/fjsrun.cpp    不起 Flutter 跑 bundle 的命令行工具
  tools/fjsc.cpp      字节码编译器
lib/src/
  ffi.dart            FFI 绑定
  engine.dart         FjsEngine：VM 宿主、host 注册表、事件派发、dev 连接
  dev_client.dart     连接 dev server、热更新
  mirror_tree.dart    镜像树，applyFrame
  ui_ops.dart         op 帧解码
  fjs_app.dart        FjsApp：JS 路由驱动的 Navigator
  fjs_view.dart       FjsView：渲染一棵根子树
  render/             renderer.dart（标签分发）、flex.dart、style.dart、gesture.dart…
  widgets/            单个标签的 Widget：button、input、swiper、list_view…
  registry/           宿主函数与自定义组件注册表
  canvas/             画布显示列表解码与回放
  http.dart           fetch 的 Dart 侧
  worker.dart         Worker isolate
tool/                 预编译产物的构建脚本（Android / Apple / 鸿蒙）
```

## 必须成对修改的文件

这几处是同一个契约的多份实现，**改一处必须改全**，否则表现为静默错位而不是报错：

| 契约 | 文件 |
|---|---|
| op 帧协议 | `fjs-runtime/src/ui/ops.ts` ↔ `flutter_fjs/lib/src/ui_ops.dart` ↔ `native/tools/fjsrun.cpp` |
| 事件编号 | `fjs-runtime/src/ui/element.ts` 的 `EventType` ↔ Dart 的 `FjsEvent` ↔ `fjs.h` |
| JSI 类型 | `native/src/natives.cpp` ↔ `fjs-runtime/src/native-global.d.ts` |
| 内置标签 | Dart `widgets/` ↔ `fjs-runtime/src/web/components/` ↔ 小程序映射 `fjs/src/mp/wxml.ts` |

## 读源码的建议顺序

1. 先读仓库 `docs/principles.md`（或本站[原理总览](/advanced/overview)），建立五个基本决策的心智模型
2. 跑一遍 `examples/hello-js`，读它的 `src/main.ts` —— 没有 Vue，只有 element API，最容易看清数据流
3. 按[沿一次点击读源码](./reading-path)把 JS → C++ → Dart → Widget 串起来
4. 再读 `vue/renderer.ts`，看 Vue 是怎么坐到 element API 上的
5. 需要改哪一块，再去读 `specs/` 里对应的 spec，了解当时的取舍
