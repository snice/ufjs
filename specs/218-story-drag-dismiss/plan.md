# Plan: story-drag-dismiss

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 全部在示例页 `CardExpand.vue`，用两端都有的触摸事件 + `transform` + `transition`；web 差异见 spec §4 |
| II 边界即契约 | 否 | 不动 ops / natives / 事件表 |
| III 同步单线程零序列化 | 是 | 每个 touchmove 一次 setProps（`drag.vue` 示例同款），无桥、无 Worker |
| IV 外观照 WeUI | 否 | 示例自己的样式，不改内置组件 |
| V 静默失效是 bug | 是 | 圆角不走 transition（App 端不支持），逐帧直接写；不用 `backdrop-filter` |
| VI 注释记录权衡 | 是 | 代码里写明：为什么姿态容器包住 hero+内容、为什么松手收起要"先交换再飞"、阈值常量的来源（录屏） |
| VII JS 能包就不要下 Dart | 否 | 零 Dart |
| VIII 变更落到文档 | 否 | 无新增能力 |

## 2. 涉及的层

只改一个文件：

| 层 | 文件 | 改什么 |
|----|------|--------|
| 示例组件 | `examples/app-store-clone/src/components/CardExpand.vue` | ① 新增 `.dim` 遮罩层与 `.pose` 姿态容器（包住 `.hero` / `.content` / `.close`）；② 在 `.content`（scroll-view）上挂 `@scroll`（取 scrollTop）与 `@touchstart/move/end/cancel`；③ 拖动状态机（idle → armed → dragging → closing/restoring）；④ 松手收起：先把姿态换算成 hero 的矩形再飞回卡片 |
| 规格 | `specs/218-story-drag-dismiss/{spec,plan,tasks}.md` | 本组文档 |

已确认存在的参照：`examples/app-store-clone/src/components/CardExpand.vue`、
`examples/hello-fjs/src/pages/example/interaction/drag.vue`（touch + transform 范式）、
`docs/ui-api.md`「触摸事件」「scroll-view `@scroll`」两节。

## 3. 方案

**姿态容器**：`.pose` 是铺满视口的绝对定位盒，`overflow: hidden` + `border-radius`
+ `transform`，hero、内容、✕ 都放进它里面，这样"整页作为一个整体"缩放/圆角裁剪，
不用逐个子节点同步。

**拖动**：手势只挂在内容 scroll-view 上，用 `@scroll` 记 scrollTop，按下时 ≤0.5 才
"待判定"。拖动开始后把起点重置为当前位置，避免 10px 的判定距离造成跳变。`bounces=false`
关掉到顶的橡皮筋，否则 iOS 的过滚位移会叠在我们的姿态上。

**松手收起（先交换再飞）**：姿态是 `transform`，而回飞用的是 hero 的 left/top/width/height
几何过渡（217 的既有路径）。两者不能同时插值，所以：内容淡出 120ms → 把当前姿态换算成
等价的 hero 矩形并**无过渡地**交换（姿态复位、hero 放到该矩形，圆角 = `r × s`，肉眼不可见）
→ 下一帧起 hero 用既有几何过渡飞到卡片矩形。
**被否的备选**：让姿态容器自己 transform 到卡片位置。卡片（362×430）与屏幕（402×874）宽高比
不同，等比缩放对不上，需要同时裁剪，复杂且两端要各自验；换算矩形再飞复用既有路径，代价是
一次 120ms 的内容淡出。

**回弹**：姿态 `transition: transform 0.3s`；圆角和遮罩在回弹结束的定时器里归零
（圆角不在 App 端 transition 支持列表里）。

## 4. 风险

1. **App 端 touchmove 是否在 scroll-view 滚动期间仍到达**：文档说是原始指针事件、归属节点，
   应当可以；模拟器上必须验。若收不到，退路是只在 `.top` 封面区挂手势。
2. **到顶下拖时 scroll-view 也在抢手势**：`bounces=false` 后到顶无位移，但手势竞技场可能让
   `touchcancel` 提前触发。验收 #4 看是否被打断。
3. **姿态容器上的 `overflow:hidden` + 圆角 + 内含 `glass-surface`（✕ 钮）**：217 踩过
   BackdropFilter 与祖先 opacity/裁剪的坑。✕ 在姿态容器里会被一起裁剪；若玻璃在缩放时渲染
   异常，退路是拖动期间把 ✕ 的玻璃换成纯色。
4. **hero 交换那一帧的圆角/位置误差**：换算错会看到一次跳变，需对照录屏。
5. 217 的坑仍适用：展开层必须常驻 + `v-show`；hero 用 `absolute`；不要对含玻璃的子树做 opacity 过渡。

## 5. 验证路径

```bash
pnpm --filter app-store-clone run typecheck
pnpm --filter app-store-clone run dev:web      # 桌面鼠标拖，逐条核对 spec §6 #2 #3 #5 #6
cd examples/app-store-clone && fjs run ios     # 模拟器 touch_path 拖动，核对 #4
pnpm run typecheck && pnpm test
```
