# 添加插件与三方库

「插件」在 ufjs 里有两层意思：

| | 是什么 | 例子 | 怎么加 |
|---|---|---|---|
| **JS 库 / Vue 插件** | npm 包，跑在 JS 引擎里 | dayjs、pinia、vue-i18n | `fjs add` 或 `npm i` |
| **Flutter 插件** | pub 包，跑在 Dart / 原生层 | shared_preferences、相机、推送 | 包进一个模块，或写进宿主 |

这一篇先讲 JS 侧，再讲怎么接 Flutter 插件。

## 用 `fjs add` 装 JS 库

```bash
npx fjs add dayjs mitt          # 普通依赖：只改 package.json
npx fjs add pinia               # Vue 插件：装包 + 生成插件文件 + 接进入口
npx fjs add --list              # 查看支持的库
npx fjs add pinia --dry-run     # 只打印会改什么
```

`fjs add` 知道每个库该怎么接，分两类：

| 类型 | 改动 | 例子 |
|---|---|---|
| `dep` | 只有 `package.json` | dayjs、mitt、valibot、immer、es-toolkit |
| `plugin` | `package.json` + `src/plugins/<name>.ts` + 必要时登记 `fjs.shared` | pinia、vue-i18n |

不在列表里的库直接 `npm i` 就行，ufjs 项目就是普通的 npm 项目。

::: warning Node 内置模块
App 端没有 Node 环境。依赖 `fs`、`util`、`url` 这类 Node 内置模块的库，只 import 不调用时能过，真正调用时会报错。需要时在 `src/adapters/` 里写平台垫片，参考 hello-fjs 的 `src/adapters/`。
:::

## `src/plugins/`：Vue 插件放这里

`fjs add pinia` 生成的文件长这样：

```ts
// src/plugins/pinia.ts
import { createPinia } from 'pinia';
import type { App } from 'vue';

const pinia = createPinia();   // 模块作用域：全 app 只有一个

export default (app: App) => {
  app.use(pinia);
};
```

`src/plugins/*.ts` 会被工具链自动收集成虚拟模块 `fjs/plugins`，入口里的 `createFjsApp({ plugins })` 把它们装到每个 Vue app 上。**新建插件文件不需要改入口。**

你也可以手写插件，比如一个全局错误上报：

```ts
// src/plugins/10-error.ts
import type { App } from 'vue';

export default (app: App) => {
  app.config.errorHandler = (err, _instance, info) => {
    console.error('[vue-error]', info, String(err));
  };
};
```

规则：

- 默认导出 `(app: App) => void`
- **按文件名字典序加载**，需要抢先的加数字前缀（`10-error.ts`）
- 文件名后缀限定平台：`xxx.app.ts` 只在 App 端，`xxx.web.ts` 只在 Web 端

### 一定要记住的坑：每个页面是一个 Vue app

App 端**每个页面是独立的 Vue app**（这样才能一页对应一个原生路由），所以插件函数**每页执行一次**。必须全局唯一的东西（Pinia 实例、i18n 实例）要创建在插件文件的**模块作用域**，不能写在导出的函数里：

```ts
// ❌ 每个页面各拿一套 store，页面之间状态不通
export default (app: App) => app.use(createPinia());

// ✅
const pinia = createPinia();
export default (app: App) => app.use(pinia);
```

### `fjs.shared`：带模块级状态的库

分包构建（`--pages`）时，Vue 和 fjs 运行时放在共享 chunk 里，页面 chunk 共用。但第三方库默认**不**在共享名单里 —— 页面里直接 `import { storeToRefs } from 'pinia'`，esbuild 会给这个页面 chunk 复制一份 pinia。

两份 pinia 就是两个 `activePinia` 变量，页面读到的是另一个 store。所以带模块级状态的库要登记：

```json
{
  "fjs": {
    "shared": ["pinia"]
  }
}
```

`fjs add` 会对需要的库自动写这一项。手动判断的标准：**页面会直接 import 它，而且它有模块级状态**。纯函数库（dayjs、es-toolkit）不需要。

## 接入 Flutter 插件

JS 引擎做不到的事（本地存储、相机、推送、蓝牙……）要靠 Flutter 插件。JS 侧通过**宿主函数**调用它们：

```ts
import { invokeHost, invokeHostAsync } from 'fjs';

invokeHost('name', ...args);              // 同步，Dart handler 当场返回
await invokeHostAsync('name', ...args);   // 异步，Dart handler 返回 Future
```

Dart 侧注册 handler 的地方有三个，按推荐程度排列。

### 方式一：包成一个本地模块（推荐）

下面用 `shared_preferences` 做一个跨 App / Web / 小程序的本地存储。

**1. 生成一个只有 Dart 侧、没有组件的模块**

