# Spec: fjsc 双引擎兼容

- **ID**: 114-fjsc-dual-engine
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

spec 091 引入双引擎（默认 primjs，可选 quickjs-ng）后，字节码编译器 `fjsc`
只跟上了一半。fjsc 把引擎静态链接进二进制，**flavor 就是二进制本身**，
编出的 `.fjsbundle` 头里带引擎标识，运行时 `fjs_bundle_check`（`native/src/vm.cpp:251`）
对不上就拒绝加载。现状（2026-09-24 实测，`fjsc` 不带参数会在 stderr 打印 `engine: <id> (abi N)`）：

| fjsc 来源 | 实测引擎 | `findFjsc` 以为是 |
|---|---|---|
| 已发布 `@ufjs/fjsc-darwin-arm64@0.1.4` | quickjs-ng-0.9.0 (abi 2) | primjs |
| 仓库 `native/build-native/fjsc` | primjs-4.1.1 (abi 2) | primjs |
| 仓库 `native/build-native-quickjs/fjsc` | quickjs-ng-0.9.0 (abi 2) | quickjs |

由此产生的问题：

1. **npm 用户默认的 release 构建是坏的**：不在仓库里的项目，`fjs build --release`
   （默认 primjs）拿到的是 npm 上那份 quickjs 版 fjsc。编出来的 bundle 带 quickjs
   的引擎标识，App 加载时被拒。构建阶段一切正常，要到运行时才失败（违反宪法 V）。
2. **`--js-engine quickjs` 在 npm 场景下不可用**：`findFjsc('quickjs')` 认定 npm 包
   只有 primjs，直接报「quickjs fjsc not found」，尽管那个包恰好就是 quickjs。
3. **`FJSC_PATH` 不看引擎**：指向哪个就用哪个，flavor 不对时同样到运行时才暴露。
4. **仓库回退顺序有误**：请求 primjs 时，候选列表包含 `build-native-quickjs`
   （`build.ts:958`）。只编过 quickjs 的人会拿到 quickjs 版 fjsc 去编 primjs 的 bundle。
5. **分发链路不认识 flavor**：`packages/fjsc/build.mjs` 调 cmake 时不传
   `FJS_JS_ENGINE`，编出哪个取决于 CMake 默认值和当时的源码。
   `fjsc-release.yml` 同样如此。生成的包描述、README 仍写着「QuickJS-ng」，
   包里只带 `LICENSE-quickjs-ng`，没有 `LICENSE-primjs`（Apache-2.0，
   `packages/flutter_fjs/LICENSE-primjs`）。
6. **文档与事实相反**：`docs/toolchain.md` 约 1348 行写着「npm 预编译的
   `@ufjs/fjsc-*` 只有 primjs 份」；「fjsc 的查找顺序」一节没提 flavor。
7. **`fjs doctor` 的 fjsc 检查**（`commands/doctor.ts:201`）调用 `findFjsc()`
   时不带引擎，只报路径，不报它是哪个引擎。

## 2. 不做什么（Non-goals）

- 不改 fjsc 的命令行接口和 bundle 格式（`fjsc <in.js> <out.fjsbundle>` 不变），
  也不改 `native/`。依赖的只是 fjsc 已有的自报输出。
- 不在 CI 里发布（npm 的 OTP 限制，见 `docs/publishing.md`）；本 spec 只把
  「编两个 flavor、打进包里」做好。**实际 `npm publish` 由用户在本地执行**。
- 不做 fjsc 的跨 flavor 转换，也不做「一个二进制同时支持两个引擎」。
- 不改纯 Flutter 宿主（fjs-go 等）的行为，它们没有 CLI 字节码步骤。
- spec 091 剩下的 T034（模拟器端到端）不在这里做。

## 3. 用户可见的行为

**npm 平台包的布局**（以 `@ufjs/fjsc-darwin-arm64` 为例）：

```
bin/fjsc            # primjs-4.1.1   —— 默认引擎
bin/fjsc-quickjs    # quickjs-ng-0.9.0
LICENSE  LICENSE-primjs  LICENSE-quickjs-ng  README.md  package.json
```

**按引擎挑选 fjsc**：`findFjsc(engine)` 的候选顺序不变，仍是
`FJSC_PATH` → 仓库 cmake 产物 → npm 包。变化在于对每个候选都用
`fjsc`（不带参数）读出它自报的引擎标识，只接受等于
`ENGINE_IDS[engine]` 的那一个。

```
$ fjs build --release                       # 只装了 npm 包的项目
fjsc: … (… bytes, engine primjs-4.1.1)      # 用 bin/fjsc
$ fjs build --release --js-engine quickjs
fjsc: … (… bytes, engine quickjs-ng-0.9.0)  # 用 bin/fjsc-quickjs
```

**`FJSC_PATH` 指向了错的 flavor**：直接报错，不往下回退，因为这是用户显式指定的。

