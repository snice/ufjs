# 模块（fjs create module）

> 第三层第 1 篇。**不动引擎就能加能力**的标准途径：一个 npm 包同时带
> JS API、Vue 组件和 Flutter widget，装上即 autolink。
> 要动 C++ 引擎本身请看 [jsi-and-native-modules.md](jsi-and-native-modules.md)。

页面和组件是**这个项目里**的东西；模块是**能拿走**的那一份：它有自己的
package.json，有 API，有组件，需要的话还有 Dart 侧，然后可以直接
`npm publish`。别人 `npm i` 之后不用配置任何东西——裸导入、全局组件、
类型提示、Flutter 依赖都自动生效，这就是 RN 的 autolink，换成一个
package.json 字段。

```bash
fjs create module qrcode              # API + 组件
fjs create module qrcode --flutter    # 再加上 Dart 侧：host 模块 + Flutter widget
fjs modules                           # 现在都链上了什么
```

## 目录长什么样

```text
src/modules/qrcode/
  package.json            清单，也是 npm publish 读的那份
  index.ts                API：export function decode() {}
  components/
    QrcodeView.vue        组件：<QrcodeView /> 直接用，不用 import
    QrcodeWidgetWeb.vue   --flutter 才有：widget 在浏览器里的替身
  flutter/                --flutter 才有
    pubspec.yaml          Dart 包 fjs_qrcode
    lib/fjs_qrcode.dart   host 模块 + <qrcode-widget /> 背后的 Flutter widget
  README.md
```

用起来就是一个普通的 npm 包：

```ts
import { ping } from 'qrcode';

const res = ping('hi');
```

```vue
<template>
  <!-- 没有 import，组件是全局注册的 -->
  <QrcodeView label="扫一扫" />
</template>
```

**本地的 `src/modules/qrcode` 和装好的 `node_modules/qrcode` 行为完全一样**：
同一个 package.json，同一个裸标识符。本地那份靠构建别名解析，装上的那份靠
node 解析，其余的（组件注册、类型、autolink）两边共用一条代码路径
（`packages/fjs/src/project/modules.ts`）。所以"先本地写，写好了发出去"中间
不需要改任何调用方代码。

## 清单：package.json 的 `fjs` 字段

```json
{
  "name": "qrcode",
  "version": "0.0.1",
  "type": "module",
  "types": "./index.ts",
  "exports": { ".": "./index.ts", "./components/*": "./components/*" },
  "fjs": {
    "module": true,
    "components": "components",
    "componentPrefix": "Qrcode",
    "flutter": {
      "package": "fjs_qrcode",
      "path": "./flutter",
      "import": "package:fjs_qrcode/fjs_qrcode.dart",
      "register": "FjsQrcode.register(engine)"
    }
  }
}
```

| 字段 | 含义 |
|------|------|
| `module` | 装在 node_modules 里时的开关：`true` 才会被扫到。`src/modules/*` 默认就是模块，写 `false` 可以排除 |
| `entry` | 入口文件，默认取 `module` / `main` / `index.ts` |
| `components` | 组件目录，默认 `components`；`false` 表示纯 API 模块 |
| `componentPrefix` | 全局组件名前缀，默认包名的 PascalCase。`QrcodeView.vue` 已经带前缀就不会变成 `QrcodeQrcodeView` |
| `widgets` | 由 Flutter widget 渲染的标签，见下面 |
| `prepare` | 构建期代码生成钩子，见下面 |
| `flutter.package` | pub 包名，会写进宿主 pubspec |
| `flutter.path` / `flutter.version` | 依赖来源：模块内的路径，或 pub.dev 上的版本约束 |
| `flutter.import` | 宿主要 import 的 Dart 库，默认 `package:<package>/<package>.dart` |
| `flutter.register` | 在 `runApp` 之前执行的一行 Dart，作用域里有 `engine` |

