# 配置

ufjs 的配置分三处：

| 文件 | 管什么 |
|---|---|
| `app.config.ts` | 原生应用本身：版本、包名、权限、屏幕方向、小程序 appid |
| `package.json` 的 `fjs` 字段 | 构建行为：共享 chunk、宿主目录、性能预算、小程序页面与分包 |
| 页面的 `<route>` 块 | 单个页面：标题、平台、转场、自定义 meta |

## `app.config.ts`

```ts
import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
  version: '1.2.0+3',
  orientation: 'portrait',
  android: {
    applicationId: 'com.acme.demo',
    permissions: ['android.permission.INTERNET'],
  },
  ios: {
    bundleIdentifier: 'com.acme.demo',
    infoPlist: { NSCameraUsageDescription: '用于扫描二维码' },
  },
  wxmp: {
    appid: 'wx1234567890abcdef',
    renderer: 'skyline',
    setting: { minified: true },
  },
});
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | `string` | 写进宿主 pubspec，形如 `1.2.0+3`。决定 Android versionName / versionCode 和 iOS 版本号。默认 `1.0.0+1` |
| `orientation` | `'portrait' \| 'landscape'` | 锁定屏幕方向。不写则全方向 |
| `android.applicationId` | `string` | Android 包名 |
| `android.permissions` | `string[]` | 完整权限名，写入 AndroidManifest.xml |
| `ios.bundleIdentifier` | `string` | iOS bundle id |
| `ios.infoPlist` | `Record<string, string \| number \| boolean \| string[] \| number[]>` | 写入 Info.plist |
| `wxmp.appid` | `string` | 小程序 appid（`wx` + 16 位十六进制）。默认 `touristappid` |
| `wxmp.renderer` | `'webview' \| 'skyline'` | 小程序渲染器，默认 `webview` |
| `wxmp.setting` | `object` | 按键合并进 project.config.json 的 `setting`，你的值优先 |

`fjs run` / `fjs host create` 会同步这些配置到**受管**宿主；eject 之后宿主归你维护。

## `package.json` 的 `fjs` 字段

```json
{
  "fjs": {
    "shared": ["pinia"],
    "flutterDir": "flutter",
    "performance": { "nodeBudget": 800 },
    "mp": {
      "appid": "wx1234567890abcdef",
      "shell": "@/Shell.vue",
      "exclude": ["example/webgl"],
      "excludeComponents": ["TabBar"],
      "subpackages": [
        { "root": "game", "pages": ["example/game/"], "public": ["sprites"] }
      ],
      "preloadRule": {
        "/example": { "network": "all", "packages": ["game"] }
      }
    }
  }
}
```

| 字段 | 说明 |
|---|---|
| `shared` | 分包构建时额外放进共享 chunk 的裸导入名。带模块级状态的库（pinia、vue-i18n）需要 |
| `flutterDir` | 宿主目录。`fjs host eject` 会自动写入 |
| `performance.nodeBudget` | 首帧节点数告警阈值，默认 500 |
| `packages` | `fjs add` 装过的库（信息性，`fjs doctor` 读取） |
| `mp.appid` | 小程序 appid 兜底（优先级低于 `app.config.ts` 的 `wxmp.appid`） |
| `mp.shell` | 小程序端的外壳组件，默认 `src/Shell.vue` |
| `mp.exclude` | 不进小程序的页面（路由路径或路径片段） |
| `mp.excludeComponents` | 小程序端不发射的本地组件（比如由原生 tabBar 接管时的自定义 TabBar） |
| `mp.subpackages` | 小程序分包：`root` 目录、`pages` 匹配片段、`public` 随包搬迁的 public 子目录 |
| `mp.preloadRule` | 分包预下载，键是 fjs 路由路径 |

## `<route>` 块

```vue
<route>
{
  "title": "详情",
  "name": "detail",
  "path": "/detail/:id",
  "platforms": ["app", "web"],
  "tab": 0,
  "transition": "fjs-slide-up",
  "scroll": false,
  "group": "自定义字段"
}
</route>
```

| 字段 | 说明 |
|---|---|
| `path` | 覆盖由文件路径推导的路由 |
| `name` | 覆盖路由名（默认由路径推导，如 `user/[id].vue` → `user-id`） |
| `platforms` | `["app"]` / `["web"]` 限定平台，默认两端 |
| `tab` | 数字：这是一个 tab 页，tab 间切换保活 |
| `transition` | 这个页面的转场：`fjs-page` / `fjs-slide` / `fjs-fade` / `fjs-slide-up` / `fjs-zoom` / `false` |
| 其它任意字段 | 进 `route.meta`，比如 `title`、自定义的 `scroll`、`group` |

## 模块清单

模块自己的 `package.json` 里的 `fjs` 字段，见[创建模块](/guide/modules#清单-package-json-的-fjs-字段)。

## `createFjsApp` 选项

```ts
createFjsApp({
  routes,                  // 来自 'fjs/pages'
  plugins,                 // 来自 'fjs/plugins'
  shell: Shell,            // 每个页面的外壳组件
  transition: 'fjs-slide', // 或 false，或 (nav) => 名字 | false
  setup(app) {},           // 挂载前调用：Flutter 上每个页面一次，Web 上整个应用一次
  // 以下只在 Web 生效
  el: '#app',              // 挂载点
  history: 'hash',         // 'hash'（默认）| 'history'
  keepAlive: true,         // 缓存历史栈上的页面；数字 = 最多缓存几页；false = 总是重挂
}).mount();
```

`plugins` 在 `setup` 之前按顺序应用。