```
fjs: FJSC_PATH=/…/build-native-quickjs/fjsc is quickjs-ng-0.9.0, but this build targets primjs-4.1.1
     (--js-engine / FJS_JS_ENGINE). Point FJSC_PATH at a primjs fjsc, or unset it.
```

**找不到匹配的**：报错信息列出看过的每个候选及其引擎，例如
`build-native/fjsc (primjs-4.1.1), @ufjs/fjsc-darwin-arm64/bin/fjsc (quickjs-ng-0.9.0)`，
再给出构建指引。

**编完再核对一次**：`compileBytecode` 从 fjsc 成功时的输出
`fjsc: … (N bytes, engine <id>)` 里取出引擎标识，与期望不符就报错并删掉产物。

**`fjs doctor`**：fjsc 一项按引擎分行列出，例如
`fjsc (primjs) ok /…/bin/fjsc (npm)`、`fjsc (quickjs) ok /…/bin/fjsc-quickjs (npm)`。
当前引擎（`FJS_JS_ENGINE` 或默认值）缺失算 error，另一个缺失算 warn。

## 4. 两端约定（宪法 I）

纯 CLI 和分发链路，不涉及 Flutter / Web 渲染。

| | primjs | quickjs |
|---|---|---|
| npm 二进制 | `bin/fjsc` | `bin/fjsc-quickjs` |
| 仓库 cmake 产物 | `native/build-native/fjsc` | `native/build-native-quickjs/fjsc` |
| 选择依据 | fjsc 自报的引擎标识 | 同左 |

两个引擎走同一套逻辑。仓库目录名只作为查找候选，不再用来推断引擎。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

分发契约有变化：npm 平台包多一个 `bin/fjsc-quickjs`。`@ufjs/cli` 按新布局查找，
但对旧包仍兼容，因为靠的是自报引擎，而不是文件名。

## 6. 验收标准

1. `pnpm --filter @ufjs/cli run typecheck`、`pnpm test` 通过。新增单测用假的 fjsc 脚本
   模拟自报引擎，覆盖以下情况：
   - 按引擎挑出正确的候选；
   - 跳过 flavor 不对的仓库或 npm 候选；
   - `FJSC_PATH` flavor 不对时报错，且不回退；
   - 找不到时报错信息列出每个候选及其引擎；
   - `compileBytecode` 输出的引擎不符时报错并删掉产物；
   - 请求 primjs 时不会用 `build-native-quickjs`。
2. `node packages/fjsc/build.mjs`（本机 darwin-arm64）生成 `npm/fjsc-darwin-arm64/`，
   `bin/fjsc` 自报 `primjs-4.1.1`，`bin/fjsc-quickjs` 自报 `quickjs-ng-0.9.0`，
   两个许可证文件都在，描述里不再只写 QuickJS-ng。
3. 模拟 npm 用户场景：`FJSC_PATH` 不设、仓库 cmake 产物不可见（例如临时改名），
   只让 `node_modules` 里的新包可见：
   - `fjs build --release`（hello-fjs）编出 primjs 的 bundle，终端打印 `engine primjs-4.1.1`；
   - `--js-engine quickjs` 编出 quickjs 的 bundle。
4. 同样条件下只有旧的 0.1.4 包（quickjs 版）时，`fjs build --release`（primjs）
   **在构建阶段报错**，报错里写明候选是 quickjs-ng-0.9.0。
5. `FJSC_PATH=…/build-native-quickjs/fjsc fjs build --release` 报 flavor 不符，退出码非 0。
6. `fjs doctor` 分两行列出 primjs 和 quickjs 的 fjsc 及来源。
7. `fjsc-release.yml` 的 matrix 为每个目标产出两个二进制，冒烟测试两个都跑、并核对引擎标识。
   这一条只核对 workflow 文件改动，是否在 GitHub 上真跑由用户决定。
8. 文档：
   - `docs/toolchain.md` 的「fjsc 的查找顺序」和 flavor 那一段；
   - `docs/publishing.md` 的「fjsc 二进制」；
   - `packages/fjsc/README.md`；
   - `docs/publishing.md` 写好 0.1.4 的 `npm deprecate` 命令；
   - `docs/roadmap.md` 加一条，写明「待发布：新版 `@ufjs/fjsc-*` 与 `@ufjs/cli`」。

## 7. 待澄清

已拍板（2026-09-24）：

- [x] **1. 分发布局**：同一个平台包里放两个二进制，`bin/fjsc`（primjs）和 `bin/fjsc-quickjs`，仍然是 5 个包。
- [x] **2. 版本号**：本 spec 不改版本号，发布时由用户在本地统一改。
- [x] **3. `fjs doctor`**：当前引擎的 fjsc 缺失算 error，另一个缺失算 warn。
- [x] **4. 已发布的 0.1.4**：在 `docs/publishing.md` 里写好 `npm deprecate @ufjs/fjsc-*@0.1.4` 的命令和说明，由用户发布新版后执行。
