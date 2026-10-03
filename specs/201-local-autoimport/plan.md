# Plan: autoimport 支持本地 Dart 包

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（差异沿用） | autoimport 只服务 Flutter 端（160 已登记）。web 端：替身仍手写，但 `import type { PlaygroundModule } from './fjs-objects'` 让它按生成类型实现，漂移变编译错误。web 文件：`demo/src/playground-stub.ts`；Flutter 文件：`demo/dart/playground/lib/playground.dart` 经生成适配器。 |
| II 边界即契约 | 是（工具链契约） | 三张运行时表（ops / natives / 事件）与 FJSValue ABI 都不动。工具链契约变三处，对着写：①`package.json` 的 `fjs.autoimport` 条目（`@ufjs/cli` 的 `readAutoimport`）；②dump 语法的 `cb.params/ret` 与可写字段 setter（`fjs-introspect` ↔ `autoimport.ts` 的 `FjsType`/生成器，160 §4 表格同步改）；③缓存键。 |
| III 同步单线程零序列化 | 否 | 运行时零改动；生成的适配器仍走 159 通道。回调闭包 `(a0) => cb.call([a0])` 在 Dart 侧同步包一层，不新开桥。 |
| IV 外观照 WeUI | 否 | demo 页只改类型来源，不改样式。 |
| V 静默失效是 bug | 是 | 非法条目形状（缺 name/path、path 不存在、无 `lib/<name>.dart`）一律报错退出；`cb` 退化成宽签名时在构建输出里列一行（不静默变宽）；缓存键感知本地源码，避免"改了没生效"的静默。 |
| VI 注释记录权衡 | 是 | 生成器头注释写明：为何 cb 要带签名（适配器编译 + d.ts 类型两个原因）、为何含 unsupported 的 cb 退化而非丢成员、为何缓存键对本地包追加内容哈希。 |
| VII JS 能包就不要下 Dart | 是（反向合规） | 能力本体是 Dart 类，JS 无法伪造；下沉的仍是构建期 Node/analyzer 代码，运行时不动。 |
| VIII 变更落到文档 | 是 | `docs/modules.md`（autoimport 章：本地包写法、cb 签名、可写字段、troubleshooting）、`docs/toolchain.md`（`fjs autoimport` 条目提到 path 条目）、`specs/160-object-codegen/spec.md` §4 表格追加指向本 spec 的注。`docs/roadmap.md` 不涉及。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 工具包（Dart） | `packages/fjs-introspect/lib/fjs_introspect.dart` | ①`_type` 对 `FunctionType` 产出 `{k:'cb', params:[…], ret:…}`（参数/返回里有 unsupported 则回落旧的无签名 `cb`，并经 `skipped`/note 记一条）；②公开、非 final/const 字段额外产出 setter；③`--package` 对本地包照常工作（entry 里 `package:<name>/<name>.dart` 已能解析 path 依赖，无需改 analyzer 调用） |
| CLI / 构建 | `packages/fjs/src/project/autoimport.ts` | `AutoimportPackage` 加 `path?`；`parseAutoimportEntry` 接受对象；`readAutoimport` 校验（字符串或 `{name,path}`）；`autoimportHash` 对 path 条目追加 `lib/**/*.dart` 与 `pubspec.yaml` 内容哈希；`ensurePubspecEntry` 支持多行（path）条目的幂等改写；`syncAutoimport` 解析 path 为相对宿主目录；`dartArgExpr`/`dartReturnStmt` 的 `cb` 分支按 `params` 生成闭包；`tsType` 的 `cb` 按签名输出；`objectTypesSource` 去掉可写字段的 `readonly` 并出 setter |
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | `writeHostPubspec` 的 `autoDeps` 对 path 条目写多行 `path:`（相对宿主 pubspec 目录，复用 `relativeYamlPath`）；`readAutoimport` 调用点类型随 `AutoimportPackage` 变化 |
| CLI / 构建 | `packages/fjs/src/commands/autoimport.ts`、`vite.ts` | 只依赖 `readAutoimport`/`writeAutoimportTypes`，预计零改动，实施时核对 |
| 测试 | `packages/fjs/test/autoimport.test.ts`、`packages/fjs/test/fixtures/` | 新增 fixture `local.api.json`（含 cb 签名、可写字段、顶层函数）；新增用例见 tasks；`mmkv.api.json` 的输出**逐字回归** |
| demo（本地包） | `demo/dart/playground/pubspec.yaml`、`demo/dart/playground/lib/playground.dart`（新） | 普通 Dart 类/顶层函数（Counter / waitFor / failAfter / makeAdder / liveCount），不依赖 flutter_fjs |
| demo | `demo/package.json` | `fjs.autoimport` 加 `{name:'playground',path:'dart/playground'}` |
| demo | `demo/src/main.dart` | 删 `_PlaygroundModule` 与 `registerModule`，只留 mmkv 的 `MMKV.initialize` |
| demo | `demo/src/fjs-playground.d.ts` | **删除** |
| demo | `demo/src/playground-stub.ts`、`demo/src/pages/basic/dart-playground.vue` | 类型改为 `import type … from './fjs-objects'`；生成类型下 `release()` 等成员名/签名要对上，页面按需微调 |
| demo | `demo/src/fjs-objects.d.ts` | 生成物，重新生成后提交（含 `PlaygroundModule`） |
| 文档 | `docs/modules.md`、`docs/toolchain.md`、`specs/160-object-codegen/spec.md` | 见宪法 VIII |

