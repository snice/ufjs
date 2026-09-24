# Plan: fjsc 双引擎兼容

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 只改 CLI 查找 fjsc 的逻辑和分发链路；Flutter / Web 渲染都不动 |
| II 边界即契约 | 否 | op 协议、natives 表、事件类型三张表都不动；fjsc 的命令行接口和 bundle 格式也不变 |
| III 同步单线程零序列化 | 否 | 与运行时无关 |
| IV 外观照 WeUI | 否 | 无 UI |
| V 静默失效是 bug | **是** | 核心：①选 fjsc 前先问二进制本身是哪个引擎，flavor 不符时在**构建阶段**报错，不留到 App 加载时；②`FJSC_PATH` 的 flavor 不对时报错，不悄悄回退到别的候选；③找不到时列出每个候选和它的引擎；④编完再核对 fjsc 输出里的引擎标识，不符就删掉产物；⑤`build.mjs` 打包时核对两个二进制各自的引擎（本机能运行的目标） |
| VI 注释记录权衡 | 是 | `findFjsc` 注释写清：为什么靠探测而不是靠路径或文件名（0.1.4 已证明文件名和引擎可以对不上）；为什么 `FJSC_PATH` 不回退（显式指定的值错了应该让人知道）；为什么仍保留仓库产物优先于 npm 包（原有理由不变）。`build.mjs` 注释写清：为什么一个包放两个二进制 |
| VII JS 能包就不要下 Dart | 否 | 纯 Node CLI 和构建脚本 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`（「fjsc 的查找顺序」约 63 行、引擎切换里「字节码跟引擎走」约 1346 行、FAQ `fjsc compiler not found` 约 1397 行）、`docs/publishing.md`（「fjsc 二进制」及 0.1.4 deprecate）、`packages/fjsc/README.md`、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/bundler/build.ts` | `findFjsc` 改为探测引擎；新增 `locateFjsc(engine)`，返回找到的路径和来源，或看过的候选列表；`compileBytecode` 核对输出里的引擎；报错文案 |
| CLI / 构建 | `packages/fjs/src/commands/doctor.ts` | 一项 `fjsc` 拆成 `fjsc primjs` / `fjsc quickjs` 两项；当前引擎（`resolveJsEngine()`）缺失为 `fail`，另一个为 `warn`；显示来源（FJSC_PATH / local build / npm） |
| 分发 | `packages/fjsc/build.mjs` | 每个目标编两个 flavor：`build/<target>-<flavor>/`，cmake 显式传 `-DFJS_JS_ENGINE=<flavor> -DFJS_DEBUGGER=OFF`；`prebuilt/<target>/` 按二进制分别取用；产出 `bin/fjsc` 和 `bin/fjsc-quickjs`（Windows 加 `.exe`）；本机能跑的目标核对自报引擎；带上 `LICENSE-primjs`；修正包描述和生成的 README |
| 分发 | `.github/workflows/fjsc-release.yml` | 冒烟测试对两个二进制都跑，并用 `grep` 核对各自的引擎标识；Stage 那步已经是 `bin/*`，两个都会带上 |
| 分发 | `packages/fjsc/README.md` | 描述两个 flavor |
| 测试 | `packages/fjs/test/fjsc-locate.test.ts`（新增） | 见 §5 |
| JS runtime / Web / C++ / Dart | — | 不动 |
| 文档 | `docs/toolchain.md`、`docs/publishing.md`、`docs/roadmap.md` | 见 VIII |

## 3. 方案

### 3.1 探测：`fjscEngine(path)`

用 `spawnSync(path, [])` 不带参数运行 fjsc，它打印 usage 后退出码为 2，stderr 里有
`engine: <id> (abi N)`（`native/tools/fjsc.cpp:52`）。用 `/engine: (\S+)/` 取出 id。
取不到（不是 fjsc、跑不起来、太老）返回 `null`。结果按路径缓存在进程内的 `Map` 里，
一次 build 会调用多次 `compileBytecode`，不重复探测。

### 3.2 查找：`locateFjsc(engine)`

```
want = ENGINE_IDS[engine]
1. FJSC_PATH 存在:
     id == want → 用它 (source 'FJSC_PATH')
     否则       → 抛错：FJSC_PATH=… is <id|unrecognized>, but this build targets <want>…（不回退）
2. 仓库 cmake 产物，按下面顺序探测，第一个 id == want 的胜出 (source 'local build')：
     本引擎惯用目录优先：primjs → build-native, build-native-quickjs
                        quickjs → build-native-quickjs, build-native
     （目录只决定探测顺序，不决定引擎；这修掉了「primjs 请求落到 build-native-quickjs」）
3. npm 包 @ufjs/fjsc-<平台>：bin/fjsc、bin/fjsc-quickjs 都探测 (source 'npm')
     （这样 0.1.4 那种「文件名是 fjsc、实际是 quickjs」的旧包在 quickjs 请求下仍可用，
       在 primjs 请求下则明确落空）
都不符 → 返回 { tried: [{path, id|null}] }
```

`findFjsc(engine?)` 保留原签名（`string | null`），内部调用 `locateFjsc`。
`FJSC_PATH` 错误照样抛出，因为它不属于「没找到」。
`compileBytecode` 改用 `locateFjsc`，找不到时的报错列出 `tried` 和各自引擎，
再附上现有的构建指引。quickjs 那段指引里「npm 只有 primjs」的错误说法删掉。

