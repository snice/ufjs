# Spec: vant Sticky / Popover 示例，App 端 click 冒泡与 parentNode

- **ID**: 129-vant-sticky-popover
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

demo 新增 `vant-float` 页，照 vant 文档放 Sticky（基础 / 吸顶距离 / 指定容器）与
Popover（浅色 / 深色 / 水平 / 图标 / 禁用 / 自定义内容 / 位置 / 非受控）示例。
Web 端直接可用；App 端两处坏：

1. **Popover 点了不弹**。vant 把点击监听挂在包住参照元素的 `<span @click>` 上，
   参照元素是 `van-button`（自己也有 click 监听）。App 端 tap 只派给最内层有监听的
   节点（Flutter 手势竞技场，内层 GestureDetector 胜出），**不冒泡**；web 上 DOM
   click 冒泡到 span。同理 `@click.stop` 在 App 上是空操作（`stopPropagation` 是空函数）。
2. **Sticky 不吸顶**。vant `useScrollParent` 沿 `el.parentNode` 往上找
   `overflow-y: scroll|auto` 的祖先，要求 `node.nodeType === 1`。fjs 元素没有
   `parentNode` / `nodeType` / `tagName`，第一步就退回 `window`；shim 的 window 不派发
   scroll，`onScroll` 永远不跑。

实现中又发现（都已纳入）：

3. **Popover 挂不上**：vant 默认 `teleport="body"`，renderer 的 `querySelector` 恒为 null，
   Vue 挂载 Teleport 失败，后续更新报 `isSameVNodeType` 错。
4. **popperjs 定位失败**：`instanceof Element` 在没有全局 `Element` 时抛错；
   `isHTMLElement` 为假就不写样式；读 offsetParent 的 `scrollLeft` / `clientLeft`
   得到 undefined → 坐标 NaN，弹层停在 0,0。
5. **吸顶按钮盖住弹层**：overlay 宿主只按插入顺序叠放，Sticky（z-index 99）后挂上，
   盖住先开的 Popover（2000+）。
6. **Popover 没阴影**（用户追加）：`overflow: hidden` 的裁剪把盒子自己的 box-shadow 一起裁了；
   且 `.van-popover { overflow: visible }` 没有重置 `.van-popup` 的 `overflow-y: auto`
   （引擎不展开 `overflow` 简写），整个弹层也被裁。
7. **Popover 没箭头**（用户追加）：箭头朝向写在 `.van-popover[data-popper-placement^=top]
   .van-popover__arrow` 属性选择器里，引擎只认 `[class…]`；箭头又是 CSS 三角形
   （`width: 0; height: 0; border-width: 6px` + 单边 `currentColor`），App 端还缺：
   元素自身的 `currentColor` 替换、`calc(6px * -1)` 折叠、border-box 盒子不小于边框、
   单边颜色沿用 `border-width`（此前当成 1px 细线）。

8. **再次点按钮不关闭**（用户追加）：vant 在 touchstart 用 `contains(target)` 判断点外关闭；
   按下落在按钮的 `::before` 装饰盒上，伪元素盒不在影子树里，`contains` 为假 → 先关后被 click 重开。
   全局按下的 target 映射回生成它的元素。
9. **Sticky 回滚后不解除**（用户追加）：renderer 只把变成 `position: fixed` 的元素挪进 overlay
   宿主，从不挪回；解除吸顶后它仍钉在宿主里，占位也读到错的 rect。现在 fixed 取消即回原位。

## 2. 不做什么

- 只让 tap（`@tap` / `@click`，事件号 1）冒泡；input / change / focus 等仍只派给自己
  （触摸事件本来就按路径派发，见 ui-api.md）。
- 不做捕获阶段、不做 `stopImmediatePropagation` 与同节点多监听的区分。
- 不伪造全局 document/window（specs/070）；`overflowY` 的回答放 demo 的 dom-env shim。
- 不改小程序端（bindtap 原生冒泡）。
- 属性选择器只认引擎看得到的属性（class / data-* / aria-* / role / tabindex），其余照旧警告跳过。
- 不修 vant Grid `square`（App 上高度为 0）：另案；示例的自定义内容先不用 square。
- 不做 `position: fixed` 的 static position（auto 偏移贴 0），登记进 css-compat。

## 3. 用户可见的行为

```vue
<view @click="outer">
  <van-button @click="inner">按钮</van-button>   <!-- 两端：inner 然后 outer -->
</view>
<view @click="outer">
  <button @click.stop="inner">按钮</button>       <!-- 两端：只有 inner -->
</view>
```

- 冒泡时 `event.target` 是被点中的节点，`event.currentTarget` 是当前监听节点
  （Vue 的 `.self` 修饰符因此在 App 上也正确）。
- 元素新增只读 `parentNode` / `parentElement`（挂载树里的逻辑父节点，页面根之上为 null）、
  `nodeType`（1）、`tagName`（fjs 标签大写，如 `VIEW`）。
- demo `vant-float`：两端点按钮弹出菜单、选中项回显；页面下滚时 Sticky 按钮吸顶，
  指定容器的按钮随容器底边推出。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | JS 派发层沿父链把 tap 依次交给有监听的祖先，`stopPropagation()` 生效 | 原生 DOM 冒泡 |
| 事件载荷 | 不变（DOM 形事件对象） | 原生 |
| 已知差异 | 冒泡只在 JS 侧发生：祖先的 GestureDetector 本身仍不触发（不会双发）；`:active` 按下态只在被点中的节点。fixed 的 auto 偏移贴 0 | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及（事件号不变，只改 JS 侧派发顺序）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm --filter @ufjs/runtime test`、`flutter test` 通过；runtime 新增测试：
   - tap 派给子节点后依次到有监听的祖先，`target` 为子节点、`currentTarget` 为祖先；
   - `stopPropagation()` 后祖先不再收到；
   - `parentNode` 返回逻辑父节点、卸载后为 null；`nodeType === 1`。
2. iOS 模拟器 demo `vant-float`：Popover 各示例弹出、选中回显、点外部关闭；
   下滚后 Sticky 按钮吸顶。
3. Web `vant-float` 行为不回退。
4. 文档：ui-api.md（tap 冒泡、元素 DOM 成员）、css-compat.md（fixed 的 z-index 与 auto 偏移、
   overflow 简写与阴影、属性选择器、box-sizing 下限、单边颜色宽度、currentColor、calc 折叠）、
   vue3.md（Teleport to body、dom-env 补充）。
5. Dart 测试：overflow:hidden 盒子的阴影在裁剪外；0×0 加边框的盒子（绝对定位 / 文档流）是 12×6。
   runtime 测试：overflow 简写重置两个长写；`[data-x^=…]` 匹配（含祖先复合）与后注册规则；
   元素 `currentColor`；calc 乘除折叠。
6. 模拟器：Popover 浅色 / 深色 / 向上弹出的阴影与箭头同 web。

## 7. 待澄清

无。
