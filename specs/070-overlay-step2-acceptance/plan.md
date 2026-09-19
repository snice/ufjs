# Plan: overlay 第二步真机验收收尾

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | hoistStatic:false 只作用于 app 构建；web（DOM renderer）原生支持静态内容，行为两端一致。差异（Tabs 下划线、safe-area）登记进 docs |
| II 边界即契约 | 否 | 不动 op 协议 |
| III 同步单线程零序列化 | 否 | |
| IV 外观照 WeUI | 否 | vant 自带样式 |
| V 静默失效是 bug | 是 | 本 spec 的核心：`not a function` 静默空白 → 构建期消除 + renderer 兜底指名报错 |
| VI 注释记录权衡 | 是 | hoistStatic:false 与兜底实现都写明为什么 |
| VII JS 能包就不要下 Dart | 是 | D1 修复在构建层 + JS renderer；D3 预计在 Dart 样式解析/布局层（那是该逻辑所在层） |
| VIII 变更落到文档 | 是 | css-compat.md 登记静态 vnode 与 Tabs 下划线 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/bundler/vue-plugin.ts` | app 构建的 `compileTemplate` 加 `hoistStatic: false`（自定义非 DOM renderer 无法实现 DOM 字符串静态内容） |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | nodeOps 兜底实现 `insertStaticContent`（复用 rich-text 的 HTML 解析器产出真实 fjs 元素；解析器不可复用时退为指名报错） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/flex.dart` 或样式解析 | D3：先 widget 测试定位 hoisted top:0 元素的实际样式记录/解析结果，修根因 |
| 测试 | `packages/fjs/test/…`（构建产物断言）、`packages/flutter_fjs/test/…`（widget 测试） | 各一条回归 |
| demo | `demo/src/pages/vant-nav.vue` | D1 修复后恢复 van-search（tabs+field 组合验证） |
| 文档 | `docs/css-compat.md` | 静态 vnode 支持策略、Tabs 下划线差异 |

## 3. 方案

**D1**（已定位）：`mountStaticNode → hostInsertStaticContent` 报 not a function。

- 构建层（治本）：`hoistStatic: false`。静态提升是 DOM diff 优化，fjs 的
  op 流 renderer 从中获益有限，却引入整类挂载崩溃。只在 app 构建的
  `compileTemplate` 关；web 的 vite 路径不动。
- 运行时层（兜底，宪法 V）：nodeOps 补 `insertStaticContent(content, parent,
  anchor)`。实现优先用 rich-text 的 HTML 解析（`components/rich-text.ts`
  已有 HTML → view/text/image 的成熟路径）创建真实 fjs 元素并插入，返回
  `[first, last]`；若解析器耦合不可复用，退为抛出指名错误
  （"static vnode reached the fjs renderer — app builds must set
  hoistStatic:false"）。实施时按解析器实际形态二选一。

**D3**（待定位，假设按可能性排序）：

1. hoist 后 `recomputeSubtree` 重算的样式记录丢了 `top: 0`（unit-less 0
   解析、或 `--fixed` 类规则在重算中落选）→ 修样式引擎/解析。
2. `positionedChild` 拿到的 `FjsStyle.position` 不是 fixed → 元素被当
   Stack 非定位子项（但那会在左上，与现象不符，可能性低）。
3. `_AbsLayoutDelegate` 的 Y 计算正确性——widget 测试直接断言，不通过再修。

定位手段：`vant_layout_test.dart` 同款 widget 测试——经引擎挂载
`position: fixed; top: 0` 的元素 + overlay 适配器，断言其在屏幕顶。
失败时打印 mirror 节点的 resolved style 缩小到假设 1/2/3。

**验收 3**：D1 修复后，vant-feedback 可打开 → Popup 开启 → agent-device
滚动页面 → 截图确认遮罩/弹层不动。

## 4. 风险

- `hoistStatic: false` 的体积/性能代价：静态子树改为每次 patch。构建后
  对比 bundle 尺寸（`fjs build --analyze` 一条命令）；明显回超
  （>3%）再评估兜底实现代替编译开关。
- insertStaticContent 兜底若走 HTML 解析：解析器对 vant 模板产出的
  字符串可能有边角不兼容——但有构建层开关兜着，该路径只服务手写
  createStaticVNode 的用户代码。
- D3 若定位在样式引擎，须确认修复不破坏 068/069 已对拍的场景
  （回归：flutter test 全量 + 设备五页重对拍）。
