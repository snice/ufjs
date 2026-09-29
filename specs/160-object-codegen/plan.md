# Plan: autoimport —— pub 包 API 自动绑定

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（差异登记） | autoimport 的对象是 Flutter 插件，web 端无宿主：spec §4 差异表登记；web 需要的能力仍走 159 的 registerDartModuleStub。这不是功能缺口而是对象模块的本性。 |
| II 边界即契约 | 是 | 新增工具链契约三方对着写：dump JSON 语法（fjs_introspect ↔ @ufjs/cli 生成器）、生成物形状（lib/fjs_objects.dart 等）、fjs.autoimport 配置。运行时（三张契约表）零改动；fjs-runtime 只新增一个导出接口（声明合并点）。 |
| III 同步单线程零序列化 | 是 | 生成的适配器跑在 159 通道上；List/Map 入参的 jsonDecode 发生在 Dart 适配器内（跨界仍是富 FJSValue），不新开 JSON 桥。 |
| IV 外观照 WeUI | 否 | 无 UI。 |
| V 静默失效是 bug | 是 | 不可绑定的成员**跳过并列在构建输出**（原因 + 成员名）；dump 失败、analyzer 解析失败、配置指向不存在的包都报错退出；`fjs types --check` 报 stale d.ts。 |
| VI 注释记录权衡 | 是 | 生成器与 dump 工具的头部注释记录：为何 analyzer 而非 mirrors（弃用）/人工表（不自动）、为何静态工厂走 construct op、List/Map 为何在 Dart 侧 jsonDecode。 |
| VII JS 能包就不要下 Dart | 是（反向） | 能力本体是 Dart 插件对象；工具链部分下沉的是构建期 Node 代码（autolink/prepare 同层），不动运行时。 |
| VIII 变更落到文档 | 是 | docs/modules.md（autoimport 章）、docs/roadmap.md（勾掉自动生成）、docs/toolchain.md 提一笔命令（fjs autoimport）。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/project/autoimport.ts`（新） | 配置读取、pubspec 补丁、缓存、entry 文件、dump 调度、两个生成器（dart/dts，纯函数） |
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | 宿主同步流程挂 syncAutoimport（autolink 之后）；writeHostAutolink 支持追加 objects 注册调用 |
| CLI / 构建 | `packages/fjs/src/commands/types.ts`、`src/vite.ts` | d.ts 从缓存 dump 生成（无缓存跳过） |
| CLI / 构建 | `packages/fjs/src/cli.ts` | `fjs autoimport [--force]` |
| JS runtime | `packages/fjs-runtime/src/dart-bridge.ts` | `FjsObjectModules` 导出接口 + dartModule 类型重载 |
| 工具包 | `packages/fjs-introspect/`（新 pub 包） | analyzer dump：pubspec + lib/fjs_introspect.dart |
| 宿主 | demo 不动 | demo 无 Dart 宿主；E2E 靠 fjs vitest golden + 临时宿主验证 |
| 测试 | `packages/fjs/test/autoimport.test.ts`（新） | 生成器 golden（fixture dump JSON → dart/dts 逐字符） |
| 测试 | `packages/fjs-runtime/test/dart-bridge.test.ts` | 类型重载的编译级行为（vitest 内 tsc 断言可选，主要靠 workspace typecheck） |
| 文档 | `docs/modules.md`、`docs/roadmap.md`、`docs/toolchain.md` | autoimport 指南 / roadmap 勾选 / 命令一行 |

## 3. 方案

**管线**：`fjs.autoimport: ['mmkv']` → 宿主 pubspec 写入 `mmkv` 依赖 +
`fjs_introspect` dev_dependency（checkout 内 path 到 `packages/fjs-introspect`，
发布场景 pub 版本，与 flutter_fjs 同一判别逻辑）→ `flutter pub get` →
写 `lib/fjs_introspect_entry.dart`（每个包一行
`import 'package:mmkv/mmkv.dart' as p0;`）→ `dart run fjs_introspect
--root . --package mmkv … --out .fjs/autoimport` → 生成两个文件 →
autolink 的 `fjsRegisterModules` 追加 `fjsRegisterObjects(engine);`。
缓存键 = autoimport 清单 + 宿主 pubspec.lock 哈希；不命中才重 dump。

**fjs_introspect（analyzer）**：写 entry 文件 → `AnalysisContextCollection`
解析 → 沿 import 前缀取 `exportedNamespace`（吃全 export 链）→ 顶层
类/函数 → 类的无名构造/静态方法/实例方法/公开存取器 → 类型按 §4 语法
序列化（含可空标志）。跨包类引用只在本次 dump 集合内解析为 cls，其余
unsupported。认不出的一律 unsupported + 理由，绝不 throw 整个 dump。

**生成器（Node 纯函数）**：dump JSON → Dart 适配器（construct/invoke/
get/set 的 switch，逐参数按类型转型：标量 `as T`、list/map
`jsonDecode…cast`、cb `as FjsCallback`、cls `as T`）+ d.ts（接口 +
`declare module '@ufjs/runtime'` 增广）。静态方法/顶层函数 → 模块级
可调用（construct op 直调返回）；冲突 `$` 消歧。

**被否掉的备选**：
1. *dart:mirrors + flutter test*——零依赖但 mirrors 已被官方弃用、每轮
   dump 要跑 flutter test（慢）、Flutter 升级易碎；用户已拍板 analyzer。
2. *人工描述注册库*——今天最快但对任意包不自动，与用户目标相反；可作
   为日后热门包的加速层叠加，不冲突。
3. *把 analyzer 塞进 flutter_fjs 依赖*——所有 flutter_fjs 消费者都背上
   analyzer；作为独立 dev_dependency 工具包，只有 autoimport 用户付出。
4. *build_runner/source_gen*——给宿主引入二次构建系统，`fjs dev` 的
   Node 工具链无法直接调度；独立 `dart run` 工具同效且无侵入。

## 4. 风险

- **analyzer 版本约束与宿主 Flutter SDK 的传递约束冲突**：pubspec 用宽
  区间（`>=5.12 <8.0.0` 起步），冲突时 pub 解析报错是**响亮的**，用户可
  以 dependency_override——记录在 modules.md 的 troubleshooting。
- **dump 与生成物不同步**：缓存键（清单+lock 哈希）覆盖包集合变化；
  包内容升级不换版本不触发——`fjs autoimport --force` 兜底，文档写明。
- **生成物里出现宿主不可见的符号**（导出链里有 src/lib 拆分）：dump 按
  exportedNamespace 走的是同一链条，风险低；golden 测试钉住形状。
- **静态方法消歧的命名稳定性**：`$` 规则在生成器里唯一确定，d.ts 与
  Dart 两侧由同一函数产出，不会漂移。
- **对拍点**：生成的 Dart 是否合法——本仓库内用 `dart analyze`（对
  fjs_introspect 包）+ 若网络/时间允许在临时宿主上真实跑通 dump→
  generate；golden 测试钉住生成文本。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli test          # 生成器 golden
pnpm run typecheck && pnpm test       # 全 workspace
cd packages/fjs-introspect && dart analyze   # 工具包静态检查
# 真实链路（可选，需网络与 Flutter）：
fjs autoimport --force                # 在临时宿主（mmkv 在 fjs.autoimport 里）
```
