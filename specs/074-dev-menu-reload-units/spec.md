# Spec: dev menu 手动刷新在 units 模式下报 "dev unit not loaded"

- **ID**: 074-dev-menu-reload-units
- **状态**: done
- **日期**: 2026-09-19

> 落地记录：`reloadDev()` 改为与 WS 全量 reload 共用 `_renegotiateUnits()`；
> 回归测试 `test/dev_reload_units_test.dart`（红绿验证过：无修复时重现
> `dev unit "src/Shell.vue" is not loaded`）。flutter test 435 过，JS 侧
> test/typecheck 绿，真机 fjs-go 实测刷新正常。

## 1. 要解决什么

fjs-go 扫码连上 `fjs dev`（split + units 构建，spec 037），进入应用后从
dev menu 点刷新，报错并白屏：

```
reload failed: FjsException: [fjs/eval] Error: [fjs] dev unit "src/Shell.vue" is not loaded
    at requireUnit (prelude.js:16650:17)
    at fjs-shared-stub:./src/Shell.vue (dev-bundle.js:45:35)
```

根因在 `packages/flutter_fjs/lib/src/engine.dart`：三条全量加载路径里，
只有手动 `reloadDev()` 漏了 units 标志——

| 路径 | units 标志来源 |
|---|---|
| `connectDev`（首连） | manifest 协商 ✅ |
| WebSocket 推送的全量 reload | 重新 fetchManifest 协商 ✅ |
| dev menu 手动 `reloadDev()` | 用了默认值 `false` ❌ |

units 模式下 entry bundle 不内联共享模块，靠 `/units.js` 往
`globalThis.__FJS_MODULES` 注册工厂后再 require。`_loadFromDev(dev, split)`
第三个参数取默认 `false`，跳过了 `/units.js`；`reset()` 已换新 VM，
注册表为空，entry 一 require `./src/Shell.vue` 就抛。WebSocket 全量
reload 那条路径专门为此写了再协商（"the dev server itself may have
restarted in classic mode"），手动路径漏掉了同一件事。

## 2. 不做什么（Non-goals）

- 不动 hot-swap 两条路径（`_hotSwapUnits` / `_hotSwapPages`），它们的
  回落分支已正确走再协商。
- 不动 prelude / dev-units.ts / CLI 的 units 构建产物——JS 侧注册表
  行为正常，问题纯在 Dart 侧的加载编排。
- 不改 hosted 模式（`fjs-go` 的 `HostedBuild`，release 形态没有 units）。
- 不为 reloadDev 增加 VM 之外的缓存或增量逻辑——它就是"手动触发的
  全量 reload"，语义与 WS 推送的全量 reload 对齐即可。

## 3. 用户可见的行为

修完后：扫码连上任意 units 模式的 `fjs dev`，进 app、开 dev menu、点
刷新 → 回到首页重新加载，日志出现 `bundle loaded (… bytes)`，
不再出现 `dev unit … is not loaded`。经典（非 split）构建行为不变。

## 4. 两端约定（宪法 I）

纯 Dart 宿主侧加载编排，不触及任何用户可见能力（标签/样式/事件），
无两端约定。WS 全量 reload 与手动 reload 从此共用同一段协商代码。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `cd packages/flutter_fjs && flutter test` 通过（native 已编）。
2. `pnpm test`、`pnpm run typecheck` 通过（未触 JS 侧，回归确认）。
3. 实测：`fjs dev` 起 demo（split+units），iOS 模拟器 fjs-go 扫码进入，
   dev menu 刷新 → 正常回到应用首页，dev 日志无 `dev unit … is not loaded`。
4. 实测：经典模式（无 `--pages`）dev menu 刷新仍正常。

## 7. 待澄清

- 无。
