# Plan: 175-vapor-teleport-swiper-circular

## 1. Teleport（vapor/runtime.ts）

- `VaporBackend.querySelector?(selector)`：Flutter = host-ops `nodeOps.querySelector`
  （body/html → 应用浮层宿主）；web = `document.querySelector`。
- `VaporTeleport`（替换降级版）：渲染 slot 得到 block；原位留一个占位锚点作为返回的 block；
  一个 renderEffect 读 `to` / `disabled`，解析目标后把 `block.nodes`（活数组——slot 根若是
  v-if 切换，`createSwitch` 用 `parentNode(anchor)` 找父节点，自然落在目标里）attach 过去，
  `disabled` 时 attach 回占位锚点之前。`defer`：首次解析放到 onMounted。
  卸载：block cleanups 里移除内容节点。
- `/* @__PURE__ */`，未使用时不进包。

## 2. swiper circular（web/components/swiper.ts）

页面是 host marker（`props.__host`）时不复制 marker：首尾克隆格渲染成空的
`swiper-item`（带 ref），`refreshClones()` 用真页面 host 的 `cloneNode(true)` 填充，并同步
它的 class（加上 track cell 类）与 style。刷新时机：挂载后、指针按下、`goTo` 跨边界之前。
VDOM 路径不变。

## 3. 测试与验证

单测（web + Flutter）；vapor-app motion 页加 Teleport 遮罩、循环 swiper；浏览器 + iOS；check。
