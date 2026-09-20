# ufjs 文档

按**由浅入深**分四层。想快速上手看第 0 层；想改 fjs 自身，从第一层开始按序读。

> AI agent 请先读根目录的 [AGENTS.md](../AGENTS.md) —— 会话第一步是执行 `/spec`。

---

## 第 0 层 · 用起来

不改 fjs 自身，只用它做应用。

```bash
npx @ufjs/cli create my-app && cd my-app && npm install
npm run dev:pages     # App 端 dev server，用 fjs go 扫码连接
npm run dev:web       # 浏览器
npx fjs build --mp    # 微信小程序，产物 dist/mp/，用微信开发者工具打开
npm run run:android   # 直接跑到设备
npm run build:release # 发布构建（split bytecode → Flutter assets）
```

同一份源码编译到三个目标：Flutter 应用（Android / iOS）、浏览器静态站点、
微信小程序（Skyline + glass-easel）。

1. [工具链：创建 / 运行 / 测试 / 编译](toolchain.md)
2. [fjs go 调试客户端](fjs-go.md)
3. [Vue 3 集成](vue3.md)
4. [路由](routing.md)
5. [UI API 参考（标签 / 事件 / 样式）](ui-api.md)
6. [小程序编译](miniprogram.md)

---

## 第一层 · 原理

fjs 是怎么成立的。**改任何一层之前先读完这四篇。**

| # | 文档 | 一句话 |
|---|------|--------|
| 1 | [原理：为什么是这个形状](principles.md) | 嵌引擎、JSI 直调、二进制帧、渲染层框架无关、两端同源，五个基本决策 |
| 2 | [线程模型与执行时序](threading-model.md) | JS 在 UI isolate 上同步跑；一次点击的完整时序；Worker |
| 3 | [整体架构与关键文件索引](architecture.md) | 分层图、op 协议表、每一层在哪个文件 |
| 4 | [JSI 与原生模块](jsi-and-native-modules.md) | 三条通信通道、写 C++ native、内存契约、fetch 范式 |

---

## 第二层 · 渲染

界面是怎么画出来的，以及怎么换一个前端框架。

QuickJS 上实现的是一套**框架无关的命令式 element API**，前端框架只是它上面的
一层适配器 —— Vue 3 已实现，React / Solid 接的是同一组函数。

| # | 文档 | 一句话 |
|---|------|--------|
| 5 | [自定义渲染器](custom-renderer.md) | element API → Vue renderer 参考实现 → **接 React 的步骤** |
| 6 | [UI API 参考](ui-api.md) | 标签全集、事件表、样式键清单、触摸事件 |
| 7 | [Web CSS 兼容清单](css-compat.md) | **选择器 / 属性支持矩阵**，加新 CSS 能力先改这张表 |
| 8 | [Web 平台适配](web.md) | 一份源码怎么同时跑浏览器；已知差异 |
| 9 | [Vue 3 集成](vue3.md) | SFC、scoped style、CSS 变量、编辑器提示、第三方组件库兼容（DOM 模拟，vant 落法） |
| 9.5 | [小程序编译](miniprogram.md) | `fjs build --mp`：Skyline + glass-easel，模板编译为 WXML，不引入 Vue 运行时 |

---

## 第三层 · 扩展

在不动引擎的前提下加能力。

| # | 文档 | 一句话 |
|---|------|--------|
| 10 | [模块扩展](modules.md) | 一个 npm 包同时带 JS API + Vue 组件 + Flutter widget，装上即 autolink |
| 11 | [路由](routing.md) | `src/pages` 自动生成、原生 Navigator、转场 |
| 12 | [分包与 release assets](code-splitting.md) | shared prelude + 每页一个 chunk |

---

## 第四层 · 工程

仓库本身怎么维护。

| # | 文档 | 一句话 |
|---|------|--------|
| 13 | [pnpm monorepo 规范](monorepo.md) | npm 与 pub 两套包管理的边界、依赖写法、加包流程 |
| 14 | [工具链](toolchain.md) | 全部 CLI 命令 |
| 15 | [发布 npm 与 pub.dev](publishing.md) | 三个包版本咬合、预编译产物 |
| 16 | [性能测试](performance.md) | 基准方法、实测数据、热点 |
| 17 | [Roadmap](roadmap.md) | 已交付 / 近期 / 中期 / 远期 |

---

## 按任务找文档

| 我要… | 读 |
|---|---|
| 加一个 CSS 属性 | [css-compat.md 第 6 节](css-compat.md#6-加一条新的-css-支持要改哪些地方) |
| 加一个内置标签 | [ui-api.md](ui-api.md) + [custom-renderer.md](custom-renderer.md) + [css-compat.md](css-compat.md) |
| 加一个原生能力（相机、蓝牙…）| [jsi-and-native-modules.md](jsi-and-native-modules.md) + [modules.md](modules.md) |
| 接 React / 其他框架 | [custom-renderer.md](custom-renderer.md) |
| 编译微信小程序 / 排查小程序端差异 | [miniprogram.md](miniprogram.md) |
| 改 UI op 协议 | [principles.md](principles.md) + [architecture.md](architecture.md)，两侧文件必须同改 |
| 排查两端表现不一致 | [css-compat.md 第 5 节](css-compat.md#5-其他已知的两端差异) + [web.md 已知差异](web.md#已知差异) |
| 排查发布产物问题 | [code-splitting.md 排查清单](code-splitting.md) + [publishing.md](publishing.md) |
| 加一个 workspace 包 | [monorepo.md 第 5 节](monorepo.md#5-加一个新包) |
| 在 demo/example 里用仓库内的包 | [monorepo.md 第 3 节](monorepo.md#3-在-workspace-里装一个本地包) |
| 卡帧 / 列表慢 | [threading-model.md](threading-model.md) + [performance.md](performance.md) |
| 页面打开慢（vant / 第三方组件库） | [vant-mount-perf.md](vant-mount-perf.md) |
| 拆 `[nav] mounted` 临时打点 | [navmount-probe.md](navmount-probe.md) |

---

## 不可协商的约束

写代码前请读 [.specify/memory/constitution.md](../.specify/memory/constitution.md)。
七条，最常踩的三条：

1. **两端同源** —— 任何能力 Flutter 和 Web 都要有，只做一端是未完成
   （小程序端的映射与差异见 [miniprogram.md](miniprogram.md)）
2. **边界即契约** —— op 协议 / natives 表 / 事件类型，改一侧必改另一侧
3. **静默失效是 bug** —— 不支持的东西要 `warnOnce`，不能悄悄丢