模块**以源码发布**：fjs 自己编译 TS 和 SFC，中间没有构建步骤，所以
`npm publish` 前不需要 build。

模板生成的 `files` 把 `flutter/` 枚举成 `flutter/lib` +
`flutter/pubspec.yaml`，而不是整个目录——npm 的 `files` 白名单**优先于
`.gitignore`**，写成 `'flutter'` 的话，第一次在这个目录里跑 `flutter test`，
`.dart_tool/`、`build/`、`.flutter-plugins*` 这些工具残留就会被打进发布包
（@ufjs/webview 0.1.3 踩过，发出去 45 MB 的测试缓存）。ohos 子目录同理：
`ohos/build`、`oh_modules`、`oh-package-lock.json5`、`BuildProfile.ets` 都是
构建产物（@ufjs/webgl 把 `flutter/ohos` 枚举到具体文件和 `src`）。包内的嵌套
`.gitignore`（比如 `ohos/.gitignore`）npm 也会读，能兜一层底，但别依赖它——
仓库根的 `.gitignore` 对 npm 是不可见的，显式枚举 `files` 才是契约。

## 代码提示是怎么来的

工具链生成两个声明文件（`fjs build` / `fjs dev` / Vite 启动时都会刷新，
模板的 `.gitignore` 已经忽略它们）：

- `src/fjs-modules.d.ts` — 把裸标识符指到模块自己的源码，所以
  `import { ping } from 'qrcode'` 能补全、能跳转，跳过去是真实的
  `index.ts` 而不是 `any`。只声明本地模块；装上的包用它自己的 `types`。
- `src/fjs-components.d.ts` — 把模块组件写进 Vue 的 `GlobalComponents`，
  所以模板里 `<QrcodeView />` 有提示，属性写错是编译错误。

组件的运行期注册走的是生成模块 `fjs/plugins`（和 `src/plugins/*.ts` 同一个
列表），也就是说已有项目**一行都不用改**：`createFjsApp({ plugins })` 已经
把它们带上了。

## Flutter widget 扩展

组件是 Vue 写的；**widget 是 Dart 写的**——标签背后是一个真正的 Flutter
widget（相机、地图、原生列表、platform view）。声明在清单的 `widgets` 里：

```json
"fjs": {
  "widgets": {
    "qrcode-widget": {
      "web": "./components/QrcodeWidgetWeb.vue",
      "mp": "./mp/qrcode-widget/qrcode-widget",
      "props": { "label": "string" }
    }
  }
}
```

`mp` 是可选的小程序端组件四件套（`<basename>.{js|ts,json,wxml,wxss}`，
同样放在模块包里）：`fjs build --mp` 把它拷进产物
`fjs/modules/<包名>/<tag>/` 并写进 usingComponents。不声明 `mp` 的
widget 在小程序端没有实现，用到它的页面应进 `fjs.mp.exclude`。

Dart 侧就是 `ComponentRegistry`（和 host 模块同一个 `register` 里注册）：

```dart
class FjsQrcode {
  static void register(FjsEngine engine) {
    engine.components.register('qrcode-widget', _build);
  }

  // ComponentBuilder：参数类型靠推导，node 是标签的 props/children
  static final ComponentBuilder _build = (context, node, children, dispatch) {
    final label = node.props['label'] as String? ?? '';
    return GestureDetector(
      onTap: () => dispatch(node.id, FjsEvent.tap),
      child: Text(label),
    );
  };
}
```

页面里直接写标签，不用 import：

```vue
<template>
  <qrcode-widget label="扫一扫" @tap="onTap" />
</template>
```

工具链为此做了三件事：

- **模板编译**：widget 标签被当作**元素**而不是组件，所以渲染器会把标签原样
  送给引擎，由 Dart 的 ComponentRegistry 接住（未知标签本来就走这条路）。
