# Tasks: autoimport 支持本地 Dart 包

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（dump 语法与条目形状，先做）

- [x] T001 `packages/fjs/src/project/autoimport.ts`：`FjsType` 的 `cb` 加
      `params?: {name?: string; type: FjsType}[]` 与 `ret?: FjsType`；
      `AutoimportPackage` 加 `path?`；`parseAutoimportEntry`/`readAutoimport`
      接受 `string | {name, path}` 并校验（形状错误抛带条目原文的错误）
- [x] T002 `packages/fjs/test/fixtures/local.api.json`（新）：本地包形状的
      dump——含带签名的 `cb`（形参与返回两处）、可写字段 setter、顶层函数、
      Future、同包 `cls` 引用；本文件是 introspect ↔ 生成器的对拍物

## 实现

- [x] T010 `packages/fjs-introspect/lib/fjs_introspect.dart`：`FunctionType`
      产出 `cb` 签名（含 unsupported 时回落无签名 `cb` 并记一条 note）；公开
      非 final/const 字段补 setter；`dart analyze` 零问题
- [x] T011 `autoimport.ts` 生成器：`dartArgExpr` 的 `cb` 分支按 `params`
      生成 `(a0, …) => cb.call([a0, …])` 闭包（无签名时保持旧
      `as FjsCallback`）；`tsType` 的 `cb` 输出 `(a0: P) => R`；
      `objectTypesSource` 对有 setter 的字段去掉 `readonly`；cb 退化时在
      跳过清单里补一行
- [x] T012 `autoimport.ts`：`autoimportHash` 对 path 条目并入
      `lib/**/*.dart` + `pubspec.yaml` 内容哈希；path 校验（目录/pubspec
      name/主库存在）；`ensurePubspecEntry` 支持多行 path 条目幂等改写
      （含 pub 条目↔path 条目互改）；`syncAutoimport` 把 path 解析成相对宿主
      pubspec 目录的路径
- [x] T013 `packages/fjs/src/commands/run.ts`：`writeHostPubspec` 的
      `autoDeps` 对 path 条目写多行 `path:`（复用 `relativeYamlPath`）；核对
      `commands/autoimport.ts`、`vite.ts` 对 `AutoimportPackage` 的使用，预期
      零改动
- [x] T014 `pnpm --filter @ufjs/cli run build`：autoimport 在 CLI 的 dist 里，
      demo 用的是 dist（AGENTS §4.6 的坑），改完必须重编

## 两端对齐

- [x] T020 `demo/dart/playground/pubspec.yaml` + `lib/playground.dart`（新）：
      纯 Dart 包，Counter（value/step 字段、add/onTick/fire/startTimer/clone/
      merge/release）与顶层 waitFor/failAfter/makeAdder/liveCount，行为与
      现手写模块逐字一致（含 `StateError('Counter is released')`）
- [x] T021 `demo/package.json` 的 `fjs.autoimport` 加
      `{"name":"playground","path":"dart/playground"}`；`demo/src/main.dart`
      删 `_PlaygroundModule` 与 `registerModule`（只留 mmkv 初始化）；删
      `demo/src/fjs-playground.d.ts`
- [x] T022 `demo` 上 `fjs autoimport --force` 重新 dump 并生成；
      `demo/.fjs/flutter` 下对 `lib/fjs_objects.dart` 跑 `dart analyze` 零问题；
      审阅 `demo/src/fjs-objects.d.ts` 里 mmkv 部分相对旧版的差异（可写字段
      去 readonly 是预期，其他不该变）；提交生成物
- [x] T023 `demo/src/playground-stub.ts` 改 `import type { PlaygroundModule,
      Counter } from './fjs-objects'` 并按生成类型实现；`dart-playground.vue`
      的类型引用同步；`pnpm --filter demo run typecheck` 通过
- [x] T024 对拍复跑（159 T042 的产物）：web「一键跑全部」与 iOS 模拟器输出
      与 scratchpad 的 `web.txt` 逐行一致（行为不回归）

## 测试

- [x] T030 `packages/fjs/test/autoimport.test.ts`：`{name,path}` 解析与非法
      形状报错；本地包 pubspec 条目文本（路径相对、幂等、pub↔path 改写）；
      缓存键随本地源码变化而变、不变则不变
- [x] T031 同文件：用 `local.api.json` 断言生成的 Dart（cb 形参闭包、可写
      字段 setter）与 d.ts（`(a0: number) => number`、无 `readonly`）golden；
      `mmkv.api.json` 的两份生成物**逐字回归**
- [x] T032（取舍：未加；生成的 cb 闭包与返回函数包装由 T024 的 iOS 对拍端到端覆盖——它正是靠对拍抓到「double 传给 int 闭包」那处）`packages/flutter_fjs/test/object_bridge_test.dart`（可选）：若
      生成的 cb 闭包形态值得端到端钉住，加一条用 playground 生成适配器的
      回调用例；否则在 tasks 备注里说明由 T024 对拍覆盖

## 文档

- [x] T040 `docs/modules.md`：autoimport 章补「本地包」写法（条目形状、
      目录约定、主库名、缓存键含本地源码）、cb 签名与可写字段的行为、
      troubleshooting（路径错误提示）
- [x] T041 `docs/toolchain.md`：`fjs autoimport` 条目提 path 写法一句
- [x] T042 `specs/160-object-codegen/spec.md` §4 类型映射表追加「cb 的签名与
      可写字段见 specs/201」的注；`demo/README.md` 若提到 playground 的手写
      声明则同步

## 验收

- [x] T050 `pnpm --filter @ufjs/cli test`
- [x] T051 `cd packages/fjs-introspect && dart analyze`
- [x] T052 `pnpm run typecheck` 与 `pnpm test`
- [x] T053 `cd packages/flutter_fjs && flutter test`
- [x] T054 spec.md §6 逐条核对（含第 5 条：改本地包一个签名后不加
      `--force` 就重新 dump）
