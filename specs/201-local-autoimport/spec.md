# Spec: autoimport 支持本地 Dart 包（path 依赖）

- **ID**: 201-local-autoimport
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

specs/159 §11 给 demo 加了 `playground` 对象模块，它是**手写**的
`FjsObjectModule`（`demo/src/main.dart`）加**手写**的 d.ts
（`demo/src/fjs-playground.d.ts`）。手写适配器没有成员元数据，d.ts 没法从它
生成；成员一多，Dart、d.ts、web 替身三份会各自漂移。

`fjs autoimport`（specs/160）已经能对 pub 包自动生成适配器与 d.ts，但**只认
pub.dev 上的包**：

- 条目只能是 `name` 或 `name@版本约束`，写进宿主 pubspec 的是一行
  `name: 约束`，没法写 `path:` 依赖（`ensurePubspecEntry` 也只会改写单行条目）；
- 缓存键只看清单加 `pubspec.lock`，**本地包改了源码、lock 不变就不会重新
  dump**（对 pub 包合理，对正在开发的本地包是个坑）。

读源码另发现三处生成器缺口，playground 这种"普通 Dart 类"直接撞上，对第三方
包同样是缺口：

1. **函数类型只有一个 `cb` 标签，没有签名**
   （`fjs_introspect.dart:315` 的 `if (t is FunctionType) return tag({'k':'cb'})`）。
   后果两个：d.ts 里是 `(...args: never[]) => unknown`，`makeAdder(3)(4)`
   过不了 typecheck；Dart 适配器把参数写成 `args[0] as FjsCallback`，而被调
   方法的形参若是 `void Function(int)`，**生成的 Dart 编译不过**
   （`FjsCallback` 不是 `Function`）。mmkv 恰好没有函数形参所以没暴露。
2. **可写的公开字段没有 setter**：dump 对字段只产出 getter
   （`fjs_introspect.dart:188–201`），`cls.setters` 只含显式声明的存取器，
   `int step = 1;` 在 d.ts 里会变成 `readonly step`，`c.step = 2` 过不了类型。
3. **Future 返回已修**：construct 路径上的静态异步函数此前变成句柄而非
   Promise，已在 specs/159 §11 修掉；本 spec 直接依赖该修复。

## 2. 不做什么（Non-goals）

- **不做运行时反射 / 不动 ABI / 不动 ObjectBridge**：本 spec 只动工具链
  （`@ufjs/cli` 的 autoimport、`fjs-introspect`）与 demo。
- **不支持 git / hosted 私有源**：只加 `path`；其余 pub 依赖写法留给后续。
- **不做 include/exclude 过滤**（160 的 v2 项，另议）。
- **不把本地包当 Flutter 插件处理**：本地包是纯 Dart 包（可依赖
  `flutter_fjs`，不需要原生代码）。
- **GC 路径的 `dispose`**：自动生成的适配器不接用户类的 dispose 钩子（和
  现在的 mmkv 一致），释放语义由类自己的 `release()` 之类的方法表达。
- 不补 Uint8List / Stream / 泛型 / 枚举（159/160 review 已记缺口，不在此）。

## 3. 用户可见的行为

宿主 `package.json`（demo）：

```json
{ "fjs": { "autoimport": [
    "mmkv@^2.4.2",
    { "name": "playground", "path": "dart/playground" }
] } }
```

`demo/dart/playground/`（一个普通本地 Dart 包，主库 `lib/playground.dart`）里
写**普通 Dart 类**，不碰 `FjsObjectModule`：

```dart
class Counter {
  Counter([this.value = 0]);
  int value;
  int step = 1;                       // 可写字段 → JS 可 c.step = 2
  int add(int n) => value += n * step;
  void onTick(void Function(int) fn) { … }   // 函数形参 → JS 函数
  Counter clone() => …;               // 返回同包对象 → 句柄
  int merge(Counter other) => …;
  void release() { … }
}
Future<int> waitFor(int ms) => …;     // 顶层函数 → 模块级可调用
int Function(int) makeAdder(int n) => (x) => n + x;
int liveCount() => …;
```

`fjs run`（或 `fjs autoimport`）后：

- 宿主 pubspec 里是 `playground:\n    path: <相对宿主目录的路径>`；
- 生成 `lib/fjs_objects.dart`（含 playground 适配器，`fjsRegisterObjects` 自动
  注册，`main.dart` 不再有任何模块代码）与 `src/fjs-objects.d.ts`（mmkv 与
  playground 同一个生成文件）；
- 构建输出照旧列出被跳过的成员与原因。

JS 侧不变（`dartModule('playground')`），但类型来自生成物：

```ts
const pg = dartModule('playground');   // PlaygroundModule（生成）
pg.makeAdder(3)(4);                    // (x: number) => number —— 签名进了 d.ts
c.step = 2;                            // 可写字段
```

web 替身 `demo/src/playground-stub.ts` 改为
`import type { PlaygroundModule } from './fjs-objects'` 并按该类型实现——
Dart API 变了，stub 在 typecheck 上就会红，不再靠人对照。
`demo/src/fjs-playground.d.ts` 与 `main.dart` 里的 `_PlaygroundModule` 删除。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 生成的适配器跑 specs/159 通道；本地包与 pub 包同一条流水线 | 不参与：web 无宿主；替身仍手写，但**类型取自生成的 d.ts**，漂移变成编译错误 |
| 事件载荷 | 无新事件号、无 ABI 变更 | 同 |
| 已知差异 | 无 | 同 160：autoimport 只服务 Flutter 端；替身行为一致性靠 playground「一键跑全部」两端 diff（specs/159 T042 的产物） |

