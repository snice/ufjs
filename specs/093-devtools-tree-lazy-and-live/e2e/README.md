# spec 093 端到端验证（桌面，无需手机）

一个真正的 CDP 客户端（`client.cjs`，做的事与 Chrome DevTools 相同）对着**真中继**
和**真 PrimJS VM**（`fjsrun`，跑用真运行时源码打出来的 fixture app）检查
Elements 树的按需展开与结构变化自动刷新。

`bundle.js` 与 `relay.cjs` 是生成物，不入库（spec 109）——每次跑之前重新构建，
保证测的是当前源码。

```bash
# 0. 桌面 PrimJS 引擎与 fjsrun（改过 native/ 就要重编）
#    PrimJS 的 CMake 用了 clang 专有参数，Linux 上要显式用 clang
cd packages/flutter_fjs/native
CC=clang CXX=clang++ cmake -B build-native -DFJS_BUILD_TESTS=ON
cmake --build build-native -j
cd -

# 1. 生成 bundle.js（app-entry.js + 运行时源码）与 relay.cjs（cdp-server.ts）
node specs/093-devtools-tree-lazy-and-live/e2e/build.mjs

# 2. 三个进程：中继 → VM 拨号接入 → 客户端
cd specs/093-devtools-tree-lazy-and-live/e2e
node run-relay.cjs &                                    # cdp :49902，vm :49903
../../../packages/flutter_fjs/native/build-native/fjsrun \
  --debug-connect 127.0.0.1:49903 --pump 60000 bundle.js &
node client.cjs                                          # 期望 11/11 checks passed
kill %1 %2
```

2026-09-24 在 Linux（clang）上按上述步骤跑通 11/11（spec 109 验收）。
