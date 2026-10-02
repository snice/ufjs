# Spec: vapor 下的 Teleport 与 swiper 循环模式

- **ID**: 175-vapor-teleport-swiper-circular
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

1. **`<Teleport>` 在 vapor 模板里是降级实现**（specs/170）：内容原地渲染并告警。弹层、
   全屏遮罩这类要挂到 body / 应用浮层的内容因此被父容器裁剪或盖住。render-function
   组件里的 Teleport（render-host，specs/171）已经能用，只缺 vapor 模板这一条路。
2. **web 纯 vapor 下 swiper `circular` 是坏的**：VDOM 版靠复制 vnode 做首尾两个克隆页；
   vapor 的 swiper-item 是活节点（render-host 的 host marker），复制 marker 等于把同一个节点
   挂两次——首尾克隆把真页面挪走，页序错乱。Flutter 端的循环在 Dart 里实现，不受影响。

## 2. 不做什么（Non-goals）

- Flutter 的 swiper（原生 PageView）不动。
- VDOM 下的 Teleport / swiper 不动。
- `<TransitionGroup>`：另立 spec。
- Teleport 到 `body` / `html` 以外的选择器在 Flutter 上仍无目标（与 VDOM 一致：Flutter 没有可查询的 DOM）。

## 3. 用户可见的行为

```vue
<script setup vapor>
import { ref } from 'vue'
const open = ref(false)
</script>
<template>
  <Teleport to="body" :disabled="!open">
    <view v-if="open" class="mask" @tap="open = false" />
  </Teleport>
  <swiper circular autoplay indicator-dots>
    <swiper-item v-for="i in 3" :key="i"><text>{{ i }}</text></swiper-item>
  </swiper>
</template>
```

- **Teleport**：`to`（选择器或元素）、`disabled`（为真时原地渲染）、`defer`（等组件挂载后再找目标）；
  `to` / `disabled` 变化时内容整体搬过去，状态不丢；组件卸载时内容一起移除。
  内容里的 v-if 等切换照常落到目标里。找不到目标：告警一次，原地渲染。
  - web：`document.querySelector(to)` 或传入的元素。
  - Flutter：`body` / `html` → 应用浮层宿主（与 VDOM 的 Teleport 同一个落点，不随页面被盖住）。
- **swiper circular（web 纯 vapor）**：首尾无缝循环，`@change` 报真实下标，与 VDOM 版一致。
  克隆页是真页面 DOM 的快照（`cloneNode(true)`），在它可能露出来之前（拖动开始、
  自动播放 / `current` 跨边界翻页前）刷新。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| Teleport 目标 | `body`/`html` → 应用浮层宿主；其他选择器无目标（告警，原地） | 任意选择器 / 元素 |
| swiper circular | Dart PageView，不变 | 首尾快照克隆页 |
| 已知差异 | 无新增 | 克隆页只在跨边界的那一下可见，是静态快照：`<canvas>` 内容不复制、克隆页不响应点击（落定后马上换回真页面） |

## 5. 契约变更（宪法 II）

- [x] 都不涉及（`VaporBackend` 新增可选 `querySelector`，runtime 内部接口）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；新增单测：
   - Teleport（web）：内容进 body、`disabled` 来回切换节点搬移且状态保留、`to` 变化、
     内容里 v-if 切换落在目标里、卸载时移除、无目标告警原地渲染；
   - Teleport（Flutter）：`to="body"` 的内容挂在应用浮层宿主下；
   - swiper circular（web 纯 vapor）：页序正确（真页面各只出现一次）、克隆页内容与首尾页一致、
     `@change` 报真实下标。
2. `examples/vapor-app` 演示页加 Teleport 遮罩与循环 swiper：web 浏览器与 iOS 模拟器上
   遮罩盖住全屏、点击关闭；web 循环翻页首尾无缝。
3. vapor-app Flutter check（fjsrun）通过。

## 7. 待澄清

无。