- **Web 替身**：浏览器里没有 Flutter，`web` 指的那个 SFC 会以**同一个标签名**
  注册成组件——页面只写一次，两端都能跑。没写 `web` 的标签在 Web 上仍然是
  元素：空白一块，而不是报错。
- **类型**：有替身就以替身 SFC 的 `defineProps` 为准；没有就用清单里的
  `props`（都按可选处理）生成 `GlobalComponents` 条目。

`props` 的值是 TS 类型的字符串，会原样写进生成的 d.ts。

写 builder 需要 `MirrorNode`（props / text / children）——它从
`package:flutter_fjs/flutter_fjs.dart` 导出；上面用 `ComponentBuilder` 声明
是为了让参数类型靠推导得到，这样在旧版本 flutter_fjs 上也能编译。

事件用 `dispatch(node.id, FjsEvent.tap)` 回到 JS，对应模板里的 `@tap`。

### 读自己的构建产物：devUri 与 fetch

带 prepare 的模块（下一节）会生成一份数据文件，release 时被拷成 asset，dev 时
由 dev server 现做现发。`register` 拿到的 `engine` 已经知道地址、也已经有一个
HttpClient——模块不用自己 `String.fromEnvironment('FJS_DEV')`，也不用自己开
`HttpClient`：

```dart
static Future<String> _source(FjsEngine engine) {
  final dev = engine.devUri;                       // 没连 dev server 时是 null
  return dev == null
      ? rootBundle.loadString('assets/fjs/modules/iconmind/icons.json')
      : engine.fetchString(dev.replace(path: '/modules/iconmind/icons.json'));
}
```

| 成员 | 作用 |
| --- | --- |
| `engine.devUri` | 已连接的 `fjs dev` 的地址，release 下为 null |
| `engine.devFetch(path)` | 从 dev server 取一个路径（没连接则抛） |
| `engine.fetch(url, {...})` / `fetchString(url, {...})` | 任意请求，走的是 JS `fetch()` 那同一个 client，引擎销毁时一起收摊 |

`devUri` 是在 `connectDev()` 里才有值的，而 `register` 在那之前跑——所以缓存要
跟着引擎的 reload 失效（`engine.addListener` + `engine.tree.generation`），dev
连上后自然会重新取一次。iconmind 就是这么做的。

## prepare：模块的构建期代码生成

有些模块的数据取决于**用它的 app**：页面画了哪些图标、装了哪些语言包、发了哪些
query。要求每个使用者自己抄一个脚本、再往 package.json 里塞一段配置，就是把
"装完即用"打回原形——所以模块可以自带一步构建：

```json
"fjs": { "module": true, "prepare": "./prepare.mjs" }
```

`fjs build` / `fjs dev` / Vite 启动前都会调用它，默认导出一个函数：

```js
export default async function prepare(ctx) {
  const used = ctx.sources()                    // app 的源码（不含本模块）
    .flatMap((f) => scan(fs.readFileSync(f, 'utf8')));
  ctx.write('icons.json', JSON.stringify(pick(used)));   // 写进 .fjs/modules/<name>/
  ctx.write('types.d.ts', declare(used));
  ctx.log(`${used.length} icons`);
}
```

| ctx | 是什么 |
|-----|--------|
| `root` | 项目根目录 |
| `platform` | 这次构建是 `app` 还是 `web` |
| `module` | `{ name, dir }` |
| `outDir` | 产物目录 `.fjs/modules/<name>/`（已建好） |
| `sources()` | app 自己的源码文件，用来扫用法 |
| `write(name, contents)` | 写进 outDir；内容没变就不落盘（dev server 在监听这棵树） |
| `log(...)` | 带模块名前缀的输出 |

产物三条去处，都不用 app 操心：

- **JS**：模块自己的代码 `import 'fjs/data/<file>'`——这个标识符由**导入方在哪个
  模块里**决定，所以一个模块只能读到自己的目录。动态 import 的话打包器会给它单独
  切一个 chunk。
