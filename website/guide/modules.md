# 创建模块

页面和组件属于**这个项目**；**模块**是能拿走的那一份。一个模块就是一个 npm 包，可以同时包含：

- **JS API**：`import { scan } from 'qrcode'`
- **Vue 组件**：`<QrcodeView />`，全局注册，不用 import
- **Flutter Widget 标签**：`<qrcode-widget />`，背后是真正的 Flutter Widget
- **Dart 宿主函数**：JS 通过 `invokeHost` 调用
- **构建钩子**：按使用它的 App 生成数据

别人 `npm i` 之后**什么都不用配**：裸导入、全局组件、类型提示、Flutter 依赖全部自动生效。这就是 React Native 的 autolink，只不过开关是 `package.json` 里的一个字段。

这一篇从最简单的纯 JS 模块开始，一步步加上组件、Flutter Widget、异步能力，最后发布。

## 第一步：纯 API 模块

```bash
npx fjs create module qrcode --no-component
```

```text
src/modules/qrcode/
  package.json     清单，也是 npm publish 读的那份
  index.ts         API
  README.md
```

`index.ts` 里导出的就是模块 API：

```ts
// src/modules/qrcode/index.ts
export function isQrText(s: string) {
  return /^https?:\/\//.test(s);
}
```

项目里任何地方都能按**包名**导入它，就像它已经装在 `node_modules` 里：

```ts
import { isQrText } from 'qrcode';
```

::: tip 本地模块 = 已安装的包
`src/modules/qrcode` 和装好的 `node_modules/qrcode` 行为完全一样：同一个 `package.json`，同一个裸导入名。所以「先在本地写，写好了发出去」，调用方一行都不用改。
:::

::: warning 小程序端暂不支持本地模块
目前 `fjs build --mp` 只认 `package.json` 依赖里的裸导入，按包名导入 `src/modules/*` 会报 `"xxx" is not a dependency in package.json`。App 和 Web 不受影响。需要小程序端时，暂时把用到本地模块的页面放进 `fjs.mp.exclude`，或把模块发布后作为依赖安装。
:::

## 第二步：加一个 Vue 组件

```bash
npx fjs create module qrcode        # 默认就会生成组件 QrcodeView
```

```text
src/modules/qrcode/
  components/
    QrcodeView.vue
```

`components/` 下的组件会被**全局注册**，名字加上模块前缀（默认是包名的 PascalCase）：

```vue
<template>
  <QrcodeView label="扫一扫" />   <!-- 不用 import -->
</template>
```

工具链会生成 `src/fjs-components.d.ts`，所以模板里有补全，props 写错是编译错误。

## 第三步：加一个 Flutter Widget

当你需要的东西只有 Flutter 能做（相机预览、地图、原生图表、platform view），就用 Dart 写一个 Widget，注册成一个**标签**。

```bash
npx fjs create module qrcode --flutter
```

多出来的文件：

```text
src/modules/qrcode/
  components/
    QrcodeWidgetWeb.vue       浏览器里的替身
  flutter/
    pubspec.yaml              Dart 包 fjs_qrcode
    lib/fjs_qrcode.dart       宿主函数 + Widget
```

Dart 侧：

```dart
// src/modules/qrcode/flutter/lib/fjs_qrcode.dart
import 'package:flutter/material.dart';
import 'package:flutter_fjs/flutter_fjs.dart';

class FjsQrcode {
  static void register(FjsEngine engine) {
    // 宿主函数：JS 用 invokeHost('qrcode.ping', 'hi') 调用
    engine.host.register('qrcode.ping', (args) => '${args.first} from Dart');

    // <qrcode-widget /> 标签背后的 Widget
    engine.components.register('qrcode-widget', _build);
  }

  static final ComponentBuilder _build = (context, node, children, dispatch) {
    final label = node.props['label'] as String? ?? '';
    return GestureDetector(
      onTap: () => dispatch(node.id, FjsEvent.tap),   // 回到 JS 的 @tap
      child: Text(label),
    );
  };
}
```

