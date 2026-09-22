# 构建与发布

## 三类产物，三条命令

App 产物一份覆盖 Android、iOS、鸿蒙和桌面，另外是 Web 和微信小程序。

| 目标 | 命令 | 产物 |
|---|---|---|
| App | `fjs build --pages --release` | 字节码，复制进 `.fjs/flutter/assets/fjs/` |
| Web | `vite build`（或 `fjs build --web`） | `dist/web/` 静态站点 |
| 微信小程序 | `fjs build --mp` | `dist/mp/`，用微信开发者工具上传 |

## App

### 发布构建

```bash
npm run build:release        # = fjs build --pages --release
```

它会：

1. 按页面分包打包：共享运行时一个 chunk、入口一个、每个页面一个
2. 压缩 JS（`--no-minify` 可关闭）
3. 用 `fjsc` 编译成**引擎字节码**（`.fjsbundle`，头部锁 engine id），App 启动时跳过解析
4. 创建或更新 Flutter 宿主，把字节码和静态资源复制进 `assets/fjs/`

```text
.fjs/flutter/assets/fjs/
  manifest.json
  shared.fjsbundle         Vue + fjs 运行时 + 公共模块
  bundle.fjsbundle         入口
  pages/
    index.fjsbundle        每页一个，进入时才加载
  public/                  public/、html/ 和 import 的资源
```

加 `--gz` 会把复制进宿主的 `.fjsbundle` 再 gzip 一次（启动时自动解压），进一步减小包体。

### 打 APK / 其它平台

```bash
npm run build:apk                                              # = fjs build --pages --release --apk
npx fjs build --pages --release --apk -- --target-platform android-arm64
npx fjs build --pages --release --hap                          # 鸿蒙
npx fjs build --pages --release --ipa                          # iOS（仅 macOS，需 Xcode）
npx fjs build --pages --release --aab                          # Play 上架的 appbundle
```

`--` 后面的参数原样传给 `flutter build`。`--apk` / `--hap` / `--ipa` / `--aab` 一次只用一种；`--ipa` 签名导出失败会留下 `.xcarchive`，签名配置可用 `-- --export-options-plist <file>` 透传。APK 在 `.fjs/flutter/build/app/outputs/flutter-apk/`。

不传这些参数时，`fjs build --pages --release` 只把 assets 同步进宿主，随后可以在宿主目录里手动 `flutter build ipa` —— 签名、证书这类配置需要长期保存在宿主里，建议先 [eject 宿主](./flutter-host#eject-把宿主变成你自己的)。

### 在设备上跑 release

```bash
npx fjs run android --release    # 字节码 + Flutter release 模式
npx fjs run android --profile    # 同样的字节码 + profile 模式，用来量性能
```

`--release` / `--profile` 都不连 dev server，跑的就是发布包里的东西。

### 版本号

写在 `app.config.ts`：

```ts
export default defineConfig({ version: '1.2.0+3' });   // versionName 1.2.0，versionCode 3
```

### 注意

- 升级了 `@ufjs/runtime` 或 `vue` 之后，**所有** `.fjsbundle` 要一起重新构建（shared、bundle、pages 之间是 API 级耦合）
- 升级三件套（`@ufjs/cli` / `@ufjs/runtime` / `flutter_fjs`）用 `fjs upgrade`，三者必须同一 minor，别手动各升各的
- 字节码带 engine id 校验（`primjs-4.1.1` / `quickjs-ng-0.9.0`）：与 App 内引擎不一致时会直接报错拒绝加载，不会运行到一半崩溃

## Web

```bash
npm run build:web      # = vite build，产物 dist/web
```

普通静态站点，每个页面一个 chunk，部署到任何静态托管即可。路由默认是 **hash 模式**（`/#/about`），服务器不需要任何配置。想要干净的 URL，在 `createFjsApp` 里传 `history: 'history'`，这时服务器要把未知路径回退到 `index.html`。

`fjs build --web` 是 CLI 内置的 esbuild 版 Web 构建，产物目录相同，不依赖 Vite 配置。

App 专属页面（`platforms: ["app"]`）不会出现在 Web 产物里。

## 微信小程序

```bash
npx fjs build --mp
```

用微信开发者工具打开 `dist/mp/`，预览、真机调试、上传都在开发者工具里完成。

发布前检查：

1. `app.config.ts` 里配好正式 appid：`wxmp: { appid: 'wx...' }`
2. 主包不超过 **2MB**。超了就配分包，把大库所在的页面挪出去：

```json
{
  "fjs": {
    "mp": {
      "subpackages": [
        { "root": "charts", "pages": ["example/chart/"] }
      ]
    }
  }
}
```

3. 小程序跑不了的页面（WebGL 等）用 `fjs.mp.exclude` 排除
4. 需要压缩就配 `wxmp.setting: { minified: true, minifyWXSS: true, minifyWXML: true }`

产物是 TypeScript 源码，编译交给开发者工具；不要关掉 project.config.json 里的 `useCompilerPlugins: ["typescript"]`。

## 清理

```bash
npx fjs clean          # 删 dist/、宿主里的 release 产物、生成的类型文件
npx fjs clean --all    # 连 .fjs/flutter 一起删（eject 过的宿主不会被删）
```

## 命令速查

| 命令 | 产物 |
|------|------|
| `fjs build` | `dist/app/bundle.js`，单包源码 |
| `fjs build --bytecode` | 单包 + `.fjsbundle` |
| `fjs build --pages` | 分包源码 |
| `fjs build --pages --release` | 分包字节码 + 同步到宿主 |
| `fjs build --pages --release --apk` | 再打 APK |
| `fjs build --profile --apk` | 量性能用的 profile APK |
| `fjs build --pages --release --hap` | 鸿蒙 HAP |
| `fjs build --web` | `dist/web` |
| `fjs build --mp` | `dist/mp` |
| `fjs build ... --analyze` | 附带体积报告 |
