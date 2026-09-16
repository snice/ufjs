# AGENTS.md — ufjs 的 AI 协作规范

> 这份文件是**给 AI agent（以及第一次进仓库的人）看的操作手册**。
> 面向用户的使用说明在 [README.md](README.md)，技术细节在 [docs/](docs/README.md)。

---

## 0. 会话第一条规则：先 spec，再动手

**本仓库采用 spec-kit 式的规范驱动开发（Spec-Driven Development）。
每个会话开始时，第一件事是执行 `/spec`，不是读代码，也不是改代码。**

```
/spec  <一句话需求>    →  specs/NNN-slug/spec.md    做什么、为什么、验收标准
/plan                  →  specs/NNN-slug/plan.md    改哪些层、哪些文件、什么顺序
/tasks                 →  specs/NNN-slug/tasks.md   可勾选的任务清单
/implement             →  按 tasks.md 顺序落地，逐条勾选
```

命令定义在 [.claude/commands/](.claude/commands/)，模板在
[.specify/templates/](.specify/templates/)，不可协商的工程约束（"宪法"）在
[.specify/memory/constitution.md](.specify/memory/constitution.md)。

**唯一豁免**：纯查询（"这段代码在干嘛"）、单行 typo、以及用户明确说
"不用 spec 直接改"。除此之外，**没有 spec.md 就不要写生产代码**。

跨会话续做：先 `ls specs/` 找到未完成的目录，读它的 `tasks.md`，从第一个
没勾选的任务继续 —— 不要新开一个 spec。

---

## 1. 这个项目是什么

用 **JS/TS + Vue 3 写业务，用 Flutter 做渲染**。JS 引擎（QuickJS-ng）以 C++
源码嵌进 Flutter 应用，JS 侧把节点操作编码成二进制帧，Dart 侧还原成 Widget 树。
同一份源码还能编译成浏览器静态站点和微信小程序（Skyline + glass-easel，
见 [docs/miniprogram.md](docs/miniprogram.md)）。

```
Vue 3 / TS / Vite  ──►  @ufjs/cli（打包、dev、字节码）
                              │
                   @ufjs/runtime（element API、UI 帧、Vue renderer、CSS 引擎）
                              │  JSI（JSValue 直传，无 JSON 桥）
                        libfjs（C++ / QuickJS-ng）
                              │  dart:ffi（纯 C ABI）
                       flutter_fjs（镜像树 → Flutter Widget）
```

一句话原理：**没有桥、没有序列化、没有跨线程**。细节见
[docs/principles.md](docs/principles.md)。

**渲染层框架无关**：QuickJS 上实现的是一套命令式 element API
（`create` / `insert` / `remove` / `setText` / `setProps`），框架适配层坐在它上面。
Vue（`createRenderer`）已实现；React（`react-reconciler`）、Solid
（`universal` runtime）理论上接同一组函数即可。**新增能力时不要把框架假设写进
element API 或 op 协议那两层** —— 判断标准和接入步骤见
[docs/custom-renderer.md](docs/custom-renderer.md)。

---

## 2. 仓库地图

| 路径 | 语言 | 是什么 | 改动前必读 |
|------|------|--------|-----------|
| `packages/fjs` | TS | npm 包 `@ufjs/cli`：create/dev/run/build + Vite 插件 | [toolchain.md](docs/toolchain.md) |
| `packages/fjs-runtime` | TS | npm 包 `@ufjs/runtime`：element API、op 编码、Vue renderer、CSS 引擎、web 适配层 | [custom-renderer.md](docs/custom-renderer.md) |
| `packages/fjs-iconmind` | TS+Dart | npm 包 `@ufjs/iconmind`：**模块扩展的完整范例** | [modules.md](docs/modules.md) |
| `packages/flutter_fjs` | Dart+C++ | pub 包 `flutter_fjs`：QuickJS-ng、FFI、镜像树、Widget 渲染 | [architecture.md](docs/architecture.md) |
| `packages/fjsc` | C++ 产物 | 字节码编译器（npm 分发的预编译二进制） | [toolchain.md](docs/toolchain.md) |
| `demo` | Vue | 标准 Vue3+Vite demo，create→run→build 的回归验证场 | — |
| `examples/hello-fjs` | Vue | 组件画廊，同源跑 Flutter 与 Web | — |
| `examples/hello-js` | TS | 底层 element API 示例 + 不经过 Vue 的主题压测屏 | — |
| `examples/fjs-go` | Dart | 调试客户端 App，连任意 `fjs dev` | [fjs-go.md](docs/fjs-go.md) |
| `examples/bench` | Vue | 性能基准 | [performance.md](docs/performance.md) |
| `packages/fjs/src/mp` + `packages/fjs-runtime/src/wx` | TS | 小程序编译（`fjs build --mp`）与 wx 运行时薄壳 | [miniprogram.md](docs/miniprogram.md) |
| `specs/` | md | **spec-kit 产物**，一个需求一个目录 | 本文件第 0 节 |

---

## 3. 常用命令

```bash
pnpm install                          # 只装 JS 侧；Flutter 走 pub
pnpm run typecheck                    # 全 workspace
pnpm test                             # @ufjs/runtime + @ufjs/cli（vitest）
pnpm --filter demo run typecheck      # 单包
pnpm --filter demo run build:release
pnpm --filter hello-fjs run build:pages
```