### dump 语法变更（fjs_introspect ↔ 生成器的契约，160 §4 表格是权威，需同步改）

| Dart | dump | TS | 过界 |
|---|---|---|---|
| `R Function(P1, P2)` 形参/返回/字段类型 | `{"k":"cb","params":[…],"ret":…}`（旧 `cb` 无 params/ret 仍合法，退回宽签名） | `(a0: P1, a1: P2) => R` | 形参：适配器生成 `(a0, a1) => cb.call([a0, a1])` 闭包；返回：Dart 闭包→JS 函数 |
| 可写公开字段（非 final/const） | getter 之外加 setter（类型即字段类型） | 去掉 `readonly` | set op |

函数类型里含 unsupported 参数/返回时整个 `cb` 退化成旧的宽签名，不是跳过成员
（回调的实参类型在运行时本来就是 JS 值，宽松一点比丢成员好）。

## 5. 契约变更（宪法 II）

- [x] 都不涉及三张运行时契约表（UI op / natives / 事件）
- [x] **工具链契约**（160 已立）新增：
  - `fjs.autoimport` 条目除字符串外可为 `{ name, path }` 对象；
  - dump JSON 的 `cb` 加 `params`/`ret`，类的 setters 含可写字段；
  - 缓存键对本地包追加其 `lib/**/*.dart` + `pubspec.yaml` 的内容哈希。

## 6. 验收标准

1. `pnpm --filter @ufjs/cli test`：autoimport 生成器 golden 新增并全过——
   `{name,path}` 解析与非法形状报错；本地包 pubspec 条目（路径相对宿主目录、
   重复运行幂等、可从 pub 条目改写成 path 条目）；缓存键随本地源码变化；
   `cb` 带签名的 d.ts 与适配器闭包文本；可写字段的 setter 与去 `readonly`；
   旧 mmkv fixture 的输出**逐字不变**（回归线）。
2. `cd packages/fjs-introspect && dart analyze` 零问题。
3. 在 demo 上 `fjs autoimport --force`：dump 出 `.fjs/autoimport/playground.api.json`，
   生成的 `lib/fjs_objects.dart` 对宿主 `dart analyze` 零问题；
   `demo/src/fjs-objects.d.ts` 含 `PlaygroundModule`，`makeAdder` 的类型为
   `(n: number) => (a0: number) => number`（形如此）。
4. `pnpm --filter demo run typecheck` 通过：stub 以生成类型实现、页面
   `pg.makeAdder(3)(4)` 与 `c.step = 2` 类型成立；`demo/src/fjs-playground.d.ts`
   已删，`main.dart` 无 `_PlaygroundModule`。
5. 改 `demo/dart/playground/lib/*.dart` 里一个签名后再跑 `fjs run`：无需
   `--force` 就重新 dump（缓存键感知本地源码）。
6. specs/159 的对拍复跑：web 与 iOS 模拟器「一键跑全部」输出与 `web.txt`
   **逐行一致**（行为不回归，只是来源换成生成适配器）。
7. `pnpm run typecheck`、`pnpm test`、`cd packages/flutter_fjs && flutter test`
   全绿；`docs/modules.md` autoimport 章补「本地包」与新的 dump 语法。

## 7. 待澄清

- [x] 条目写法：对象形式 `{ "name", "path" }`（用户 2026-10-03「1 继续」，取各题第一选项）
- [x] 本地包放 `demo/dart/playground/`
- [x] cb 签名含 unsupported 时退化成宽签名、不丢成员


## 8. 结果（2026-10-03）

- **生成物**：demo 新增 `demo/dart/playground`（普通 Dart 类），`fjs autoimport`
  生成适配器与 d.ts；手写 `_PlaygroundModule`、`fjs-playground.d.ts` 已删，web
  替身改用生成的 `PlaygroundModule` 类型（typecheck 绑定）。生成的
  `lib/fjs_objects.dart` 对宿主 `dart analyze` 无 error/warning；mmkv 的 d.ts
  与改动前逐字一致。
- **两端对拍**：web 与 iOS 模拟器「一键跑全部」13 行输出与 `web.txt` 逐行一致。
- **缓存键**：改本地包源码后不加 `--force` 即重新 dump，还原后再 dump，无改动
  时命中缓存（`dumped now` / `dumped from cache`）。
- **真跑挖出并修掉的三处生成器 bug**（mmkv 没覆盖到，160 的 e2e 漏掉）：
  1. `set` 分支引用未定义的 `args`（任何带 setter 的类都编译不过）；
  2. getter-only 成员被误判为可写（新元素模型把它列成合成非 final 字段）；
  3. 返回给 JS 的 Dart 函数被直接以 double 入参调用，`int Function(int)` 抛类型
     错误——生成器现在为返回的函数按形参类型包一层转换闭包。
  另有 159 §11 的两处 bridge 修复（construct 返回 Future、invoke/get 返回对象
  的归属）同属这条链。
- **测试**：`@ufjs/cli` 463 过（新增 12 条：条目解析、pubspec 接线、缓存键、
  本地包校验、cb 闭包/setter/返回函数包装 golden）；runtime 986、flutter_fjs 773、
  introspect `dart analyze` 零问题、全 workspace typecheck 零错误。
- **未做**：Flutter 端 mmkv 页没重新点一遍（本次只改了它的类型来源，行为同前）；
  cb 的可选/命名参数退回宽签名（设计内）；GC dispose 钩子仍不转发给用户类。
