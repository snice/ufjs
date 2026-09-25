# Spec: vant 按钮文本在 App 端不更新

- **ID**: 132-vant-button-label
- **状态**: done
- **日期**: 2026-09-25

## 1. 要解决什么

demo `vant-float` 页：点「换位置」轮换 popover 的 placement，左侧参照按钮的文本
（`<van-button>{{ placement }}</van-button>`）在 web 上即时跟着变，App 上不动；
再按一次这个按钮（或任何让按钮重建的事——按压、样式变化）文本才"追上"。
块标题 `Popover{{ selected ? … }}` 这类普通文本节点的更新不受影响。

排查结论（设备 + 探针实测）：

1. JS 侧正常——Vue patch 调用了 `nodeOps.setText(222, "bottom")`，op 5 正常编码；
2. Dart 侧正常——镜像节点的 `.text` 已是新值（打开 popover 触发的无关重建能读出新文本）；
3. 断在**重建信号**：`mirror_tree.dart` 的 `_markParent` 向上标脏只走嵌套 text 链、
   止于段落根（span 或 htmlBlock view），而 `widgets/button.dart` 的按钮对纯文本
   子树走"标签快路径"——`_buttonLabel` 把整棵子树的文本拼成一个字符串直接给
   `Text`，**不构建中间节点的 widget**。于是 span/div.content 的信号打在没有
   listener 的地方，`button` 节点本身从未被标脏，旧标签一直挂着。

受影响面：任何"按钮子树里有响应式文本"的场景——van-button 的
`{{ }}` 标签、loading 文本切换、按钮内图标（伪元素 content 也是 setText）。
web 为浏览器原生 DOM，不存在此路径，无需改动（宪法 I 在此端登记即完成）。

## 2. 验收标准

- [x] `test/button_label_test.dart`：复刻 van-button 结构
      `button > div.content(htmlBlock) > span.text > text`，setText 内层文本后
      一次 `flushDirty + pump`，标签变为新值（修复前该测试红：文本纹丝不动）。
- [x] `node_rebuild_test.dart` 既有粒度断言不回退（按钮外的文本编辑
      不得因本次改动多重建祖先）。
- [x] `flutter test` 全绿（515 通过，3 既有跳过）。
- [x] 模拟器 demo `vant-float`：连点「换位置」，按钮文本 top → bottom → left →
      right → bottom-start → bottom-end 即时跟手，无需再按一次。

## 3. 不做

- 不改 `_buttonLabel` 的快路径本身（有意的优化，注释写明了理由）；只修标脏协议。
- 不动 web 侧。
- 按钮内嵌按钮（标签字符串包含内层按钮文本）由"标记全部 button 祖先"顺带覆盖，
  不单独建测试。
