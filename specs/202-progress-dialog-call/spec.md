# Spec: 用 autoimport 调用 sn_progress_dialog（Widget 弹窗包的调用测试）

- **ID**: 202-progress-dialog-call
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

要验证对象 ABI + autoimport 能不能驱动一个**真实的、带 UI 的 pub 包**：
[sn_progress_dialog](https://pub.dev/packages/sn_progress_dialog) 2.0.0
（Flutter 进度弹窗，SDK `>=3.5`，仅依赖 flutter）。

但它的入口是 `ProgressDialog({required BuildContext context})`——autoimport
绑不了 `BuildContext`，原样配进 `fjs.autoimport` 只会得到「构造器被整个跳过」。
`show()` 也带一堆 Widget 类型参数（`Color`、`TextStyle`、`Cancel`/`Completed`
选项类……）。同时宿主侧没有公开的拿 context 的办法：`FjsApp` 内部的
`GlobalKey<NavigatorState>` 是私有的（`fjs_app.dart:51`）。

## 2. 不做什么（Non-goals）

- **不给 autoimport 加 BuildContext 注入**：那是通用特性，成本大，另开 spec
  （用户已选「本地 facade 包」而不是它）。
- **不做 web 实现**：Widget 弹窗在浏览器里没有对应物。页面在 web 上用
  `hasDartObjectSupport()` 守卫显示说明（与 mmkv 页同一差异口径，宪法 I 登记）。
- **不覆盖 sn_progress_dialog 全部选项**：facade 只暴露 show / update /
  close / isOpen / 状态回调，颜色、样式、cancel 按钮等不透传。
- **不做 Widget 直调**：UI 仍走 element API + 镜像树；这里只是 Flutter 原生
  弹窗（`showDialog`）被 JS 触发，和 159 的非目标一致（不直调 Widget 树）。

## 3. 用户可见的行为

宿主 `package.json`：

```json
{ "fjs": { "autoimport": [
  "mmkv@^2.4.2",
  { "name": "playground", "path": "dart/playground" },
  { "name": "progress", "path": "dart/progress" }
] } }
```

`demo/dart/progress`（本地包）依赖 `sn_progress_dialog`，写一个**无 context 的
门面**（普通 Dart 类，autoimport 生成适配器与类型）：

```dart
class Progress {
  Progress([String msg = 'Loading', int max = 100]);
  Future<void> show([bool determinate = false]); // 弹窗关闭时 resolve
  void update(int value, [String? msg]);
  void close();
  bool get isOpen;
  void onStatus(void Function(String) fn);       // 'opened' | 'closed' | 'completed'
}
```

context 由宿主在 `fjsAttachHost` 里接线（facade 自己不依赖 flutter_fjs）：
`progressContext = () => FjsApp.currentContext;`，其中 `FjsApp.currentContext`
是本 spec 给 `flutter_fjs` 新增的最小公开入口（当前挂载的 `FjsApp` 内部
Navigator 的 context，没有则 null）。

页面（`demo/src/pages/basic/dart-progress.vue`）：

```ts
const progress = dartModule('progress').Progress('下载中…', 100);
progress.onStatus((s) => note(`status ${s}`));
const done = progress.show(true);          // Promise：弹窗关闭时 resolve
progress.update(40, '40%');                // 同步更新
await done;                                // 到 max 自动关闭（或手动 close）
```

按钮：不定进度（JS 2 秒后 `close()`）/ 确定进度自动推进（JS 定时器每 300ms
`update(+20)`，满 100 自动关闭）/ 提前关闭（推进到 40 后 `close()`，再对已关
闭的弹窗 `update` 不抛）/ 一键脚本（show→update 30→60→100→等关闭，日志按序
输出）。弹窗是模态的（遮罩挡住页面），所以没有「弹窗打开时点页面按钮」的场景，
每个场景都自己收尾。日志行为 `status opened`、`update 30`、`status completed`、
`status closed`、`show resolved`。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 真实的 Material 进度弹窗，JS 经生成的适配器驱动 | 页面显示「仅 Flutter：进度弹窗是原生 Widget，浏览器无对应实现」，不调用 `dartModule` |
| 事件载荷 | 无新事件号 | 同 |
| 已知差异 | — | autoimport 只服务 Flutter（160 已登记），本页是该差异的又一个实例；登记进 `docs/web.md` |

## 5. 契约变更（宪法 II）

- [x] 都不涉及三张运行时契约表
- Dart 公开 API：`FjsApp.currentContext`（`flutter_fjs`，只增不改）
- 工具链契约：无变化（沿用 specs/201 的本地包条目与 cb 签名）

## 6. 验收标准

1. `cd demo && pnpm exec fjs autoimport --force`：dump 出
   `.fjs/autoimport/progress.api.json`，`demo/src/fjs-objects.d.ts` 含
   `ProgressModule` / `Progress`（`show(determinate?: boolean): Promise<void>`、
   `onStatus(fn: (a0: string) => void)`、`readonly isOpen: boolean`）；生成的
   `lib/fjs_objects.dart` 对宿主 `dart analyze` 无 error/warning。
2. `pnpm --filter demo run typecheck` 通过；web 上打开 dart-progress 页只显示
   说明、控制台无未捕获异常。
3. iOS 模拟器 `fjs run ios`：点「一键脚本」，屏幕上**真的弹出**进度框，日志依序
   为 `status opened → update 30 → update 60 → update 100 → status completed →
   status closed → status closed → show resolved`（`closed` 出现两次是
   sn_progress_dialog 自己的行为：`close()` 路径与 `showDialog` 完成回调各报一次）。
4. 点「不定进度」「确定进度（自动）」「提前关闭」各一次，弹窗按预期出现/消失，
   `isOpen` 随之变化；关闭后再 `update` 不抛未处理异常。
5. `cd packages/flutter_fjs && flutter test` 全绿，新增用例覆盖
   `FjsApp.currentContext`（挂载后非 null、卸载后 null）。
6. `pnpm run typecheck`、`pnpm test` 全绿；`docs/modules.md`、`docs/web.md` 更新。

## 7. 待澄清

- [x] 测试形态：本地 facade 包（用户 2026-10-03 选定）


## 8. 结果（2026-10-03）

- **全链路真跑**：iOS 模拟器上真实弹出 sn_progress_dialog——不定进度转圈，确定进度
  显示 `60% · 60/100` 随 JS 的 `update` 推进；一键脚本日志序列
  `status opened → update 30/60/100 → status completed → status closed ×2 → show resolved`；
  提前关闭与「关闭后再 update 不抛」均验证。web 上只显示说明、控制台无异常。
- **生成**：`Progress` 门面经 autoimport 得到 `ProgressModule`（`show(determinate?):
  Promise<void>`、`onStatus(fn: (a0: string) => void)`、`readonly isOpen`），生成的
  Dart 无 error/warning；`progressContext` 顶层变量按设计不被绑定（构建输出里会
  列两行「skipped progressContext」，是宿主接线点，不是缺口）。
- **新公开入口**：`FjsApp.currentContext`（含 widget 测试：挂载非 null、能 `showDialog`、
  卸载后 null）。
- **页面修正**：弹窗模态，遮罩挡住页面按钮，最初的「手动 +20 / 关闭」按钮在弹窗
  打开时点不到，改成每个场景自己收尾（JS 定时 `close()` / 提前关闭脚本）。
