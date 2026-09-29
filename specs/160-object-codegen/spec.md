# Spec: autoimport —— 配置一个 pub 包，自动生成 Dart 适配器与 TS 类型

- **ID**: 160-object-codegen
- **状态**: done
- **日期**: 2026-09-29

## 1. 要解决什么

spec 159 之后，把一个 Dart 能力暴露给 JS 要手写两层样板：Dart 侧的
`FjsObjectModule` 适配器（construct/invoke/get/set 的成员分发与逐参数
转型）和 TS 侧的接口声明。用户要的是 Lucent 文档阶段 10 的体验——对接
一个**现成的 pub 包**（例：mmkv，腾讯 MMKV 的 Flutter 插件）时，宿主
package.json 配一行：

```json
{ "fjs": { "autoimport": ["mmkv"] } }
```

工具链自动拿到 mmkv 的公开 API（analyzer 解析），生成宿主
`lib/fjs_objects.dart`（Dart 适配器）与 `src/fjs-objects.d.ts`（TS 类型）。
JS 侧只剩：

```ts
import { dartModule } from 'fjs';
const mmkv = dartModule('mmkv');       // 完整类型提示，键名编译期校验
const kv = mmkv.defaultMMKV();         // 静态工厂 → 模块级可调用
kv.encodeString('k', 'v');
kv.decodeString('k');                  // String? → string | null
```

## 2. 不做什么（Non-goals）

- **不做运行时反射**：AOT Dart 无 dart:mirrors（Flutter release）；
  自动化只发生在构建期。已与用户确认：元数据来自 **analyzer 工具包**
  （`fjs_introspect`，宿主的 dev_dependency），不是人工描述表、也不是
  mirrors-hack。
- **不改 spec 159 运行时**：ABI、ObjectBridge、代理机制零改动；一个
  autoimport 包就是一个普通对象模块。
- **不解析函数体/私有成员**：只取公开 API 面（主库 export 链上的顶层
  类与函数）；函数体一律不进生成物。
- **不追求全 API 可绑定**：第三方 API 里 inevitably 有跨不了界的成员
  （BuildContext、枚举、回调签名复杂……）。规则是**可绑定的生成、不可
  绑定的跳过并列在构建输出里**（宪法 V：可见的跳过，不是静默的缺失）。
- v1 不做：命名参数构造、枚举、类静态常量、include/exclude 过滤配置
  （简单 list 起步，结构留好）。

## 3. 用户可见的行为

1. 宿主 package.json 加 `fjs.autoimport: ['mmkv']`，跑 `fjs run`（或
   `fjs autoimport`）：
   - 宿主 pubspec 自动写入 `mmkv`（依赖）与 `fjs_introspect`
     （dev_dependency，checkout 内 path、发布场景 pub 版本），
     `flutter pub get`；
   - 写 `lib/fjs_introspect_entry.dart`（import 各包，供 analyzer
     解析，工具链管理）；
   - `dart run fjs_introspect` 把每个包的 API dump 成
     `.fjs/autoimport/<pkg>.api.json`（按 autoimport 清单 + pubspec.lock
     哈希缓存，不重复 dump）；
   - 生成 `lib/fjs_objects.dart`（`fjsRegisterObjects(engine)`，
     autolink 的 `fjsRegisterModules` 追加调用，main.dart 仍不被碰）与
     `src/fjs-objects.d.ts`；
   - 构建输出列出跳过的成员与原因。
2. JS/TS 里 `dartModule('mmkv')` 有完整补全；`dartModule('nope')` 在
   键名层面就是编译错误（无声明时退回 string 重载，行为同 159）。
3. `fjs autoimport --force` 强制重 dump；`fjs types --check` 能发现
   d.ts 过期。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 生成的适配器跑 spec 159 通道 | autoimport 的 pub 包是 Flutter 插件，web 无宿主：不参与 web；需要 web 的能力由模块按 159 提供 `registerDartModuleStub` |
| 事件载荷 | 无新事件号、无 ABI 变更 | 同 |
| 已知差异 | — | autoimport 只服务 Flutter 端（对象模块的本性，159 已登记的差异） |

### 类型映射（fjs_introspect 与 Node 生成器对着写，JSON 即契约）

