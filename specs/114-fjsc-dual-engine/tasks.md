# Tasks: fjsc 双引擎兼容

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 不涉及契约层：op 协议、natives 表、事件类型，以及 fjsc 的命令行接口和 bundle 格式都不变（spec §5）。确认后直接勾掉

## 实现

- [x] T010 新增 `fjscEngine(path)`：不带参数运行 fjsc，从 stderr 用 `/engine: (\S+)/` 取出引擎标识，跑不起来或取不到返回 null，结果按路径缓存。文件：`packages/fjs/src/bundler/build.ts`
- [x] T011 新增 `locateFjsc(engine)`，按 plan §3.2 查找，注释写明权衡（宪法 VI）：
  - `FJSC_PATH` 引擎不符时抛错，不回退；
  - 仓库的两个构建目录都探测，目录只决定探测顺序；
  - npm 包里 `bin/fjsc` 和 `bin/fjsc-quickjs` 都探测；
  - 都不符时返回看过的候选列表。

  `findFjsc(engine?)` 保留原签名，内部改调 `locateFjsc`。文件同上
- [x] T012 `compileBytecode` 改用 `locateFjsc`：
  - 找不到时报错，列出看过的每个候选及其引擎，再附上构建指引，删掉「npm 只有 primjs」的说法；
  - 编完从 stdout 用 `/engine (\S+)\)/` 取出引擎标识，不符就删掉产物并报错；取不到标识只 warn 一次。

  文件同上
- [x] T013 `fjs doctor` 拆成 `fjsc primjs` 和 `fjsc quickjs` 两项，显示来源（FJSC_PATH / local build / npm）。当前引擎（`resolveJsEngine()`）缺失算 fail，另一个缺失算 warn；`FJSC_PATH` 引擎不符时显示为 fail 并附原因。文件：`packages/fjs/src/commands/doctor.ts`
- [x] T014 打包脚本对每个目标编两个 flavor，按 plan §3.4：
  - 构建目录 `build/<target>-<flavor>`，cmake 传 `-DFJS_JS_ENGINE`、`-DFJS_DEBUGGER=OFF`；
  - `prebuilt/<target>/` 下按二进制分别取用；
  - 产出 `bin/fjsc` 和 `bin/fjsc-quickjs`；
  - 目标是本机平台时运行核对引擎，其它目标打印「未核对」；
  - 带上 `LICENSE-primjs`，改正包描述、`files` 字段和生成的 README。

  文件：`packages/fjsc/build.mjs`
- [x] T015 冒烟测试两个二进制都跑，并用 `grep` 核对各自的引擎标识（primjs-4.1.1 / quickjs-ng-0.9.0）。文件头注释补一句：每个目标产出两个二进制。文件：`.github/workflows/fjsc-release.yml`

## 两端对齐

- [x] T020 不涉及 Web 侧：只改 CLI 和分发链路，没有标签、样式或事件（plan §1 的 I）。确认后直接勾掉
- [x] T021 核对 `findFjsc` 的其它调用方（`doctor.ts`、`build.ts` 内部）都已适配新行为，`fjs build --web` 等不走字节码的路径不受影响

## 测试

- [x] T030 新增单测，用 sh 脚本冒充 fjsc：不带参数时在 stderr 打印指定引擎，带参数时写出产物并在 stdout 打印指定引擎。win32 上 `describe.skipIf` 跳过并写明原因。覆盖：
  - 按引擎挑出正确的候选；
  - 跳过 flavor 不对的仓库或 npm 候选；
  - 请求 primjs 时不会用 `build-native-quickjs` 里的 quickjs 版；
  - 旧包布局（只有 `bin/fjsc`，实际是 quickjs）：quickjs 请求能用，primjs 请求落空。

  文件：`packages/fjs/test/fjsc-locate.test.ts`
- [x] T031 同一文件：`FJSC_PATH` 引擎不符时抛错，且不回退；找不到时报错信息列出每个候选及其引擎
- [x] T032 同一文件：`compileBytecode` 输出的引擎不符时报错并删掉产物；输出里没有引擎标识时只 warn

## 文档

- [x] T040 `docs/toolchain.md`：改「fjsc 的查找顺序」（按自报引擎挑选、npm 包两个二进制）、引擎切换一节「字节码跟引擎走」（删掉「npm 只有 primjs」）、FAQ 的 `fjsc compiler not found`，以及 `fjs doctor` 的新判定
- [x] T041 `docs/publishing.md`：改「fjsc 二进制」一节（包内两个二进制、`prebuilt/<target>/` 布局、打包时核对引擎），写好 0.1.4 的 `npm deprecate` 命令和说明
- [x] T042 `packages/fjsc/README.md`：写明两个 flavor 和布局
- [x] T043 `docs/roadmap.md` 加一条 ✅ spec 114，写明「**待发布**：新版 `@ufjs/fjsc-*` 与 `@ufjs/cli`，发布后执行 0.1.4 的 deprecate」

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 逐条核对 spec.md 第 6 节：第 1、7、8 条由上面的任务覆盖；第 2–6 条按 plan §5 实跑，跑完把仓库产物和 `node_modules` 恢复原样
  - 2026-09-24 实测（darwin-arm64，hello-fjs）：
    - 第 2 条：`build.mjs` 产出 `bin/fjsc`（1103 KB，engine primjs-4.1.1）与 `bin/fjsc-quickjs`（1003 KB，engine quickjs-ng-0.9.0），三个许可证都在，`license` 为 `MIT AND Apache-2.0`；
    - 第 3 条：隐藏仓库 fjsc、npm 链接指向新包后，primjs 与 quickjs 的 release 构建都成功，bundle 头分别是 primjs-4.1.1 / quickjs-ng-0.9.0；
    - 第 4 条：链接指向 0.1.4 时，primjs 构建在构建阶段报错，列出候选为 quickjs-ng-0.9.0，exit 1；
    - 第 5 条：`FJSC_PATH` 指向 quickjs 版时报 flavor 不符，exit 1；
    - 第 6 条：`fjs doctor` 分两行（旧包时 primjs ✗、quickjs ✓；新包时两行都 ✓，来源 npm）；
    - 跑完已恢复：仓库 fjsc 改回原名，npm 链接指回 0.1.4，hello-fjs 的引擎切回 primjs。
  - 与 spec/plan 的出入：
    - spec §3 的示例写着终端会打印 `fjsc: … engine …` 这一行，但 CLI 一直是 `stdio: pipe`、不回显这一行。本次没有改回显，改为直接读 bundle 头核对引擎；
    - npm 包的 `license` 字段由 `MIT` 改为 `MIT AND Apache-2.0`，因为包里链接了 PrimJS（Apache-2.0）。plan 没写这一条，改动很小，已写进 `docs/publishing.md`。