Dart / C++ 侧：

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
./build-native/fjs-test                        # 引擎自测
./build-native/fjsrun dist/app/bundle.js           # 不起 Flutter 跑 bundle
cd packages/flutter_fjs && flutter test        # 需要先编好 native，否则整文件静默跳过
```

**注意**：`packages/flutter_fjs/test/nav_router_test.dart` 找不到 host dylib 时
输出 `No tests ran` 而**不是失败**。看到这行说明你没编 native，不是测试通过了。

---

## 4. 改动前必须知道的约束

这几条是踩过坑的地方，违反会静默出错而不是报错：

1. **op 协议双向同步**：`packages/fjs-runtime/src/ui/ops.ts` 与
   `packages/flutter_fjs/lib/src/ui_ops.dart` 是同一份协议的两半，
   **必须同时改**，否则表现为节点错位而不是异常。
2. **JSI 类型声明手写**：`native/src/natives.cpp` 改了，
   `packages/fjs-runtime/src/native-global.d.ts` 要跟着改 —— 它是这条边界
   唯一的类型描述。
3. **v1 ABI 只过标量**：`invokeHost` 的参数/返回是
   `string | number | boolean | null`。要传对象就 JSON 字符串化，
   要传二进制就 base64（`fetch` 就是这么做的）。
4. **两端同源**：任何面向用户的能力（标签、样式、事件），Flutter 侧
   （`lib/src/`）和 web 侧（`fjs-runtime/src/web/`）都要实现，
   **事件载荷一律是字符串**。只做一端等于没做，见
   [css-compat.md](docs/css-compat.md)。小程序端还有第三份映射要核对，
   见 [miniprogram.md](docs/miniprogram.md)。
5. **内置组件外观照 WeUI**：新增/改默认样式先看
   [WeUI 组件列表](https://wechat.design/tool/weui-mobile)，两端取同一组数值。
6. **自编 fjsc 优先于 npm 包**：改过 `native/` 就重新
   `cmake --build build-native`，否则字节码还是旧引擎编的。
   同理：`tags.json` / `component-tags.json` 被 `@ufjs/cli` 的 dist
   **内联**，改了要重新 `pnpm --filter @ufjs/cli run build`，否则
   `fjs dev` 按旧清单判定标签——新标签被当成 Vue 组件、页面递归
   自引用直到爆栈（specs/065 踩过，表现为 setup 无限重跑）。
7. **JS 能包就不要下 Dart**：新增标签/能力先问能不能在 JS 侧用组件包出来
   （`fjs-runtime/src/components/` + `FLUTTER_COMPONENT_TAGS` 排除，账记在
   `ui/element.ts` 这层）。只有需要原生控件、Flutter 渲染能力或有实测性能理由
   才下 Dart。完整判据与包法见宪法 VII。
8. **改了 native 要重新生成预编译产物**：`tool/build-android.sh` /
   `tool/build-apple.sh`，见 [publishing.md](docs/publishing.md)。

---

## 5. 代码风格

- **注释解释"为什么"，不解释"是什么"**。现有代码里的长注释（例如
  `css-compat.ts` 顶部、`web.md` 里的每条"已知差异"）都是在记录一个
  权衡决策 —— 新代码照这个密度写。
- 命名、缩进、导入顺序跟着所在文件走，不引入新风格。
- 文档写中文，代码注释写英文（跟现有文件一致）。
- 不新增依赖，除非 spec 里写明了理由。

---

## 6. 文档地图（渐进式，从上往下读）

**第一层 · 原理**
1. [原理：为什么是这个形状](docs/principles.md)
2. [线程模型与执行时序](docs/threading-model.md)
3. [整体架构与关键文件索引](docs/architecture.md)
4. [JSI 与原生模块](docs/jsi-and-native-modules.md)

**第二层 · 渲染**
5. [自定义渲染器：Vue 已实现，React 怎么接](docs/custom-renderer.md)
6. [UI API 参考（标签 / 事件 / 样式）](docs/ui-api.md)
7. [Web CSS 兼容清单](docs/css-compat.md)
8. [Web 平台适配](docs/web.md)
9. [小程序编译：Skyline + glass-easel](docs/miniprogram.md)
10. [Vue 3 集成](docs/vue3.md)

**第三层 · 扩展**
11. [模块扩展：npm 包 + Flutter autolink](docs/modules.md)
12. [路由](docs/routing.md)
13. [分包与 release assets](docs/code-splitting.md)

**第四层 · 工程**
14. [pnpm monorepo 规范](docs/monorepo.md)
15. [工具链：创建/运行/测试/编译](docs/toolchain.md)
16. [fjs go 调试客户端](docs/fjs-go.md)
17. [发布 npm 与 pub.dev](docs/publishing.md)
18. [性能测试](docs/performance.md)
19. [Roadmap](docs/roadmap.md)

---

## 7. 提交

- 只在用户明确要求时 commit / push。
- 在 `main` 上要先建分支。
- commit message 用 conventional commits，末尾带
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- 一个 spec 一个分支，分支名用 spec 目录名（`NNN-slug`）。