```bash
npx fjs create module storage --flutter --no-widget --no-component
```

**2. 在模块的 Dart 包里加依赖**

```yaml
# src/modules/storage/flutter/pubspec.yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_fjs: ^0.1.4
  shared_preferences: ^2.3.0
```

**3. Dart 侧注册宿主函数**

```dart
// src/modules/storage/flutter/lib/fjs_storage.dart
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FjsStorage {
  static void register(FjsEngine engine) {
    engine.host.registerAsync('storage.get', (args) async {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(args[0] as String);
    });
    engine.host.registerAsync('storage.set', (args) async {
      final prefs = await SharedPreferences.getInstance();
      return prefs.setString(args[0] as String, args[1] as String);
    });
  }
}
```

**4. JS 侧 API，Web 和小程序各自兜底**

```ts
// src/modules/storage/index.ts
import { hasNativeHost, invokeHostAsync } from 'fjs';

declare const wx: { getStorageSync(k: string): string; setStorageSync(k: string, v: string): void } | undefined;

export async function getItem(key: string): Promise<string | null> {
  if (hasNativeHost) return invokeHostAsync<string | null>('storage.get', key);
  if (typeof wx !== 'undefined') return wx.getStorageSync(key) || null;
  return localStorage.getItem(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (hasNativeHost) { await invokeHostAsync('storage.set', key, value); return; }
  if (typeof wx !== 'undefined') { wx.setStorageSync(key, value); return; }
  localStorage.setItem(key, value);
}
```

**5. 页面里用**

```ts
import { getItem, setItem } from 'storage';

await setItem('token', 'abc');
```

下次 `fjs run` 时，工具链会自动把 `fjs_storage` 加进 Flutter 宿主的 `pubspec.yaml`，并在启动时调用 `FjsStorage.register(engine)` —— 这叫 **autolink**。`npx fjs modules` 可以查看当前链接了哪些模块。

这样做的好处：Flutter 依赖、Dart 代码、JS API、Web 兜底都在一个目录里，**以后可以原样 `npm publish` 给别的项目用**。模块的完整说明见[创建模块](./modules)。

::: warning 小程序端
小程序构建暂不支持按包名导入本地模块（见[创建模块](./modules#第一步-纯-api-模块)里的说明）。上面 `wx` 分支要等模块发布成 npm 依赖后才能在小程序端生效。
:::

### 方式二：`src/main.dart`

只需要注册几个宿主函数、不引入新的 pub 包时，最简单的是在 `src/main.ts` 旁边放一个 `main.dart`：

```dart
// src/main.dart
import 'package:flutter_fjs/flutter_fjs.dart';

Future<void> fjsAttachHost(FjsEngine engine) async {
  engine.host.register('app.buildMode', (args) =>
      const bool.fromEnvironment('dart.vm.product') ? 'release' : 'debug');
}
```

每次 `fjs run` 它会被复制成宿主的 `lib/fjs_attach.dart`，在 `runApp` 之前调用。

::: tip 为什么不能在这里加 pub 包
生成的宿主（`.fjs/flutter`）的 `pubspec.yaml` 每次 `fjs run` 都会重新生成，手加的依赖会被覆盖。新的 pub 依赖请用方式一（模块），或方式三（eject）。
:::

### 方式三：eject 宿主

需要改签名、加原生代码、改 Gradle / Xcode 配置时，把宿主移进仓库：

```bash
npx fjs host eject        # .fjs/flutter → flutter/
```

之后 `flutter/pubspec.yaml`、`lib/main.dart` 都归你管，可以像普通 Flutter 项目一样 `flutter pub add`。见 [Flutter 宿主](./flutter-host)。

### 同步还是异步

| | Dart 注册 | JS 调用 | 用于 |
|---|---|---|---|
| 同步 | `engine.host.register` | `invokeHost` | 能当场算出结果的：读配置、平台信息 |
| 异步 | `engine.host.registerAsync` | `await invokeHostAsync` | 返回 `Future` 的：插件读写、权限申请、三方 SDK |

参数和返回值规则：

- `invokeHost` 的参数只能是 `string | number | boolean | null`，要传对象自己 `JSON.stringify`
- `invokeHostAsync` 的参数整体 JSON 编码过界，Dart 收到解码后的 `List`；返回值必须能 JSON 编码
- 未注册的名字、handler 抛异常，Promise 都会 reject，不会挂住
- Web 端没有 Dart 宿主：`invokeHost` 抛错、`invokeHostAsync` reject，所以一定要有 `hasNativeHost` 分支

::: tip 用 fjs go 调试时
fjs go 是一个预编译好的 App，里面没有你的 Dart 代码。依赖自定义宿主函数的功能，要用 `fjs run` 装自己的 App 来调试。
:::
