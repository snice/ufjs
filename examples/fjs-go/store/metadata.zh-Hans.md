# App Store 元数据 · 简体中文（主语言）

填到 App Store Connect →「App 信息」与版本页。括号里是字数上限。

## App 名称（30）

```
fjs go
```

名称全局唯一；若被占用，备选：`fjs go - Vue 原生调试`、`fjs go 开发客户端`。
设备上显示的名字来自 Info.plist 的 `CFBundleDisplayName`（当前是 `Fjs Go`），
建议改成和商店一致的 `fjs go`。

## 副标题（30）

```
Vue 写页面，Flutter 原生渲染
```

## 类别

- 主要类别：开发者工具（Developer Tools）
- 次要类别：工具（Utilities）

## 推广文本（170，可随时改，不需要审核）

```
没有电脑也能先看看：点「在线演示」，直接体验 Vue 3 组件、ECharts 图表、WebGL 和 3D 小游戏在原生 App 里的效果。
```

## 描述（4000）

```
fjs go 是 ufjs 框架的开发调试客户端，面向使用 Vue 3 / TypeScript 开发移动应用的开发者。

在电脑上的 ufjs 工程里运行 fjs dev，用 fjs go 扫一扫终端里的二维码，你的工程就会在手机上以原生界面运行。保存代码后页面自动刷新，无需重新编译、无需重新安装。

【三种连接方式】
• 扫一扫：对准 fjs dev 终端里的二维码，最快
• 附近的服务器：同一 Wi-Fi 下自动发现，点一下即连
• 手动输入：填写地址，也支持直接粘贴 URL

【在线演示】
还没有搭好开发环境？点首页的「在线演示」，就能体验官方示例工程：
• 60 多个内置组件与接口示例
• ECharts、F2 图表，Canvas 2D 绘制
• WebGL、three.js、PixiJS 场景与小游戏

【为开发调试而设计】
• 工程全屏显示，和最终 App 一致；开发菜单收在可拖动的悬浮按钮里
• 重新加载、查看 console 日志、断开连接，一步到位
• JS 报错时悬浮按钮会亮起红点，第一时间发现问题
• 最近连接自动记住，下次一点即连
• 支持浅色 / 深色模式、iPhone 与 iPad

【说明】
fjs go 只是开发调试工具：它运行的是你自己电脑上 fjs dev 提供的工程，或官方的示例工程。正式发布的 App 会把代码打包进安装包，不依赖 fjs go。

fjs go 不需要注册登录，不收集任何个人数据。
```

## 关键词（100，英文逗号分隔，不要和名称重复）

```
Vue,Flutter,JavaScript,TypeScript,开发者,调试,热重载,跨端,前端,小程序,原生,组件,ECharts,WebGL
```

## 网址

| 字段 | 填写 |
|------|------|
| 技术支持网址（必填） | https://github.com/snice/ufjs/issues |
| 营销网址（选填） | https://github.com/snice/ufjs |
| 隐私政策网址（必填） | 部署 `store/privacy/index.html` 后的地址，建议 https://fjs-showcase.zhuzhe.dev/privacy.html |

## 版本说明（首次提交可不填；之后每版必填）

```
• 全新界面：扫码主入口、附近服务器、最近连接一屏可见
• 新增「在线演示」，无需电脑即可体验示例工程
• 开发菜单改为悬浮按钮，工程全屏显示
• 扫码页新增取景框与手电筒
```

## 版权

```
2026 zhuzhe
```