- `node.props`：模板上写的属性（扁平 JSON：字符串、数字、布尔）
- `children`：已经构建好的子节点 Widget
- `dispatch(node.id, FjsEvent.tap)`：把事件送回 JS，对应模板里的 `@tap`

页面里直接写标签：

```vue
<template>
  <qrcode-widget label="扫一扫" @tap="onTap" />
</template>
```

**Web 上没有 Flutter**，所以清单里声明的 `web` 替身组件会以**同一个标签名**注册。页面只写一次，两端都能跑：

```json
"fjs": {
  "widgets": {
    "qrcode-widget": {
      "web": "./components/QrcodeWidgetWeb.vue",
      "props": { "label": "string" }
    }
  }
}
```

小程序端可以再提供一份原生组件四件套（`mp` 字段）；不提供的话，用到它的页面要在 `fjs.mp.exclude` 里排除。

## 第四步：调用 Dart / Flutter 插件

JS API 通过宿主函数调 Dart。生成的模板已经演示了「有宿主调原生、没宿主用 JS 兜底」的写法：

```ts
// src/modules/qrcode/index.ts
import { hasNativeHost, invokeHost, invokeHostAsync } from 'fjs';

export function ping(message = 'hello') {
  if (!hasNativeHost) return { from: 'js', value: message };      // Web
  return { from: 'native', value: String(invokeHost('qrcode.ping', message)) };
}

export async function scan(): Promise<string> {
  if (!hasNativeHost) throw new Error('scan is app-only');
  const { code } = await invokeHostAsync<{ code: string }>('qrcode.scan');
  return code;
}
```

异步能力在 Dart 侧用 `registerAsync`，返回 `Future`：

```dart
engine.host.registerAsync('qrcode.scan', (args) async {
  final code = await scanner.scan();   // 任何 Flutter 插件
  return {'code': code};               // 必须能 JSON 编码
});
```

