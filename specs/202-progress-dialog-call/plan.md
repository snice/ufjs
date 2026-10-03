# Plan: 用 autoimport 调用 sn_progress_dialog

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（差异登记） | Flutter：`demo/dart/progress` 门面 + 生成适配器；Web：`demo/src/pages/basic/dart-progress.vue` 用 `hasDartObjectSupport()` 守卫显示说明。Widget 弹窗无浏览器对应物，登记进 `docs/web.md` 已知差异。 |
| II 边界即契约 | 否 | 三张运行时表不动；只给 `flutter_fjs` 增加一个公开 Dart 静态入口 `FjsApp.currentContext`（只增不改）。 |
| III 同步单线程零序列化 | 是（沿用） | 全走 159 通道；`show()` 的 Future 经 PENDING 结算，`onStatus` 回调同线程回 JS。 |
| IV 外观照 WeUI | 否 | 弹窗是 sn_progress_dialog 的 Material 外观，属第三方包，不是内置组件。 |
| V 静默失效是 bug | 是 | 没接线 context 时 `Progress()` 抛带说明的 `StateError`（而不是悄悄不弹）；web 分支是可见说明。 |
| VI 注释记录权衡 | 是 | facade 头注释写明：为何不透传 Widget 选项、为何 context 由宿主接线而不让 facade 依赖 flutter_fjs。 |
| VII JS 能包就不要下 Dart | 是（反向合规） | 能力本体是 Flutter 的 `showDialog`/Material 弹窗，JS 侧无法伪造，必须在 Dart。 |
| VIII 变更落到文档 | 是 | `docs/modules.md`（autoimport 章补「Widget 包用 facade 包一层」+ context 接线）、`docs/web.md` 差异表。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_app.dart` | `_FjsAppState` 记录当前实例（initState/dispose），`FjsApp.currentContext` 静态 getter 返回其 `_navigator.currentContext` |
| Dart 宿主 | `packages/flutter_fjs/test/fjs_app_context_test.dart`（新） | widget 测试：挂载后 `currentContext` 非 null，卸载后 null |
| demo（本地包） | `demo/dart/progress/pubspec.yaml`、`lib/progress.dart`（新） | 依赖 flutter + sn_progress_dialog；`Progress` 门面类 + 顶层可写 `progressContext` provider |
| demo | `demo/package.json` | `fjs.autoimport` 加 `{name:'progress',path:'dart/progress'}` |
| demo | `demo/src/main.dart` | `fjsAttachHost` 里 `progressContext = () => FjsApp.currentContext;` |
| demo | `demo/src/pages/basic/dart-progress.vue`（新） | 按钮 + 一键脚本 + web 守卫 |
| demo | `demo/src/fjs-objects.d.ts` | 生成物，提交 |
| 文档 | `docs/modules.md`、`docs/web.md` | 见宪法 VIII |

## 3. 方案

- **facade**：`Progress` 持有一个 `ProgressDialog`（构造时用 `progressContext()`
  取 context，取不到抛错）。`show([bool determinate=false])` 转 `pd.show(max:,
  msg:, progressType:, onStatusChanged: …)`；`ProgressDialog.show` 返回
  `Future<void>`（showDialog 的 future，弹窗关闭时完成），原样返回给 JS 成
  Promise。`onStatus` 保存 `void Function(String)`，状态枚举转成字符串
  `opened|closed|completed`。`update`/`close`/`isOpen` 直通。
- **context 接线**：facade 顶层放 `BuildContext? Function()? progressContext`
  （顶层变量不被 autoimport 绑定，只是宿主接线点）；宿主在 `fjsAttachHost` 里赋
  值。`FjsApp.currentContext` 返回内部 Navigator 的 context——其祖先含
  `MaterialApp`，`showDialog`（`useRootNavigator` 默认 true）与 Material 本地化
  都可用。
- **页面**：determinate 的「自动推进」由 JS `setInterval` 每 300ms `update`，
  到 max 时 sn_progress_dialog 自己关闭；一键脚本用 `await` 串起来并把每步写日志。

**被否掉的备选**
1. *BuildContext 注入进 autoimport*：通用但要改 dump 语法/适配器/flutter_fjs，
   用户已选 facade，另开 spec。
2. *facade 依赖 flutter_fjs 直接取 context*：本地包要写指向仓库的 path 依赖，
   发布场景脆弱；顶层 provider 让 facade 保持纯 Flutter 包。
3. *只验证「被跳过」*：不是调用测试，价值太低。
4. *`FjsApp` 暴露公开 `GlobalKey`*：多个 `FjsApp` 实例会冲突；静态 getter 指向
   当前挂载实例更稳，且只暴露 context 不暴露 State。

## 4. 风险

1. **sn_progress_dialog 的 Material 依赖**：需要 `MaterialLocalizations`/`Theme`
   祖先。demo 宿主是 `MaterialApp(home: FjsApp(...))`，应满足；非 Material 宿主
   会失败——facade 注释与 modules.md 写明。
2. **`dart analyze` 解析 `package:flutter`**：introspect 工具在隔离包里跑，
   靠 `--root` 指向宿主的 package_config 解析本地包的 flutter 依赖；若 analyzer
   解析不到 Flutter 类型，facade 的公开签名只用 `String/int/bool/Future/函数`，
   不暴露 Flutter 类型，把风险压到最小。
3. **onStatus 触发时机**：`opened` 在 `show` 同步路径里触发——此时 JS 的
   `onStatus` 必须已注册；页面先 `onStatus` 再 `show`。
4. **弹窗关闭后 update**：sn_progress_dialog 对 `ValueNotifier` 赋值无副作用，
   不抛；验收 4 实测。

## 5. 验证路径

```bash
cd demo && pnpm exec fjs autoimport --force
cd demo/.fjs/flutter && dart analyze lib/fjs_objects.dart
pnpm --filter demo run typecheck
cd packages/flutter_fjs && flutter test
pnpm run typecheck && pnpm test
cd demo && pnpm exec fjs run ios --device <sim> --port 38911   # 点一键脚本，看弹窗与日志
```