- **Dart**：`fjs run` / `fjs build --release` 生成宿主时把 `.fjs/modules/<name>/`
  拷进宿主 assets，模块的 Dart 侧读
  `assets/fjs/modules/<name>/<file>`（模块自己的 pub 包声明不了这些——它们是
  按 app 生成的，node_modules 也不是能写的地方）。
- **类型**：写一个 `types.d.ts`，生成的 `src/fjs-modules.d.ts` 会 reference 它，
  app 不用改 tsconfig。

一句话的前提：**prepare 是模块代码在构建时执行**，信任级别和装一个带 bundler
plugin 的 npm 包一样——只会跑项目自己依赖的模块。

## Flutter 侧 autolink

`fjs run` / `fjs build --release` 生成 Flutter 宿主时，扫描到的每个带
`fjs.flutter` 的模块都会：

1. 往宿主 `pubspec.yaml` 的 `dependencies` 里加上它的 pub 包；
2. 往 `lib/main.dart` 加上 import 和 `register` 那一行，位置在 `runApp` 之前。

JS 侧对应的就是 `invokeHost('qrcode.ping', …)`——通道还是
[JSI 那两条](jsi-and-native-modules.md)，autolink 只负责让宿主知道这个
host 模块存在。

### 同步还是异步

`engine.host.register` 注册的 handler 必须当场返回结果（它是 JSI 同步
回调）；能力是 `Future` 结尾的——插件读写、权限申请、三方 SDK——用
`registerAsync`，JS 侧拿 Promise：

```dart
engine.host.registerAsync('qrcode.scan', (args) async {
  final code = await scanner.scan();
  return {'code': code};
});
```

```ts
const { code } = await invokeHostAsync('qrcode.scan');
```

