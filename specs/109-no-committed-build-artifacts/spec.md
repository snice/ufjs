# Spec: 清理仓库里提交的构建产物与死代码

- **ID**: 109-no-committed-build-artifacts
- **状态**: done（fjs-go 种子待用户在重新部署后刷新）
- **日期**: 2026-09-24
- **来源**: 近 3 天代码 review（构建产物入库、vendored 引擎带死代码）。

## 1. 要解决什么

1. **spec 093 的端到端测试把打包产物提交进了 git**：
   `specs/093-devtools-tree-lazy-and-live/e2e/bundle.js`（62 万字节，由 `app-entry.js`
   打包）和 `e2e/relay.cjs`（15 万字节，由 `packages/fjs/src/debug/cdp-server.ts` 打包）。
   仓库里没有生成它们的脚本——源码一改，它们就悄悄过期，e2e 测的是旧代码。
   同目录的 `client.cjs` 还写死了作者本机路径
   `/Volumes/zt/Documents/flutter-js/packages/fjs/package.json`，别人检出后跑不起来。
2. **vendored PrimJS 带了从未编译的目录**：`packages/flutter_fjs/native/primjs/src/wasm/`
   （616K）在任何 CMakeLists 里都没有被引用；`VENDORED.md` 自称「`quickjs` 目标用不到的都已删掉」，
   与实际不符。
3. **fjs-go 内置的 shared 字节码已过期**：`examples/fjs-go/assets/shared.fjsbundle.gz`
   是有意内置的离线种子（仅当哈希与线上 manifest 一致时使用），但它的引擎 id 是
   `quickjs-ng-0.9.0`，而 spec 088 起默认引擎是 PrimJS。线上 showcase 若已按 PrimJS 重建，
   这份种子永远不会命中，每个安装包白带 46 万字节；若线上仍是 quickjs 字节码，
   默认引擎会报 engine mismatch。仓库里同样没有更新它的脚本。

## 2. 不做什么（Non-goals）

- **不改写 git 历史**：删掉的文件仍在历史里，克隆体积不会立刻变小；只保证今后不再跟踪。
- 不删 `primjs/src/napi/`：虽然也不编译，但 GC 头文件 include 了其中的
  `primjs_napi_defines.h`，PrimJS 的 CMakeLists 也声明了 napi 目标，删它要额外打 CMake 补丁，
  收益（812K 源码）不值这个升级负担。记录在 `VENDORED.md`。
- 不在本环境重新生成 fjs-go 种子：线上 showcase 域名在本环境网络策略下不可达；
  只提供带引擎 id 校验的更新脚本，由用户执行。
- 不删 `specs/088-devtools-debugger/spike/relay.cjs`：那是手写的 spike 源码，不是产物。
- 不补 spec 093 未完成的 T033（真实 Chrome 终验）。

## 3. 用户可见的行为

开发者视角：

```bash
# spec 093 e2e：产物由脚本生成，不再入库
node specs/093-devtools-tree-lazy-and-live/e2e/build.mjs   # 生成 bundle.js + relay.cjs
# 然后按 e2e/README.md 启动 relay、fjsrun、client.cjs

# fjs-go 内置种子：从线上拉取并校验引擎 id 与 App 默认引擎一致
examples/fjs-go/tool/refresh-seed.sh
```

## 4. 两端约定（宪法 I）

不涉及页面能力。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `git ls-files specs/093-devtools-tree-lazy-and-live/e2e` 不再包含 `bundle.js`、`relay.cjs`；
   `e2e/.gitignore` 忽略它们。
2. `node specs/093-devtools-tree-lazy-and-live/e2e/build.mjs` 在干净检出上成功生成两个文件；
   `client.cjs` 不含任何绝对路径。
3. 用本机编出的桌面 PrimJS `fjsrun` 跑通 e2e：`build.mjs` → relay → `fjsrun --debug-connect` →
   `client.cjs`，结果与 093 记录的一致（全部断言通过）。若本环境跑不通，如实记录卡在哪一步。
4. 删除 `primjs/src/wasm/` 后，`cmake -B … -DFJS_BUILD_TESTS=ON && cmake --build …` 成功，
   `fjs-test` 全绿；`VENDORED.md` 的裁剪清单补上 `src/wasm/`，并说明为何保留 `src/napi/`。
5. `examples/fjs-go/tool/refresh-seed.sh`：下载线上 shared 包，引擎 id 不是 App 默认引擎时拒绝写入；
   `bash -n` 通过。本环境无法联网执行，由用户运行。
6. `pnpm test`、typecheck 不回退；`docs/roadmap.md` 登记。

## 7. 待澄清

无。

## 8. 验收记录（2026-09-24，Linux）

1. `bundle.js`、`relay.cjs` 已 `git rm --cached`，`e2e/.gitignore` 忽略二者。
2. `node e2e/build.mjs` 生成成功（bundle.js 41 万字节：按 CLI 设置优先 `module` 字段，拿到 Vue
   esm-bundler 生产版；旧入库产物 62 万字节用的是 CJS 开发版）。`client.cjs` 已无绝对路径。
3. **e2e 11/11 通过**：脚本新生成的产物 + 本机编出的 PrimJS `fjsrun --debug-connect` + 当前 relay 源码。
   计划外改动：`native/tools/fjsrun.cpp` 缺 `#include <ctime>`，Linux 上 `nanosleep` 未声明、编不过
   （macOS 上被间接包含）；补了一行。只影响桌面工具 fjsrun，不进任何发布产物。另记：PrimJS 的 CMake 用了
   clang 专有的 `-faddrsig`，Linux 上须 `CC=clang CXX=clang++`，已写进 `e2e/README.md`。
4. 删 `primjs/src/wasm/` 后桌面构建成功，`fjs-test` ALL PASS（含调试器用例）。`VENDORED.md` 已更新。
   Android / iOS / 鸿蒙的引擎构建本环境不可做，但该目录从未被任何 CMake 目标引用。
5. `refresh-seed.sh`：`bash -n` 通过；离线验证——仓库里的 quickjs 种子被拒且不写入，伪造的 PrimJS 头被接受，
   非 gzip 被拒，显式指定 quickjs flavor 时接受。线上 showcase 域名本环境不可达，**实际刷新待用户执行**。
6. `pnpm test`、typecheck 全绿；`docs/roadmap.md` 已登记（含 fjs-go 种子待刷新的未勾选项）。

说明：删除的文件仍在 git 历史中，克隆体积不会因此变小（未改写历史）。