### 3.3 编后核对

fjsc 成功时 stdout 是 `fjsc: in -> out (N bytes, engine <id>)`（`fjsc.cpp:86`）。
用 `/engine (\S+)\)/` 取 id，与 `want` 不符就删掉产物并报错。
理论上 3.2 已经排除了这种情况，这里防的是探测和实际编译之间二进制被替换，
或者 fjsc 输出格式将来变化：取不到 id 时只 warn 一次，不报错，
避免输出格式一改就把所有构建卡死。

### 3.4 打包：`build.mjs`

```
for target:
  for flavor of ['primjs', 'quickjs']:
    exe = flavor === 'primjs' ? 'fjsc' : 'fjsc-quickjs'   (+ .exe on win32)
    prebuilt/<target>/<exe> 存在 → 用它
    否则可在本机构建 → cmake -S native -B build/<target>-<flavor>
                         -DFJS_JS_ENGINE=<flavor> -DFJS_DEBUGGER=OFF … ; 产物改名为 <exe>
    否则 → 报错（沿用现有文案，点名缺的是哪个文件）
    目标就是本机平台时 → 运行一次核对自报引擎，不符就报错
  写 package.json / README / LICENSE / LICENSE-primjs / LICENSE-quickjs-ng
```

CI 的 Stage 已经是 `cp …/bin/*`，两个二进制都会进 artifact，解压后正好落在
`prebuilt/<target>/fjsc` 和 `fjsc-quickjs`，发布流程的步骤不变。

### 3.5 被否掉的备选

| 备选 | 否掉的原因 |
|------|-----------|
| 另发 `@ufjs/fjsc-quickjs-<平台>` 5 个包 | 用户已选同包；另发会让每次发布变成 10 个包、多一倍 OTP 操作，两个包的版本还可能错开 |
| 靠文件名或目录名判断引擎（`fjsc` = primjs，`fjsc-quickjs` = quickjs） | 0.1.4 正是文件名 `fjsc`、实际 quickjs；目录名同理（`build-native` 的 cmake 缓存可以是任一 flavor）。只有二进制自报的引擎可信 |
| 给 fjsc 加 `--engine` / `--version` 参数 | 要改 `native/`、重编所有平台；而现有的 usage 输出已经带引擎标识，够用 |
| 读 `.fjsbundle` 头来核对，而不是解析 fjsc 的 stdout | 要在 TS 侧复刻 bundle 头格式，等于多一处要和 `vm.cpp` 同步的契约；stdout 那一行已经足够 |
| `FJSC_PATH` 引擎不符时回退到别的候选 | 显式设置却被悄悄忽略，违反宪法 V；报错让人去改环境变量更直接 |
| 在 CLI 里改版本号或 optionalDependencies | 用户选择发布时再统一改 |

## 4. 风险

- **探测多开进程**：每个候选多跑一次 fjsc，大约几毫秒；按路径缓存后，一次 build 最多探测 4–5 个路径。
- **Windows**：`spawnSync` 直接跑 `.exe` 没问题。单测里的假 fjsc 是 sh 脚本，在 win32 上跳过，并在测试里写明原因（宪法 V）。
- **darwin-x64 在 arm64 机器上**：`build.mjs` 的引擎核对只在「目标 = 本机平台」时做，其它目标打印一行「未核对」，不静默跳过。
- **`fjs doctor` 变严**：以前 fjsc 缺失只是 warn，现在当前引擎的 fjsc 缺失是 fail。纯 JS / web 项目也会因此显示 fail。这是用户选的，文档里写明。
- **npm 用户在新包发布前**：新 CLI 配 0.1.4 包时，primjs 构建会在构建阶段报错（以前是运行时才坏）。这是有意为之，报错里给出 `FJSC_PATH` 的出路。

## 5. 验证路径

```bash
# 单测：用 sh 脚本冒充 fjsc，按参数决定自报的引擎和编译输出
pnpm --filter @ufjs/cli run typecheck
pnpm --filter @ufjs/cli test -- fjsc-locate
pnpm test

# 打包：本机 darwin-arm64 两个 flavor
node packages/fjsc/build.mjs
for b in packages/fjsc/npm/fjsc-darwin-arm64/bin/*; do "$b" 2>&1 | grep engine; done
ls packages/fjsc/npm/fjsc-darwin-arm64/

# 模拟 npm 用户：把新包放进 hello-fjs 的 node_modules 对应位置，
# 临时把仓库的 build-native*/fjsc 改名，确保它们不可见
cd examples/hello-fjs
fjs build --release                        # 预期 engine primjs-4.1.1
fjs build --release --js-engine quickjs    # 预期 engine quickjs-ng-0.9.0
# 换回 0.1.4 包 → primjs 构建在构建阶段报错，报错里列出 quickjs-ng-0.9.0
FJSC_PATH=…/build-native-quickjs/fjsc fjs build --release   # flavor 不符，退出码非 0
fjs doctor                                  # fjsc primjs / fjsc quickjs 两行
# 最后把改过名的文件和 node_modules 恢复原样
```
