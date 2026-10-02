# Tasks: 191-box-fusion

- [x] 1. render/box.dart：FjsBox / RenderFjsBox（继承 DecoratedBox / RenderDecoratedBox，
  margin 按 RenderPadding 布局；装饰无图片时 ImageConfiguration 只带文字方向、零依赖）
- [x] 2. decoration.dart：背景 DecoratedBox → FjsBox；margin 无过渡且紧贴背景盒时合并
- [x] 3. node_widget_count 9/6 → 8/5；flutter test 562 通过；本地基准
- [x] 4. 真机复测，记录结果

# 结果

本地基准（JIT）：mount 76 → 68 ms，unmount 8.2 → 6.8 ms；全网格 RenderObject 12053 → 10053。

iPhone，profile，克隆模式，show / 改 1 格 / hide × 4：

| | specs/190 | specs/191 |
|---|---:|---:|
| 挂载帧（最长 UI 帧） | 68–77 ms | 68–72 ms |
| show 上屏 | 121–131 ms | 110–124 ms |
| hide 上屏 | 49–80 ms | 50–62 ms |
| 改 1 格上屏 | 21–34 ms | 21–31 ms（持平） |

收益比 specs/190 的段落共享小：每格少 1 个 Element + 1 个 RenderObject + 4 个依赖，
真机上几 ms 量级，主要体现在 show 上屏与 hide 的波动收窄。

# 兼容

FjsBox 仍是 DecoratedBox、渲染对象仍是 RenderDecoratedBox——按 DecoratedBox 找装饰的
测试与代码不受影响。带 margin 过渡（transition: margin）、margin 与背景之间有约束 /
裁剪 / 偏移层时保持原来的 Padding 包装。

# Vue 侧验证（hello-fjs `example/interaction/flat-4050`，iPhone profile，JS 为 dev 源码）

同一台设备、同一份 JS，只换 `flutter_fjs/lib`：旧 = `2090dd2`（specs/189），新 = specs/190 + 191。
页面加了 `__flat4050vue` 脚本手柄，`fjs eval` 驱动 show / 改 1 格 / hide × 4。

| | VDOM 旧 | VDOM 新 | Vapor 旧 | Vapor 新 |
|---|---:|---:|---:|---:|
| 挂载帧（最长 UI 帧） | 70.6–76.9 ms | **44.9–48.7 ms** | 73.1–74.0 ms | **40.3–45.7 ms** |
| show 上屏 | 186–199 ms | **126–170 ms** | 180–214 ms | **145–178 ms** |
| hide 上屏 | 76–91 ms | **65–77 ms** | 81–89 ms | **64–78 ms** |
| 改 1 格上屏 | 76–107 ms | 90–102 ms | 24–62 ms | 53–62 ms |
| show JS | 96–98 ms | 65–99 ms | 92–128 ms | 92–121 ms |

- 挂载帧两条路径都降了 ~30 ms（-38% / -42%），比 hello-js 的降幅更大：hello-fjs 的格子
  同样只有 40 种段落、同样是 margin + 背景盒，Vue 组件节点不在 Dart 侧多出 widget。
- 改 1 格、JS 段不受影响（Dart 渲染器只管挂载 / 卸载那一帧），读数在原有波动内。
