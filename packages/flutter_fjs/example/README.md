# flutter_fjs example

最小的 Flutter 宿主：加载一份由 `@ufjs/cli` 产出的 JS bundle，
用原生 Widget 渲染出 UI。端到端的完整样例见
[examples/hello-fjs](../../../examples/hello-fjs)。

```bash
# 在一个 fjs 项目里产出 bundle
pnpm dlx @ufjs/cli build

# 本 example（example/ 自身不是完整 app，需要包一层 flutter 壳）
flutter create . --platforms=ios,android
flutter pub get
flutter run --dart-define=FJS_DEV=<dev-server>:38900   # 连 fjs dev，热更新
flutter run                                            # 从 assets 读 bundle
```

release 路径读 `assets/fjs/bundle.fjsbundle`（可选
`assets/fjs/manifest.json` + `assets/fjs/pages/`，即 `fjs build`
分包输出的同款布局）。

这个 example 的 main.dart 就是接入本包所需的全部 Dart 代码：

1. `FjsEngine()` — 起引擎（需要包内预编译的 native 库，pub 解析依赖时自动带上）
2. `engine.host.register(...)` — 注册 JS 可同步调用的宿主模块
3. dev：`runApp` 先画、`connectDev` 后连；release：`rootBundle` 读 bundle →
   `runBundle` + `startEventLoop`
4. `MaterialApp(home: Scaffold(body: FjsApp(engine: engine)))` — JS 路由
   驱动原生页面栈