| Dart | dump tag | TS | 过界语义（159） |
|---|---|---|---|
| int / double / num | int/num | number | 标量 |
| bool / String | bool/string | boolean/string | 标量 |
| `T?` | tag + `"n":true` | `… \| null` | null 标量 |
| List\<T\> / Map\<String,V\>（**返回值**） | list/map | T[] / Record<string,V> | 出：writeValue JSON 串 |
| List/Map **参数** | — | — | v1 跳过该成员（JS 数组过原生层会降级成字符串，与其撒一个坏类型谎言不如响亮跳过；v2 可在 native 层补 JSON 化） |
| List/Map **回答**（实施修正） | list/map（JSON 文本）+ 新 tag `FJS_T_JSON` | T[] / Record<string,V>（**真数组/真对象**） | 引擎侧 JSON.parse 物化；本表初版写「JSON 字符串」，实现时升级为结构化 tag |
| Future\<T\> | future | Promise\<T\> | PENDING→settle |
| void | void | void | null |
| dynamic / Object | any | unknown | 原样（对象则句柄） |
| 函数类型参数 | cb | (…args: unknown[]) => unknown | FjsCallback |
| autoimport 集合内的类 | cls | 同名接口 | HANDLE 对象引用 |
| 其它（BuildContext、枚举…） | unsupported | — | **跳过该成员**，构建输出列出 |

### 暴露面与命名

- 主库 export 链上的**顶层类**与**顶层函数**；类成员取无名构造、静态
  方法、实例方法、公开 getter/setter/字段。
- 静态方法与顶层函数 → **模块级可调用**（走 construct op，适配器里直接
  调真函数返回结果）：`mmkv.defaultMMKV()`。与类名/彼此冲突时用
  `类$成员` 消歧。
- 生成代码只 import：`package:flutter_fjs/flutter_fjs.dart`（FjsObjectModule/
  FjsMethod/FjsCallback）+ `dart:convert` + 各 autoimport 包主库。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议 / natives 表 / 事件类型——**都不涉及**（运行时零改动）
- [x] 工具链契约（新增，fjs ↔ flutter_fjs ↔ fjs_introspect 三方对着写）：
  - package.json `fjs.autoimport: string[]`（宿主声明）
  - dump JSON 语法（`.fjs/autoimport/*.api.json`，§4 表格是唯一权威）
  - 生成物形状：`lib/fjs_objects.dart`、`lib/fjs_introspect_entry.dart`、
    `src/fjs-objects.d.ts`
  - fjs-runtime 新增导出 `FjsObjectModules`（dartModule 的声明合并点，
    iconmind FjsIcons 同款）

## 6. 验收标准

1. `pnpm --filter @ufjs/cli test`：生成器 vitest 全过——用一张手写的
   mmkv 形状 fixture dump JSON 断言生成的 Dart 适配器与 d.ts（golden），
   覆盖：类构造/静态工厂消歧/方法/getter/setter/Future/null/List+Map
   参数解码/FjsCallback/cls 引用/unsupported 跳过清单/空 autoimport 清
   文件。
2. fjs_introspect 的 dump 逻辑：`dart analyze` 零错；如环境允许，在临时
   宿主上对真实包跑通 dump→generate 全链（留验证记录；不行则在 spec §8
   写明与环境原因）。
3. `pnpm run typecheck` 全绿：fjs-objects.d.ts 的声明合并让
   `dartModule('mmkv')` 返回生成的模块接口；demo 以手写声明演示同一
   机制（无 Dart 宿主也能得到类型）。
4. `fjs types --check` / dev 启动：d.ts 从缓存 dump 生成，无缓存时不
   报错只跳过。
5. docs/modules.md 有 autoimport 指南；roadmap 勾掉「Dart API 自动生成」。

## 7. 待澄清

- [x] 元数据来源（用户已拍板：analyzer 工具包 fjs_introspect）
- [x] JS 侧入口（沿用 `dartModule('mmkv')` 单一入口，生成类型补全；
  不做 autoimport 专属 import）


## 8. 结果（2026-09-29）

- **全链路真实验证**：临时 Flutter 宿主（flutter 3.41-ohos，Dart 3.11.5）+
  真实 pub 包 mmkv，`fjs autoimport --force` 一次跑通——宿主 pubspec 补丁、
  隔离工具包 bootstrap、analyzer dump（4 类 16 方法/字段绑定 + 13 条跳过
  清单，如 `MMBuffer.asList — unsupported type Uint8List?`）、生成
  `lib/fjs_objects.dart` + `src/fjs-objects.d.ts`。生成的适配器对真实包
  `dart analyze` **零问题**；d.ts 形如
  `decodeString(key: string, defaultValue?: string): string | null`。
- **fjs-introspect 包**：`dart analyze` 零问题。适配的是 analyzer 14
  （Element2 迁移后类名已回归无后缀；`definedNames2`/`formalParameters`
  等过渡名）。未命名构造器在本线 analyzer 里名为 `new`，已识别。