已用 `ls` / `grep` 确认存在：`autoimport.ts`、`fjs_introspect.dart`、`run.ts` 的 `writeHostPubspec`（`autoDeps`，行 957）与 `relativeYamlPath`（行 1523）、`autoimport.test.ts`、`fixtures/mmkv.api.json`、`demo/src/fjs-objects.d.ts`（已提交，`.fjs/` 被 ignore）。

## 3. 方案

**配置**：`readAutoimport` 接受 `string | {name, path}`；对象形式的 `path` 相对项目根（`package.json` 所在目录）。运行 `syncAutoimport` 时转成相对宿主 pubspec 目录（`demo/.fjs/flutter`）的路径写入多行条目：

```yaml
  playground:
    path: ../../dart/playground
```

校验（报错退出，不静默）：`name` 与 `path` 都必须是非空字符串；`path/pubspec.yaml` 存在且其 `name` 与条目 `name` 一致；`lib/<name>.dart` 存在（introspect entry 约定的主库）。

**缓存键**：`autoimportHash` 把 path 条目的 `lib/**/*.dart` 与 `pubspec.yaml` 内容（按路径排序后）并入哈希。pub 条目的行为不变，所以 mmkv 的键只因"清单结构变了"一次性重算，之后稳定；这是预期，不算回归。

**cb 签名（dump 语法）**：`{k:'cb', params:[{name?, type}…], ret}`。生成器：
- 形参位置（Dart 方法形参是函数类型）：生成 `(a0, a1) => cb.call([a0, a1])`，其中 `cb = args[i] as FjsCallback`；返回值丢弃或按 `ret` 为 void/非 void 决定是否 `return`（Dart 回调的 JS 返回值一般不回传，v1 统一忽略，签名返回非 void 时给 `null` 的类型安全默认会编译不过，所以闭包返回类型照 `ret` 生成并对非 void 加 `as R`——实现时以 `dart analyze` 零问题为准，细节在 tasks 里落成断言）。
- 返回位置（`makeAdder` 返回函数）：沿用既有 `isBindableReturn`（`cb` 已可绑定），Dart 闭包经 `writeValue` 变 JS 函数；d.ts 取签名。
- d.ts：`(a0: P1, a1: P2) => R`，递归使用 `tsType`；无签名的旧 `cb` 保持 `(...args: never[]) => unknown`（向后兼容旧 dump）。

**可写字段**：dump 里对公开、非 final/const 字段补一个 setter（类型即字段类型）。适配器 `set` 已有分发逻辑，d.ts 去掉 `readonly`。

**demo**：`demo/dart/playground` 是纯 Dart 包（`dependencies` 只有 sdk）。顶层函数 `waitFor/failAfter/makeAdder/liveCount`；类 `Counter`。`release()` 仍是类自己的方法，抛 `StateError('Counter is released')` 的行为与现在逐字一致，保证 159 的 `web.txt` 对拍线不动。

