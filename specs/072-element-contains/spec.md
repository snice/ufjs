# Spec: host element 补 DOM `contains()`，修 vant Checkbox/Radio 点击无响应

- **ID**: 072-element-contains
- **状态**: done
- **日期**: 2026-09-19
- **来源**: vant-form 页 App 端（iOS 模拟器）实测。specs/070 起 DOM 形事件带
  `target` / `currentTarget`，vant 的 Checker 因此走进了此前够不着的分支。

## 1. 要解决什么

App 端点 vant 的 Checkbox / Radio 没有任何反应：勾选图标不动、`v-model`
不变，日志只有一行 `[fjs/dispatch-event] TypeError: not a function`。
Web 端同一页面正常。

根因（已读源码确认）：vant `checkbox/Checker.mjs` 的 `onClick` 是

```js
const iconClicked = icon === target || icon?.contains(target);
```

`icon` 是 `iconRef` 指向的 host element；fjs 的 host element
（`ui/element.ts` 的 `makeElement`，经 `vue/renderer.ts` 的
`nodeOps.createElement` 创建）没有 DOM 的 `contains` 方法，调用即抛，
`emit('toggle')` 永远走不到。

同一写法在 vant 里还有两处（`image-preview/ImagePreviewItem.mjs`、
`floating-panel/FloatingPanel.mjs`），修好后一并受益。

## 2. 不做什么（Non-goals）

- **深层 target**：fjs 事件的 `target` 仍是挂监听的那个节点（ui-api.md
  「没有深层 target」一条不变）。因此 Checker 里 `iconClicked` 在 App 上
  恒为 false——默认 `label-disabled=false` 时不影响（点哪都切换）；
  `label-disabled` 时 App 端点图标也不切换，登记为已知差异，不在本 spec
  里做命中测试式的深层 target。
- 不补其它 Node/Element 方法（`closest`、`compareDocumentPosition`、
  `getBoundingClientRect` 等）——遇到真实用例再立项。
- 不做 React 适配层要的 `ui/tree.ts` 抽取（待澄清 1 已定：放渲染器）。

## 3. 用户可见的行为

页面代码不变（vant 标准写法，`demo/src/pages/vant-form.vue` 现状）：

```vue
<van-checkbox-group v-model="checkboxGroup" direction="horizontal">
  <van-checkbox name="a">甲</van-checkbox>
  <van-checkbox name="b">乙</van-checkbox>
</van-checkbox-group>
<text class="echo">选中 = {{ checkboxGroup.join(', ') || '∅' }}</text>
```

修复后 App 端点「乙」：勾选图标出现、回显变成 `选中 = a, b`；点「选项二」：
单选圆点移过去、回显更新——与 Web 一致；日志无 `not a function`。

对 DOM 写法的代码：`el.contains(other)` 按 DOM 语义返回
「`other` 是 `el` 本身或其后代」，`other` 为 null/undefined/非元素时返回
false（DOM 对 null 也返回 false）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `el.contains(other)` | 沿渲染器影子树（`parentOf`）从 `other` 往上找 `el` | 原生 `Node.contains`（runtime-dom 元素即真 DOM） |
| 事件 `target` | 挂监听的节点（无深层 target） | 真实命中的最深节点 |
| 已知差异 | vant Checkbox/Radio `label-disabled` 时点图标不切换（缘于无深层 target，非 contains） | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及：纯 JS 侧，读已有的影子簿记，不过桥。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 全绿；`packages/fjs-runtime/test` 新增
   单测：经 Vue 渲染的父子孙三层元素上 `contains` 对自身/后代为 true，
   对祖先/兄弟/null/已卸载节点为 false；并有一条「DOM 事件处理器里调用
   `target.contains`」不抛错的回归（照 `vue_overlay_pseudo.test.ts` 的
   op 解码 harness 与 DOM 事件测试写）。
2. iOS 模拟器 `cd demo && fjs run ios` → 打开 vant-form：点「乙」勾选图标
   出现、回显 `选中 = a, b`；点「选项二」圆点移动、回显更新；日志无
   `[fjs/dispatch-event] TypeError`。
3. 同页在 Web（`pnpm --dir demo exec vite --port 5175`，
   http://localhost:5175）上同样操作，表现与 App 一致。
4. `docs/ui-api.md` 描述 DOM 形事件对象那段补上 `contains()`；
   `label-disabled` 差异登记进「与浏览器的差别」。

## 7. 待澄清

- [x] **1. `contains` 放哪一层？** 已拍板（2026-09-19）：**放 Vue 渲染器**。
  `nodeOps.createElement` 时挂上，走 `renderer.ts` 已有的 `parentOf`，与
  specs/070 的文本控件 `value` 访问器同处。element 层（`ui/element.ts`）不持有
  树（`appendChild` 直接写 op、不记父子）；等接 React 按
  docs/custom-renderer.md 把 `parentOf/childrenOf` 抽到 `ui/tree.ts` 时，
  `contains` 随之下沉，代码注释里写明这一点。
