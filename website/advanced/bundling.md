# 分包、字节码与热更新

## 构建工具链

App 端用 **esbuild** 打包（不是 Vite），由 `@ufjs/cli` 的 `bundler/` 负责：

```text
src/main.ts ─┐
.vue SFC     ├─► esbuild + fjs 的 Vue 插件 ─► dist/app/*.js ─► fjsc ─► *.fjsbundle
npm 依赖     ┘     （SFC 编译、虚拟模块、           （JS）         （引擎字节码）
                    CSS 注入、alias）
```

fjs 的 esbuild 插件做了这几件事：

- **编译 SFC**：用 `@vue/compiler-sfc`，给 `isNativeTag` 传入内置标签表，让 `<view>`、`<text>` 被当作元素而不是组件
- **生成虚拟模块**：`fjs/pages`（扫 `src/pages`）、`fjs/plugins`（扫 `src/plugins` 和模块组件）
- **注入样式**：`<style>` 块原样注入运行时 CSS 引擎
- **alias**：`vue` → `@vue/runtime-core`（不拉 DOM 运行时），`fjs/router` → Flutter 实现
- **桩掉 Node 内置模块**：`util`、`fs` 等指向调用即抛的桩，只 import 不调用的库能过

esbuild 以 `platform: 'neutral'`（JS 引擎环境既不是 Node 也不是浏览器）输出 IIFE 格式的单文件。

## pages 分包

`fjs build --pages` 把产物拆成三种：

| 产物 | 内容 | 什么时候加载 |
|---|---|---|
| `shared.js` | Vue、@ufjs/runtime、Shell、公共组件、被多页引用的模块 | 启动时一次，挂到 `globalThis.__FJS_SHARED` |
| `bundle.js` | 入口（`main.ts` 自己，通常只有几 KB） | 启动时 |
| `pages/<chunk>.js` | 单个页面自己的代码 | 进入这个页面时 |

**哪些模块进 shared 是自动算的**：先跑一次 esbuild 探测，统计每个模块被哪些入口引用。入口可达的、被两个以上页面引用的进 shared；页面文件本身永远是独立 chunk。

页面 chunk 对共享模块的引用被改写成从 `__FJS_SHARED` 取，所以**所有页面拿到的是同一个实例** —— 模块级的 store、缓存天然跨页共享。第三方库默认不在共享名单里，带模块级状态的要登记 `fjs.shared`（见[添加插件](/guide/plugins#fjs-shared-带模块级状态的库)）。

hello-fjs 实测：

```text
shared.fjsbundle              1,210,078 B   ← 每个 VM 装一次
bundle.fjsbundle                  6,163 B
pages/comp-button.fjsbundle      23,811 B   ← 进这个页面才加载
```

### 页面 chunk 怎么被加载

```dart
engine.addPrelude(shared);                          // reset 时会自动重放
engine.chunkLoader = (chunk) async => loadChunk(chunk);
engine.runBundle(bundle);
```

`router.push` 时，Dart 立刻开始原生转场，同时异步调用 `chunkLoader` 取回该页 chunk、在同一个 VM 里执行，完成后回派 `navMount`，JS 才把页面挂上去。**转场不等 JS。**

没有 `src/pages` 的项目（比如纯 element API 项目）不分包，因为 shared 里的 Vue 它根本用不到。

## 字节码

`--release` 自动开启 `--bytecode`：用 `fjsc` 把每个 JS 产物编译成引擎字节码。

```text
.fjsbundle 格式
[0..4)   magic "FJSB"
[4..6)   u16 格式版本
[6..8)   u16 engine id 长度
[8..]    engine id + 引擎字节码
```

App 加载时用 `JS_ReadObject` 直接读入，跳过词法和语法分析。加载前校验 magic、格式版本和 **engine id**（`primjs-4.1.1` 或 `quickjs-ng-0.9.0`）—— fjsc 和 App 必须是同一 flavor 的引擎，id 不一致会直接拒绝加载，而不是运行到一半崩溃。默认 flavor 是 PrimJS，`fjs build --js-engine quickjs` 可切到 quickjs-ng；引擎性能差异见仓库的 [engine-perf.md](https://github.com/snice/ufjs/blob/main/docs/engine-perf.md)。

`fjsc` 随 `@ufjs/cli` 按平台安装（`@ufjs/fjsc-<平台>`）。查找顺序：环境变量 `FJSC_PATH` → ufjs 仓库内自编的版本 → npm 包。

`--gz` 会把复制进宿主的 `.fjsbundle` 再 gzip，启动时自动解压。

## 热更新

dev server（`fjs dev --pages`，默认端口 38900）提供：

| 路径 | 内容 |
|---|---|
| `/manifest.json` | 分包清单 |
| `/shared.js` `/bundle.js` `/pages/<chunk>.js` | 源码形式的 bundle |
| `/ws` | WebSocket，推送 reload 指令 |

文件变化后，dev server 判断改动范围，推送两档里较小的那一档：

| 改动 | 推送 | 设备行为 |
|---|---|---|
| 页面独占的代码 | `reload pages:<chunk>` | 只重新执行该页 chunk 并重挂 |
| Shell、共享组件、共享 ts、入口、路由表、配置 | `reload` | 销毁并重建整个 VM |

共享模块打进 `shared.js`，页面通过 `__FJS_SHARED` 取同一份实例。release 构建没有热更新。

### 完整重建为什么安全

`engine.reset()` 销毁整个 VM，所有全局对象随之消失。shared prelude 由引擎在新 VM 里自动重新执行，宿主不需要关心顺序 —— 这是 dev 热更新能只推变更 chunk 的前提。

## 连接 dev server

`fjs run` 通过 `--dart-define=FJS_DEV=<host:port>` 把地址注入 App。fjs go 则通过扫码、局域网 UDP 广播发现或手输获得地址。

App 启动时拉取 manifest、prelude、bundle，失败会按 1→2→3→5→8 秒退避重试、之后固定 8 秒，不设上限 —— 因为 iOS 的网络授权弹窗是异步的，弹出来时第一次请求早已失败。授权后几秒内自动连上，不需要重启 App。

`fjs log` / `fjs eval` 也连的是 dev server：它们自报「工具」身份，由 dev server 转发给应用。`fjs eval` 的返回值走日志通道回来，所以不需要为它新增任何消息类型。