**被否掉的备选**
1. *字符串条目 `name@path:…`*：用户已拍板对象形式；字符串里的 `@`/`:` 语义会叠一层。
2. *把本地 Dart 放在 `demo/src/` 里*：Vite 会扫 `src/`，混放易误解；用户已选 `demo/dart/`。
3. *生成器对 FjsCallback 做适配而不改 dump*：不拿函数签名就不知道几个参数，只能生成变参的猜测闭包，d.ts 也无从得到类型；两个需求都要签名，所以改 dump。
4. *给 `FjsCallback` 加 `Function` 隐式转换*：Dart 没有这种机制；让运行时类实现 `call` 也不能转成具体函数类型。
5. *每次都重新 dump（不做缓存键）*：本地包源码变更能感知，但每次 `fjs run` 多跑一遍 analyzer，违背 160 的缓存设计；改缓存键成本更低。
6. *新增 `fjs.autoimportLocal` 单独字段*：和已有清单重复，两处入口要同步；统一进 `autoimport` 数组更直观。

## 4. 风险

1. **cb 返回类型的闭包生成**：Dart 闭包的静态返回类型必须匹配形参声明，`void Function(int)` 与 `int Function(int)` 生成的闭包返回不同。风险点是生成的 Dart 不过 `dart analyze`——验收 3 以真实 demo 包 `dart analyze` 零问题为准，且 golden 钉住文本。
2. **path 相对路径方向**：宿主 pubspec 在 `.fjs/flutter/`，项目根在两级以上；用 `relativeYamlPath` 计算而非手拼，tasks 里加断言。
3. **`ensurePubspecEntry` 多行改写**：现实现按单行正则替换，path 条目是多行；要保证从 `playground:`/`playground: ^1` 改写为 path、以及重复运行幂等。
4. **主库约定**：entry 文件写 `package:<name>/<name>.dart`；本地包若主库不叫这个名字会晚到 analyzer 才失败——所以提前校验并给清晰报错。
5. **mmkv 输出回归**：加了可写字段 setter 后，mmkv 的 d.ts 里**会有少量字段不再 `readonly`**（若 mmkv 有可写公有字段）。这是 spec 允许的真实变化，但要在验收 1 里区分「mmkv fixture 输出逐字不变」——fixture 是 dump JSON，不含新 setter 条目，所以生成物不变；而对真实包重新 dump 后差异在 d.ts 里体现，需在 demo 重生成时人工审阅一次。
6. **对拍回归**：改为生成适配器后，`Counter.value` 之前由手写 `get` 返回；现在是字段 getter。类型 int 两端一致，预期无差；仍以 159 的 `web.txt` 逐行 diff 为准。
7. **`fjs run` 的 pub get 次数**：path 条目写进模板，不引入"先写后补"的二步抖动（沿用 160 §10 的做法）。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli test                      # autoimport golden（含回归）
cd packages/fjs-introspect && dart analyze        # 工具包
cd demo && pnpm exec fjs autoimport --force       # 真实 dump → 生成
cd demo/.fjs/flutter && dart analyze lib/fjs_objects.dart
pnpm --filter demo run typecheck
pnpm run typecheck && pnpm test
cd packages/flutter_fjs && flutter test
# 对拍（沿用 159 T042 的产物 web.txt）：
cd demo && pnpm exec fjs dev --web                # 一键跑全部 → web.txt
cd demo && pnpm exec fjs run ios --device <sim> --port 38911   # 一键跑全部 → 日志 diff
```

## 6. 实施中的偏差（2026-10-03）

首次对 demo 真跑 `fjs autoimport --force` 就挖出两处**早已存在**的生成器 bug
（mmkv 没有可写成员/函数形参，所以 160 的 e2e 没碰到），本 spec 一并修掉：

1. **生成的 `set` 分支引用未定义的 `args`**：`dartArgExpr` 把 `args[0]` 写死，
   而 `set(Object instance, String member, Object? value)` 里只有 `value`，
   任何带 setter 的类生成出来都**编译不过**（`Undefined name 'args'`）。
   修：`dartArgExpr` 加 `rawArg` 参数，setter 传 `'value'`。
2. **dump 把只读成员当成可写**：新元素模型把 getter-only 访问器也列成「合成的
   非 final 字段」，按 `isFinal` 判可写会让 mmkv 的所有 getter 变成 setter
   （d.ts 去掉 readonly、Dart 里 `self.length = …` 编译不过）。修：改问
   `f.setter != null && public`，并与 `cls.setters` 去重；d.ts 对
   「getter+setter」同名成员只发一次（TS 不允许 readonly 与非 readonly 混声明）。

mmkv 的 d.ts 经此修正**与改动前逐字一致**（验收 1 的回归线），playground
得到 `step: number`（可写）与 `readonly value: number`。
