# 调试

## 先体检

```bash
npx fjs doctor
```

检查 Node 版本、是不是 fjs 项目、`@ufjs/cli` 与 `@ufjs/runtime` 版本是否匹配、字节码编译器 fjsc 从哪来、Flutter / adb / xcodebuild、可用设备、宿主的 `flutter_fjs` 来源。挡住构建的问题会让退出码为 1。

## 热更新

`fjs dev --pages`（`fjs run` 会自动启动它）按改动的范围选择最小的更新方式：

| 改了什么 | 设备上发生什么 |
|---|---|
| 页面自己的代码（页面 `.vue` 和只有它用的模块） | 只重新加载这一页，其它页面不动 |
| 多个页面共享的模块（公共组件、工具函数、store） | 同一个 JS 虚拟机里热替换这些模块并重挂受影响的页面；**页面栈和全局状态保留** |
| Shell、入口、路由表、`app.config.ts` | 整个虚拟机重建，回到首页 |

Web 端（`dev:web`）是 Vite 原生的组件级 HMR。

## dev server 终端快捷键

`fjs dev` 跑着的时候，终端本身就是控制台：

| 键 | 作用 |
|---|---|
| `r` | 完整重新构建并 reload（热更新判断出错时按它） |
| `l` | 开关应用日志 |
| `d` | 当前连着几个应用 |
| `c` | 再打印一次地址和二维码 |
| `p` | 在 App 上开关**性能面板** |
| `o` | `--web` 模式下用浏览器打开 |
| `q` | 退出 |

## 看日志

```bash
npx fjs log
```

实时查看 App 里的 `console.log` / `warn` / `error`。它连的是 dev server，所以模拟器、局域网真机、浏览器用法都一样，不需要 USB。

在 dev server 终端按 `l` 也能看到同一条日志流。`flutter run` 的输出里也有，前缀是 `[js:info]` 这样的格式。

## 在设备上求值

```bash
npx fjs eval '1 + 1'
npx fjs eval 'Object.keys(globalThis).length'
```

在正在运行的 JS 虚拟机里执行表达式，打印结果。排查「页面上到底是什么状态」时很好用。

## 性能面板

dev server 终端按 **`p`**，App 右上角浮出一个可拖动的面板：

```text
fps                3
ui        4.3/60.9 ms
gpu        1.3/2.7 ms
heap   4.6MB·14806
nodes            100
```

| 行 | 含义 |
|---|---|
| `fps` | 最近一秒真正画了多少帧（空闲时低是正常的） |
| `ui` | UI 线程耗时：均值 / 最坏值。**JS 也跑在这里** |
| `gpu` | 光栅线程耗时 |
| `heap` | JS 堆大小 · 活对象数 |
| `nodes` | 节点数 |

超过 16.7 ms 标红。最坏值不会随时间滚掉，收起再打开才重置 —— 刚点的那一下造成的卡顿会一直留在面板上等你看。

`ui` 高而 `gpu` 低：JS 或布局太重，考虑 `list-view`、组件拆分、`onPageSettled`。`gpu` 高：画的东西太复杂（阴影、裁剪、大图）。

## 体积分析

```bash
npx fjs build --pages --bytecode --analyze
```

按产物列出 JS / gzip / 字节码三个尺寸，以及每个产物里占比最大的包：

```text
shared.js  402.3 KB  gz 90.9 KB  bytecode 1.1 MB
  @vue/runtime-core                       254.5 KB   63.3%
  @vue/reactivity                          56.1 KB   14.0%
```

字节码那一列最值得盯：它决定冷启动要读多少。

## 首帧节点预警

构建时会静态估算每个页面首帧要创建多少节点，超过 500 个就输出 `[fjs perf]` 告警。可以调整预算：

```json
{ "fjs": { "performance": { "nodeBudget": 800 } } }
```

遇到告警，优先考虑 `list-view`、减少默认行数，或把非首屏内容延后渲染。

## Flutter 侧

生成的宿主是标准 Flutter 工程，Flutter DevTools、`flutter logs` 都能用：

```bash
cd .fjs/flutter
flutter analyze
```

用 fjs go 调试时，需要 Flutter DevTools 就装 debug 版 APK。

## 常见症状

| 症状 | 可能原因 |
|---|---|
| 真机连不上 dev server，`No route to host (errno = 65)` | iOS 本地网络 / 无线数据权限没给；手机和电脑不在同一网段 |
| 页面白屏，日志里有 `Maximum call stack size exceeded` | 页面文件名和内置标签同名，被当成组件自引用。加 `defineOptions({ name: 'XxxPage' })` |
| 某条 CSS 不生效 | 看日志里的告警：不支持的写法会告警一次，不会静默 |
| 两个页面的 pinia 状态不通 | store 实例建在插件函数里，或者没有登记 `fjs.shared` |
| `invokeHost: no native host` | 在 Web 端调用了宿主函数，加 `hasNativeHost` 判断 |
| 转场动画卡一下 | 页面 setup 里有重计算，挪进 `onPageSettled` |

更多见[常见问题](./faq)。