- **e2e 抓到并修掉的真 bug**：mmkv 方法大量使用命名参数，生成器初版全按
  位置传参——已改为按名传递（d.ts 的可选参数与之一致）；可空数值参数的
  null-aware 移到 cast 处；dump 工具 `--out` 绝对路径误拼到 root 下。
- **架构修正（比 plan 更进一步）**：plan 原定 fjs_introspect 作为宿主
  dev_dependency——真实验证发现**这条路走不通**：Flutter SDK 钉死
  `meta 1.17.0`，analyzer ≥13.1 要 `meta ^1.18.3`，版本战无解。改为隔离
  工具包 `.fjs/autoimport-tool/`（自带 pubspec + analyzer），宿主依赖图
  只进业务包。此修正同时让「任意 Flutter SDK 版本 × analyzer 版本」解耦。
- **测试**：fjs vitest 新增 autoimport 14 条 golden（fixture mmkv dump →
  生成物逐项断言，含消歧/空集/unsupported）；全量回归：typecheck 8 包、
  runtime 862、cli 443、flutter 562 全绿。
- **demo**：`src/fjs-objects.d.ts` 手写演示声明合并——`dartModule('exerciser')`
  无显式泛型即得类型（vue-tsc 过）。
- **未竟**：发布链（fjs_introspect 发 pub.dev 后，非 checkout 场景的
  `^0.1.0` 回退才可用）；include/exclude 过滤配置（v2）。

## 9. 追加（2026-09-29，二）

- **测试与 demo 全面切换到生成物**：`object_bridge_test.dart` 不再手写
  模块——fixture `test/fixtures/mmkv_objects.g.dart` 是 `fjs autoimport`
  对真实 mmkv 包 dump 生成的适配器（提交进仓库），测试通过插件自身的缝
  （`MMKVPluginPlatform.instance`）注入纯 Dart fake platform（Func 表实现
  指针级 ABI over Map：`getMMKVWithID/encodeBytes/decodeBytes/allKeys/
  freePtr/…`，macOS 上插件不 free 解码结果的行为与 fake 的分配约定一致），
  其上所有层——mmkv Dart 代码、生成适配器、对象 ABI、bridge——全部是真
  实现。Fake 的 `freePtrFunc` 是端到端抓到的最后一个缺失符号。
- **生成器/dump 工具的三处实质修正**（真实包驱动出来的）：
  1. 可选参数不可绑定时**省略该参数**（Dart 默认值生效），不再丢弃整个
     成员——`MMKV(String id, {MMKVMode mode = …})` 因此可绑定；
  2. dump 带出可选参数的 `default` 源码文本 + 包顶层类型名表，生成器对
     非空可选参数应用 `args.length > i ? args[i] : 默认`（null 传给非空
     参数编译都不过），默认表达式按包前缀限定（负向断言防 `p0.p0.`）；
  3. `required` 缺省即必填。
- **demo 纯 autoimport**：package.json `fjs.autoimport: ["mmkv"]`，
  src/main.dart 手写模块清空；页面用真 API（mmapID/count/allKeys/
  totalSize/encodeString/decodeBool/containsKey/removeValue/clearAll）。
  web 端无替身——真实 mmkv 没有浏览器实现，dartModule('mmkv') 响亮
  throw（差异表语义，用户拍板删 stub）。
- **e2e 补记**：`fjs autoimport` 编排对 `fjs.flutterDir` 自定义宿主目录
  的解析与 `.fjs/flutter` 默认一致；d.ts 的 `Ctor` 是调用签名不是 `new`。

## 10. 追加（2026-09-29，三）

- **版本约束**：条目支持 `mmkv@^2.4.2`（原样进宿主 pubspec，pub 全语法）；
  `ensurePubspecEntry` 对已存在行按内容差异重写（空约束可升级为版本）。
- **pubspec 模板直写**：autoimport 依赖进 `writeHostPubspec` 模板——此前
  「重写 pubspec（无 mmkv）→ pub get 移除 → patch 加回 → 再 pub get」的
  两步抖动让每次 `fjs run` 跑两轮 pub get，lock 里 mmkv 出现 "no longer
  being depended on" 再回来的噪声。现在一次到位。
- **iOS 首跑**：mmkv_ios 引入的 pod（MMKVCore ~> 2.4.2）需要宿主
  `ios/` 下 `pod install --repo-update` 一次；已写入 troubleshooting。
  demo 宿主 pod install 成功（7 pods）。