参数整体作为一个 JSON 数组串过界（handler 收到解码后的 `List<Object?>`），
返回值必须 JSON 可编码；未注册的名字、handler 抛异常、返回值不可编码都会
让 JS 侧 reject，不会悬挂。时序与载荷形状见
[jsi-and-native-modules.md](jsi-and-native-modules.md#invokehostasync通用的异步宿主调用spec-039)。
web 端没有 Dart 宿主：模块的 web 实现直接走浏览器 API，`invokeHostAsync`
在 web 上 reject 是登记过的边界，不是 bug。

`fjs host eject` 之后的宿主属于你自己，fjs 不再改写它的 Dart 和 pubspec：
这时 `fjs run` 会把需要手动补的两行打印出来，`fjs modules` 也随时能查。

在本仓库里开发时，宿主用 path 依赖 `flutter_fjs`，而模块的 Dart 包依赖
pub.dev 上的版本——生成的 pubspec 会带一条 `dependency_overrides`，把两者
指到同一份代码，否则 pub 会拒绝解析。

## 分包时的一份实例

`fjs build --pages` 把模块名当作共享裸标识符：模块代码进 `shared.js`，每个
page chunk 通过 `__FJS_SHARED['qrcode']` 拿同一个实例。模块里的模块级状态
（缓存、单例）因此在所有页面之间是同一份，和 pinia 的处理方式一致，见
[分包](code-splitting.md)。

## 一个完整的例子

仓库里的 `packages/fjs-iconmind`（npm 包 `@ufjs/iconmind`）是照这套约定写的真模块：把
[IconMind](https://iconmind.dev)（MIT）的图标包成一个 `<icon-mind />` 标签——
App 上 Flutter 绘制，Web 上内联 SVG，`demo` 的 `/icons` 页面两端共用同一段模板——demo 对它就是一条普通的 npm 依赖，
和使用者装它的方式一样。
它用到了这里说的大部分东西：API（类型）、widget（`<icon-mind />` 加 Web 替身）、
autolink（`fjs_iconmind` 进宿主 pubspec 和 main.dart）。

另一个更纯粹的例子是 `packages/fjs-webgl`（`@ufjs/webgl`）：canvas 的
`getContext('webgl'/'webgl2')` 整个 WebGL 实现（JS 侧 GL 指令流编码 +
Dart 侧 flutter_angle 执行，spec 021/022）。它演示了**没有组件、没有
widget、纯上下文扩展**的模块形态——index.ts 在 import 时把两种 context
类型注册进 runtime 的 context 注册表，Dart 侧通过 flutter_fjs 的 canvas
接缝（display override / readback / dispose）挂上 Texture 视图与
`fjs.webgl.*` host 模块。不装它的 app `getContext('webgl')` 两端一致
返回 null，ANGLE 原生库也完全不进包。

值得抄的是它划边界的方式：**模块不带图标，只知道怎么画**；画哪些由 app 决定，
但 app 什么都不用配——它的 `prepare` 钩子扫描 app 源码里写了哪些
`<icon-mind name="…" />`，生成对应的图形数据和类型。使用者的全部流程就是：

```bash
npm i @ufjs/iconmind
```
```vue
<icon-mind name="agent" />
```

模板里没法扫到的（名字来自接口、路由参数），放进项目根的 `iconmind.json`——这是
模块自己的配置文件，不占 package.json。

类型也是钩子写的：模块声明一个空的全局 `interface FjsIcons`，钩子按扫到的名字填
键，于是 `<icon-mind name="…" />` 能补全、写错就是编译错误。这和路由名的
`FjsRoutes` 是同一个套路，值得照抄：没生成过的项目里它是空的，`IconName` 退回
`string`，功能不受影响。

## 命令

| 命令 | 用途 |
|------|------|
| `fjs create module <name>` | 生成 `src/modules/<name>` |
| `... --component <Name>` | 指定要生成的组件（默认 `<Name>View`） |
| `... --no-component` | 纯 API 模块 |
| `... --prefix <P>` | 全局组件前缀 |
| `... --flutter` | 连 Dart 侧一起生成（host 模块 + widget + Web 替身），并写好 autolink 清单 |
| `... --widget <tag>` | 指定 widget 标签（默认 `<name>-widget`），隐含 `--flutter` |
| `... --no-widget` | 只要 host 模块，不要 widget |
| `... --dry-run` / `--force` | 只打印 / 覆盖已有文件 |
| `fjs modules` | 当前解析到的模块、它们的标签和 autolink |
| `fjs modules --json` | 同上，机器可读 |

## 模块带静态网页资源

`prepare` 写进 `.fjs/modules/<name>/` 的东西，默认是**数据**：JS 侧 `import
'fjs/data/<file>'`，Dart 侧从 `assets/fjs/modules/<name>/<file>` 读。但有一类东西不是
给代码读的，是给浏览器**取**的——`web-view` 要加载的 HTML 就是这样。它得在一个 URL
后面。

三处各自提供同一份文件：

| 场景 | 谁提供 | URL / 键 |
|---|---|---|
| app dev | `fjs dev` 的 `/modules/<name>/<file>` 路由 | `http://<devHost>/modules/<name>/<file>` |
| app release | 构建复制进 Flutter assets | `assets/fjs/modules/<name>/<file>`（`loadFlutterAsset` 的**键**，不是 URL）|
| web | fjs 的 vite 插件（dev）与 web 构建（build） | `/fjs-modules/<name>/<file>` |

**三处都是现成机制，钩子只写 `.fjs/modules/<name>/` 这一份。** web 那一处由
`fjs` 的 vite 插件在 dev 时用中间件顶上、在 build 时拷进产物，`fjs build --web`
同样拷一份 —— 不用 `publicDir`，因为 vite 只有一个而它属于应用。

> 这里曾经是另一个样子：钩子在 `platform === 'web'` 时把文件**再拷一份**进应用的
> `public/fjs-modules/<name>/`，是唯一一次写到 `outDir` 之外。当 `public/` 开始
> 整目录进 Flutter 包之后（specs/017-local-image-assets），那份副本就成了每个
> release 包里的重复文件，而 app 侧从来不读它。现在由工具链给唯一那份文件一个
> web URL（specs/018-src-hints-and-html-dir），**钩子不应该再往应用目录里写东西**。

两个坑，都是真机上才现形的：

- **content-type**：dev server 的 `/modules/` 路由早年只服务 `icons.json`，content-type
  写死成 `application/json`。喂给 WebView 一个 `application/json` 的 HTML，它会把源码
  当文本显示，**而且 `@load` 照常派**——只看事件是发现不了的。现在按扩展名给
  （`packages/fjs/src/dev/server.ts` 的 `moduleContentType`）。
- **release 的 asset 键不能带查询串**：`demo.html?q=1` 不能直接作为
  `loadFlutterAsset` 的 manifest 键。`@ufjs/webview` 会用 `demo.html` 查找文件，再把
  `?q=1` / `#…` 恢复到页面 URL，因此页面仍可读取参数；其它模块若直接调用
  `loadFlutterAsset`，仍必须自行把文件键和 URL 参数分开。

## 对象模块：把 Dart 对象暴露给 JS（spec 159）

host 模块是「JS 调一个 Dart 函数」；对象模块是「JS 持有一个 Dart 对象」。
实现 `FjsObjectModule` 并注册到 `engine.objects`：

```dart
class StorageModule extends FjsObjectModule {
  @override
  Object? construct(String className, List<Object?> args) =>
      className == 'Bucket' ? Bucket(args[0] as String) : null;

  @override
  Object? invoke(Object instance, String member, List<Object?> args) {
    final bucket = instance as Bucket;
    switch (member) {
      case 'get':    return bucket.get(args[0] as String);      // 返回 Future → JS 侧是 Promise
      case 'clear':  return bucket.clear();                     // 返回 null → undefined
      default: throw StateError('no member "$member"');
    }
  }

  @override
  Object? get(Object instance, String member) =>
      member == 'size' ? (instance as Bucket).count
                       : FjsMethod.instance;   // 默认：所有成员都是方法

  @override
  void set(Object instance, String member, Object? value) { … }
  @override
  void dispose(Object instance) => (instance as Bucket).close();
}

engine.objects.registerModule('storage', StorageModule());
```

```ts
import { dartModule } from 'fjs';
const storage = dartModule<StorageModule>('storage');
const bucket = storage.Bucket('cache');
await bucket.get('key');      // Dart Future 自动是 Promise
```

### SPI 规则

- **无反射**：编译期 Dart 拿不到成员表，adapter 就是成员表本身。
  `get` 返回 `FjsMethod.instance` 表示「该成员是方法」（默认），返回
  其他值则是字段值。
- **值语义**（两侧对着写，`object_bridge.dart` 的 `writeValue` 与
  `object_abi.cpp` 的 `write_out_value`）：标量直通；`List`/`Map` 按 v1
  规则过 JSON 串；`Function` 变成 JS 可调用（宿主闭包）；`Future` 变
  pending promise（结算推迟到微任务，遵守「invokeHost 栈内不许回派」）；
  其余对象自动注册句柄（已注册的复用同一句柄）。回调参数是 `FjsCallback`，
  像普通函数一样调用。
- **生命周期**：JS 代理被 GC 或 JS 调 `release` 时 `dispose` 被调；engine
  reset 后全部句柄作废，迟到调用响亮报错。
- **web 替身**：模块包（或宿主 app）用
  `registerDartModuleStub(name, tsImpl)` 注册同名 TS 实现，业务代码不改
  一行跑两端（iconmind 的 web 组件同款模式）。autoimport 的生成物与手写
  模块可并存，同名注册优先。demo 有两页对照：
  `dart-objects`（`demo/src/pages/basic/dart-objects.vue`）是纯 autoimport，
  mmkv 全靠生成适配器，浏览器没有实现，页面用 `hasDartObjectSupport()` 守卫、
  web 上只显示说明；`dart-playground`
  （`demo/src/pages/basic/dart-playground.vue`）驱动 `playground` 模块：
  Dart 是 `demo/dart/playground` 里的**普通类**（本地包 autoimport，适配器与
  类型都是生成的，见下一节「本地包」），web 替身在
  `demo/src/playground-stub.ts`（类型取自生成的 `PlaygroundModule`），覆盖
  Future→Promise、回调双向、句柄传参与 release，「一键跑全部」输出的文本两端
  逐行一致，可直接 diff。手写 `FjsObjectModule` 时注意 `main.dart` 会被原样拷成
  `lib/fjs_attach.dart`，只能内联在这一个文件里。
- **适配器返回对象的归属**：`invoke`/`get` 返回的新对象（工厂方法、子对象
  getter）自动归属于交出它的模块，之后在 JS 侧可继续调成员；`construct` 返回
  `Future`（静态异步函数）同样是 Promise。

## autoimport：配置一个 pub 包，自动绑定（specs/160）

对象模块的适配器是纯机械分发——它只做「成员名 → 真方法」。`fjs autoimport`
把这层自动化了：对接一个**现成的 pub 包**（mmkv、shared_preferences 这类
Flutter 插件），宿主 package.json 配一行：

```json
{ "fjs": { "autoimport": ["mmkv"] } }
```

`fjs run` / `fjs autoimport` 会：

1. 宿主 pubspec 写入 `mmkv` 依赖（只有业务包——dump 工具**不进宿主依赖
   图**，见下）并 `flutter pub get`；
2. 物化独立工具包 `.fjs/autoimport-tool/`（fjs_introspect，analyzer 实现），
   在它自己的依赖图里 `dart pub get` + `dart run fjs_introspect`，把每个包
   的公开 API dump 成 `.fjs/autoimport/<pkg>.api.json`（按 autoimport 清单 +
   pubspec.lock 哈希缓存，`--force` 强制重 dump）；
3. 生成宿主 `lib/fjs_objects.dart`（`FjsObjectModule` 适配器 +
   `fjsRegisterObjects(engine)`，autolink 自动接线）与项目
   `src/fjs-objects.d.ts`（类型声明合并进 `FjsObjectModules`）。

JS 侧直接用：

```ts
import { dartModule } from 'fjs';

const mmkv = dartModule('mmkv');   // 键名编译期校验、返回类型完整
const kv = mmkv.MMKV('config');    // 构造器
kv.encodeString('k', 'v');
kv.decodeString('k');              // String? → string | null
```

### 本地包（specs/201）

自己的 Dart 能力不必手写适配器：把它写成项目里的一个**普通本地 Dart 包**
（`pubspec.yaml` + `lib/<name>.dart` 为主库），条目写成对象形式，`path` 相对
项目根：

```json
{ "fjs": { "autoimport": [
  "mmkv@^2.4.2",
  { "name": "playground", "path": "dart/playground" }
] } }
```

宿主 pubspec 里是 `path:` 依赖（相对宿主目录，自动换算）；条目的 `name` 必须与
该包 pubspec 的 `name` 一致、`lib/<name>.dart` 必须存在，否则**报错退出**而不是
等 analyzer 在深处失败。本地包随时在改，所以缓存键除清单与 `pubspec.lock` 外还
并入它的 `pubspec.yaml` 与 `lib/**/*.dart` 内容——改了源码下次 `fjs run` 自动
重新 dump，不需要 `--force`。

普通 Dart 写法即可：

```dart
class Counter {
  Counter([int initial = 0]);
  int step = 1;                              // 公开可写字段 → JS 可赋值
  int get value => …;                        // 只有 getter → readonly
  void onTick(void Function(int) fn) {…}     // 函数形参 → 传 JS 函数进来
}
Future<int> waitFor(int ms) => …;            // 顶层函数 → 模块级可调用，Promise
int Function(int) makeAdder(int n) => …;     // 返回函数 → JS 得到可调用
```

生成的 d.ts 带函数签名：`onTick(fn: (a0: number) => void)`、
`makeAdder(n: number): (a0: number) => number`。函数类型里有跨不了界的参数
/ 返回、或有命名/可选参数时，整个函数类型**退回宽签名**
`(...args: never[]) => unknown`（成员保留，构建输出列一行），因为回调的实参
运行时本来就是 JS 值。web 端的 TS 替身直接 `import type` 生成的模块接口来实现
——Dart 签名变了，替身在 typecheck 就红。

### Widget 包：用本地 facade 包一层（specs/202）

带 UI 的 pub 包（弹窗、选择器……）入口往往要 `BuildContext`，还带 `Color` /
`TextStyle` 这类 Widget 选项，autoimport 绑不了（构造器会被整个跳过）。办法是
本地包里写一个**无 context 的门面类**，公开签名只用
`String/int/bool/Future/函数`，再按上一节当本地包 autoimport。demo 的
`dart/progress` 包 `sn_progress_dialog` 就是这个形状：

```dart
class Progress {
  Progress([String msg = 'Loading', int max = 100]);
  Future<void> show([bool determinate = false]);   // 弹窗关闭时 resolve
  void update(int value, [String? msg]);
  void onStatus(void Function(String) fn);         // opened | closed | completed
}
```

context 由**宿主**接线：门面里放一个顶层 provider（顶层变量不被 autoimport 绑定），
宿主在 `fjsAttachHost` 里赋值，取当前挂载的 `FjsApp`：

```dart
progress.progressContext = () => FjsApp.currentContext;
```

`FjsApp.currentContext` 是 `flutter_fjs` 的公开静态入口（内部 Navigator 的
context，未挂载为 null，只暴露 context 不暴露 State）。没接线时门面构造抛带说明的
`StateError`，不会悄悄不弹。弹窗要有 Material 祖先（宿主的 `MaterialApp`）。
这类原生弹窗 web 上没有对应实现，页面用 `hasDartObjectSupport()` 守卫（见
`demo/src/pages/basic/dart-progress.vue`）。

### 规则与边界

- **公开 API 面**：主库 export 链上的顶层类与函数；类成员取无名构造、
  静态方法、实例方法、公开 getter/setter/字段。静态方法与顶层函数摊平为
  模块级可调用（`mmkv.defaultNameSpace()`），与类名冲突时 `类$成员` 消歧。
- **可绑定的生成，不可绑定的列出**：跨不了 ABI 的成员（BuildContext、
  枚举、Uint8List、函数体复杂签名……）跳过并在构建输出里逐条列原因——
  对第三方包这是常态，看到清单即知哪些能力要手写模块补充（specs/159 的
  `FjsObjectModule` 与本机制可自由混用，同名模块手写注册优先）。
- **类型映射**：见 specs/160-object-codegen §4（int→number 带 float64 安全
  转换、`T?`→`| null`、Future→Promise、命名参数→可选参数、函数参数→回调）。
- **web 端**：autoimport 的包是 Flutter 插件，web 无宿主也**不生成替身**
  ——浏览器里本就没有这个包的实现，`dartModule('mmkv')` 会 warnOnce 后
  throw（宪法 V）。要两端同源的能力请按上文手写 `FjsObjectModule` +
  `registerDartModuleStub`（同名注册优先于 autoimport 的生成物）。
- **troubleshooting**：工具包的 analyzer 对 Dart SDK 有下限（当前
  ^3.11），SDK 太旧时工具 `dart pub get` 会响亮失败；`fjs autoimport
  --force` 重算缓存；dump 与真实包内容漂移（改包不换版本）也用它兜底。
