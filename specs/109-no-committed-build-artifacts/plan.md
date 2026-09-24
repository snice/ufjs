# Plan: 清理仓库里提交的构建产物与死代码

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 不改任何运行时能力。 |
| II 边界即契约 | 否 | 三张表不动；引擎源码只删未被编译的目录，产物字节不变（`src/wasm/` 不在任何目标里）。 |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 入库产物会悄悄过期（e2e 测旧代码、fjs-go 种子引擎不符）；改为脚本生成 / 带校验更新。 |
| VI 注释记录权衡 | 是 | 构建脚本、刷新脚本、`VENDORED.md` 写清为何这样做、为何保留 `napi/`。 |
| VII JS 能包就不要下 Dart | 不适用 | — |
| VIII 变更落到文档 | 是 | `native/primjs/VENDORED.md`、`e2e/README.md`、`docs/roadmap.md`。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| spec 093 e2e | `specs/093-devtools-tree-lazy-and-live/e2e/build.mjs`（新增） | 借 `packages/fjs` 的 esbuild：`app-entry.js` → `bundle.js`（IIFE、es2019、与 `fjsDefines()` 相同的 define，`__FJS_DEVTOOLS__=true`）；`cdp-server.ts` → `relay.cjs`（node cjs，打入 ws） |
| spec 093 e2e | `e2e/.gitignore`（新增）、`e2e/README.md`（新增） | 忽略两份产物；写运行步骤 |
| spec 093 e2e | `e2e/client.cjs` | `createRequire` 改用相对仓库根的路径 |
| spec 093 e2e | `git rm --cached e2e/bundle.js e2e/relay.cjs` | 停止跟踪 |
| 引擎 | `packages/flutter_fjs/native/primjs/src/wasm/` | 删除 |
| 引擎 | `packages/flutter_fjs/native/primjs/VENDORED.md` | 裁剪清单补 `src/wasm/`；说明保留 `src/napi/` 的原因 |
| fjs-go | `examples/fjs-go/tool/refresh-seed.sh`（新增） | 下载线上 shared 包，校验 `FJSB` 头里的引擎 id 等于默认引擎，才覆盖 `assets/shared.fjsbundle.gz` |
| 文档 | `docs/roadmap.md` | 登记 109 与 fjs-go 种子待刷新 |

## 3. 方案

- e2e 产物改为可复现：脚本借用 `packages/fjs` 自己依赖的 esbuild（不新增依赖），参数与 CLI 的 dev 构建对齐。
  产物被忽略后，改源码再跑 e2e 必然走一遍构建，不会再测到旧代码。
- 引擎死代码：只删 CMake 完全不引用的 `src/wasm/`，用本机桌面构建 + `fjs-test` 证明无影响。
- fjs-go 种子：它是有意内置的，不删；但不能再是来源不明的二进制——脚本从部署地址拉取并校验引擎 id，
  防止再次把与默认引擎不符的字节码放进安装包。

**被否掉的备选**：
- 把 e2e 移进 `packages/fjs/test` 做成 vitest：它依赖本机编出的 `fjsrun`，CI 环境不一定有，
  放进单测会让 `pnpm test` 变脆；保持为手动 e2e，但产物可复现。
- 改写历史清掉大文件：会让所有已有克隆与分支失效，违背「不改写他人历史」。
- 直接删除 fjs-go 种子：会丢掉首启离线加速；过期问题用刷新脚本解决。

## 4. 风险

- 本环境跑 e2e 需要先编桌面 PrimJS（cmake + clang 可用），若 fjsrun 调试模块在 Linux 上有平台问题，如实记录。
- 删 `src/wasm/` 后仍需用户在 NDK / Xcode / DevEco 构建时确认（本环境只能验证桌面构建）。

## 5. 验证路径

```bash
cmake -S packages/flutter_fjs/native -B <tmp>/build -DFJS_BUILD_TESTS=ON && cmake --build <tmp>/build -j
<tmp>/build/fjs-test
node specs/093-devtools-tree-lazy-and-live/e2e/build.mjs
# relay + fjsrun + client.cjs，见 e2e/README.md
bash -n examples/fjs-go/tool/refresh-seed.sh
pnpm test
```
