# Tasks: 190-mount-frame-element-diet

- [x] 1. `test/mount_bench_test.dart`：4050 网格 mount/unmount 基准 + 普查
- [x] 2. hello-js `__helloTab` 手柄；真机基线（timeline + cpu-profile）；
  修 `tool/cpu-profile.mjs` 的 self 列（栈是 leaf-first，原来取的是根帧）+ `FILTER=` / `TOP=`
- [x] 3. 文本：页面根 `FjsTextEnvScope` 解析一次文本环境，段落只对它注册 1 个依赖（原 7 个）；
  纯文本走 `FjsPlainText` / `RenderFjsParagraph`（render/paragraph.dart）——按（span、段落设置、
  min/max 宽）共享已排版的 TextPainter，引用计数 + 1024 条空闲 LRU
- [ ] 4. 简单盒子 margin/装饰合并——本轮不做，见下「下一步」
- [x] 5. flutter test 562 通过；真机复测；记录结果

# 结果（iPhone，`fjs run ios -- --profile`，克隆模式，show/改1格/hide × 4）

| | 基线 | 3a：Text 去依赖 | 3b：+ 共享段落 |
|---|---:|---:|---:|
| 挂载帧（最长 UI 帧） | 98.5–105 ms | 90–95 ms | **67–74 ms** |
| show 上屏 | 145–164 ms | 136–156 ms | **116–132 ms**（首次冷缓存 132） |
| hide 帧 FINALIZE TREE | ~16 ms | ~16 ms | 不再进前列（段落不逐个销毁） |
| 改 1 格上屏 | 24–28 ms | 19–32 ms | 22–33 ms（持平） |
| JS | 32–35 ms | 31–40 ms | 31–39 ms（未动） |

本地基准（JIT，看比例）：mount 98 → 77 ms，unmount 11 → 8 ms。

## 归因（cpu-profile，修好 self 列之后）

- 帧采样里 TextPainter 占 36%：`RenderParagraph._layoutTextWithConstraints` 每次挂载
  ~25 ms（2000 次原生 SkParagraph 排版），卸载时 `RenderParagraph.dispose` ~12 ms。网格只有
  40 种不同段落 → 共享后排版 40 次、hide→show 复挂时 0 次。
- 剩余：Element/RenderObject 的创建与 GC、`FjsStyle._v` 等对空 `const {}` props 的查找
  （ConstMap 哈希，~5 ms/挂载，可加 isEmpty 短路）。

## 兼容

- `_FjsText` 仍是 `Text` 子类，`find.text` 照常命中（直接出 RichText 会让所有 app 的
  widget 测试失效——试过后退回）。四个测试用了精确类型 `find.byType(Text/RichText)`，改成
  `byWidgetPredicate((w) => w is …)`。
- 选择容器之上（SelectionArea）、fade 溢出、无环境 scope 的调用方：走原 `Text.build`。
- 系统字体变化：清空共享缓存并重排。

## 追加：props 空表短路（已做）

`MirrorNode.prop(key)`：props 为空（绝大多数节点的 `const {}`）时直接返回 null；
renderer / gesture / node_adapters / text 的 `node.props['x']` 全部改走它，
`FjsStyle._v`、`hasTouchEvents` 同样短路。flutter test 562 通过。

真机复测：挂载帧 68–77 ms、show 上屏 121–131 ms——与上一步（67–74 / 116–132）
**在波动范围内持平**，profile 里看到的 ~5 ms 没有在端到端读数里显出来。改动无害、
保留。

## 下一步（未做）

1. 简单盒子 Padding(margin)+DecoratedBox+FjsFlex 合成一个渲染对象：每格少 2 个
   Element + 2 个 RenderObject（2050 × 4），需要动 flex/decoration 管线，单独评估。