需要的 Flutter 插件直接写进模块自己的 `flutter/pubspec.yaml`。完整的例子见[添加插件：接入 Flutter 插件](./plugins#接入-flutter-插件)。

## autolink 做了什么

`fjs run` / `fjs build --release` 生成 Flutter 宿主时，对每个声明了 `fjs.flutter` 的模块：

1. 把它的 pub 包加进宿主 `pubspec.yaml`
2. 在宿主生成的 `lib/fjs_autolink.dart` 里 import 它，并在 `runApp` 之前调用 `register` 那一行

```bash
npx fjs modules          # 查看当前解析到的模块、标签和 autolink
```

```text
qrcode  (local: src/modules/qrcode)
  import  import { … } from 'qrcode'
  tags    <QrcodeView />
  widgets <qrcode-widget />
  flutter fjs_qrcode  ./flutter
          FjsQrcode.register(engine);
```

## 清单：`package.json` 的 `fjs` 字段

```json
{
  "name": "qrcode",
  "version": "0.0.1",
  "type": "module",
  "types": "./index.ts",
  "exports": { ".": "./index.ts", "./components/*": "./components/*" },
  "files": ["index.ts", "components", "flutter/lib", "flutter/pubspec.yaml", "README.md"],
  "fjs": {
    "module": true,
    "components": "components",
    "componentPrefix": "Qrcode",
    "widgets": { "qrcode-widget": { "web": "./components/QrcodeWidgetWeb.vue" } },
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
| `module` | `true` 才会被识别为模块（`node_modules` 里的包必须写）。`src/modules/*` 默认就是 |
| `components` | 组件目录，默认 `components`；`false` 表示纯 API 模块 |
| `componentPrefix` | 全局组件名前缀，默认包名的 PascalCase |
| `widgets` | 由 Flutter Widget 渲染的标签，可带 `web` / `mp` 替身和 `props` 类型 |
| `prepare` | 构建期代码生成钩子（见下） |
| `flutter.package` | pub 包名 |
| `flutter.path` / `flutter.version` | Dart 包来源：模块内路径，或 pub.dev 上的版本 |
| `flutter.import` | 宿主要 import 的 Dart 库 |
| `flutter.register` | 在 `runApp` 之前执行的一行 Dart，作用域里有 `engine` |

::: warning files 要枚举到具体文件
`files` 写 `"flutter"` 整个目录的话，你在里面跑过一次 `flutter test`，`.dart_tool/`、`build/` 这些缓存就会被打进 npm 包（真实发生过：发出去 45 MB）。模板生成的是 `flutter/lib` + `flutter/pubspec.yaml`，照这个写。
:::

## 进阶：构建钩子 `prepare`

有些模块的数据取决于**用它的 App**：页面用了哪些图标、装了哪些语言包。与其让每个使用者手写脚本，模块可以自带一步构建：

```json
"fjs": { "module": true, "prepare": "./prepare.mjs" }
```

```js
// prepare.mjs —— fjs build / fjs dev / Vite 启动前调用
export default async function prepare(ctx) {
  const used = ctx.sources()                         // App 的源码文件
    .flatMap((f) => scan(fs.readFileSync(f, 'utf8')));
  ctx.write('icons.json', JSON.stringify(pick(used))); // 写进 .fjs/modules/<name>/
  ctx.write('types.d.ts', declare(used));              // 自动被类型引用
  ctx.log(`${used.length} icons`);
}
```

产物的去处：

- **JS**：模块代码里 `import('fjs/data/icons.json')`（动态导入会单独切成一个 chunk；这个路径只能读到本模块自己的产物）
- **Dart**：release 时拷进宿主 assets `assets/fjs/modules/<name>/`，dev 时由 dev server 提供（`engine.devUri` / `engine.fetchString`）
- **类型**：`types.d.ts` 会被生成的 `src/fjs-modules.d.ts` 引用

[`@ufjs/iconmind`](https://github.com/snice/ufjs/tree/main/packages/fjs-iconmind) 就是这样做的：它扫描 App 里写了哪些 `<icon-mind name="…" />`，只生成用到的图标数据和类型，于是 `name` 属性有补全，写错是编译错误。

## 发布与使用

模块**以源码发布**，fjs 会自己编译 TS 和 SFC，没有构建步骤：

```bash
cd src/modules/qrcode
npm publish
```

别的项目：

```bash
npm i qrcode
```

装完即用 —— 裸导入、全局组件、`<qrcode-widget />`、Flutter autolink 全部生效。

## 分包时的单实例

分包构建时，模块代码进共享 chunk，所有页面拿到的是**同一个实例**。模块里的缓存、单例在页面之间是共享的。

## 参考实现

| 模块 | 演示了什么 |
|---|---|
| [`@ufjs/iconmind`](https://github.com/snice/ufjs/tree/main/packages/fjs-iconmind) | API + Flutter Widget + Web 替身 + `prepare` 钩子 + 类型生成 |
| [`@ufjs/webview`](https://github.com/snice/ufjs/tree/main/packages/fjs-webview) | 包装一个 Flutter 插件（webview_flutter），Web 端用 iframe，双向消息 |
| [`@ufjs/webgl`](https://github.com/snice/ufjs/tree/main/packages/fjs-webgl) | 没有组件、没有 Widget，纯粹给 `canvas.getContext` 扩展一种上下文 |

## 命令速查

| 命令 | 用途 |
|------|------|
| `fjs create module <name>` | API + 组件 |
| `... --no-component` | 纯 API |
| `... --component <Name>` | 指定组件名 |
| `... --prefix <P>` | 全局组件前缀 |
| `... --flutter` | 加 Dart 侧（宿主函数 + Widget + Web 替身） |
| `... --widget <tag>` | 指定 Widget 标签名（隐含 `--flutter`） |
| `... --no-widget` | 只要宿主函数，不要 Widget |
| `... --dry-run` / `--force` | 只打印 / 覆盖 |
| `fjs modules [--json]` | 查看解析到的模块和 autolink |
