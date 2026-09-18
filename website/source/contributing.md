# 本地开发与调试 ufjs

做应用只需要 npm 上的发布包。这一篇是给**要改 ufjs 自身**（引擎、运行时、CLI）的人看的。

## 环境准备

```bash
git clone https://github.com/snice/ufjs && cd ufjs
pnpm install
```

`pnpm install` 会把 `demo`、`examples/*` 通过 workspace 链接到 `packages/fjs` 和 `packages/fjs-runtime` 的源码，改完立即生效。Flutter 侧的宿主用 path 依赖指向 `packages/flutter_fjs`。

### 编译原生引擎

改运行时和 CLI 不需要这一步；要跑字节码构建、`fjsrun` 或 `flutter test` 时需要：

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON
cmake --build build-native -j
./build-native/fjs-test          # 引擎自测，应输出 ALL PASS
```

产物：`fjs-test`（自测）、`fjsrun`（命令行宿主）、`fjsc`（字节码编译器）、`libfjs.dylib`（给 `flutter test` 用）。

::: warning 自编的 fjsc 优先
仓库里编出来的 `fjsc` 会**优先于** npm 上的 `@ufjs/fjsc-<平台>`。这是刻意的：否则改完引擎，字节码还是用旧引擎编的。改过 `native/` 就重新 `cmake --build` 一次。
:::

## 用内置项目验证

```bash
pnpm --filter demo run typecheck
pnpm --filter demo run dev:web
pnpm --filter demo run run:android
pnpm --filter demo run build:release

pnpm --filter hello-fjs run build:pages   # 组件画廊
pnpm --filter hello-fjs run build:mp      # 同一份源码编小程序
```

::: tip 改了 CLI 要重新构建它
`@ufjs/cli` 的 `dist/` 会内联 `tags.json` 等清单。改了 CLI 源码或标签清单后要重新构建，否则 `fjs dev` 还在用旧的：

```bash
pnpm --filter @ufjs/cli run build
```
:::

## 测试

```bash
pnpm run typecheck                  # 全 workspace
pnpm test                           # @ufjs/runtime + @ufjs/cli 单测（vitest）

cd packages/flutter_fjs && flutter test
cd examples/fjs-go && flutter test
```

::: warning No tests ran 不是通过
`flutter_fjs` 的部分测试要用 `native/build-native/libfjs.dylib` 起真实 VM，**找不到就整个文件静默跳过**，输出 `No tests ran`。先编好 native 再跑。
:::

## 调试手段

| 工具 | 用途 |
|---|---|
| `fjsrun <bundle>` | 不起 Flutter 跑 bundle，打印 console 和每帧 op |
| `fjsrun --tap <id> <bundle>` | 模拟点击某个节点 |
| `fjs log` / `fjs eval` | 连着设备看日志、求值 |
| dev server 按 `p` | 性能面板：ui / gpu 帧耗时、JS 堆、节点数 |
| `fjs build --analyze` | 产物体积构成 |
| `examples/bench` | 性能基准，见 `docs/performance.md` |

## 改动约束

这些约束违反时往往**静默出错**而不是报错：

1. **op 协议三处同改**：`ui/ops.ts`、`ui_ops.dart`、`fjsrun.cpp`
2. **JSI 类型手写**：改了 `natives.cpp` 要同步 `native-global.d.ts`
3. **两端同源**：任何面向用户的能力，Flutter（`lib/src/`）和 Web（`fjs-runtime/src/web/`）都要实现，小程序映射也要核对；事件载荷一律字符串
4. **JS 能包就不下沉 Dart**：新标签先考虑能否在 `fjs-runtime/src/components/` 用现有标签拼出来
5. **内置组件外观照 WeUI**，两端取同一组数值
6. **改了 native 要重新生成预编译产物**并提交：

```bash
cd packages/flutter_fjs
ANDROID_NDK_HOME=... tool/build-android.sh
tool/build-apple.sh      # 需要 macOS + Xcode
tool/build-ohos.sh       # 需要 DevEco
```

## 规范驱动开发

仓库采用 spec-kit 式的流程，每个需求一个 `specs/NNN-slug/` 目录：

```text
spec.md    做什么、为什么、验收标准
plan.md    改哪些层、哪些文件、什么顺序
tasks.md   可勾选的任务清单
```

读 `specs/` 是理解某个功能「为什么是现在这样」的最好途径 —— 很多看起来奇怪的实现，都能在对应 spec 里找到当时踩过的坑。贡献新功能也请先写 spec。完整约定见仓库根目录的 [AGENTS.md](https://github.com/snice/ufjs/blob/main/AGENTS.md)。

## 发布

npm 包、pub 包和预编译产物的发布流程见 [docs/publishing.md](https://github.com/snice/ufjs/blob/main/docs/publishing.md)。
