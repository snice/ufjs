# Plan: 132-vant-button-label

只动 `packages/flutter_fjs/lib/src/mirror_tree.dart`（web 为浏览器原生）。

- `_touch(id)` 在现有 `_markParent`（段落根链）之外，补一个
  `_markButtonLabel(parent)`：从父节点向上走，把遇到的每个 `button` 祖先加进
  `_dirty`。中间节点（普通 view 等）只路过、不标，按钮外的文本编辑不产生
  额外重建。
- 为什么标**全部** button 祖先而不是最近一个：`_buttonLabel` 的下探穿过所有
  tag（含嵌套 button），外层按钮的标签字符串包含内层按钮的文本。
- 为什么 mirror_tree 可以知道 button 的适配器行为：与既有
  `props['htmlBlock'] == true`（view 段落根）同款先例，注释里写明契约来源
  （widgets/button.dart `_buttonLabel`），宪法 V/VI。
- 成本：每次 setText 多一次 O(路径深) 的只读上溯（两次 Map 查找每层），与既有
  嵌套 span 链的上溯同阶；挂载期千级文本节点实测可忽略。

测试 `test/button_label_test.dart`：夹具仿 `html_block_paragraph_test.dart` 的
op 编码器，结构复刻 van-button（button > view(htmlBlock) > text > text），
断言 `find.text('bottom')` 且 `find.text('top')` 消失；修复前为红。
