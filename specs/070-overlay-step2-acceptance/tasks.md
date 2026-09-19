# Tasks: overlay 第二步真机验收收尾

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## D1：静态节点挂载崩溃（根因已定位）

- [x] T001 `packages/fjs/src/bundler/vue-plugin.ts`：app 构建的
      `compileTemplate` 加 `hoistStatic: false`，注释写明为什么
      （自定义非 DOM renderer 无 insertStaticContent 的 DOM 字符串语义）
- [x] T002 回归：构建产物断言——含静态子树的 SFC 编译产物不再引用
      `createStaticVNode`（packages/fjs 既有测试旁加一条）
- [x] T003 `packages/fjs-runtime/src/vue/renderer.ts`：nodeOps 兜底
      `insertStaticContent`（rich-text HTML 解析复用或指名报错，按 plan
      二选一），配 renderer 层单测
- [x] T004 设备验证：vant-feedback 正常渲染；tabs+field 组合页正常渲染；
      恢复 vant-nav 的 van-search 并移除页面注释里的绕过说明

## D3：NavBar(fixed) top:0 落到屏幕底

- [x] T010 widget 测试：经引擎 + overlay 适配器挂载 `position: fixed;
      top: 0` 元素，断言其落在宿主 Stack 顶部（先红后绿）
- [x] T011 根因：设备上跑的是 04:35 启动的旧 dev server + 未重建的 CLI dist（不含本 spec 的 runtime/构建修复）；重建 `packages/fjs` 并用 `fjs run ios` 重起后 NavBar 即落在顶部，无需代码修改
- [x] T012 设备验证：vant-nav 的 NavBar 钉在屏幕顶，Tabbar 贴底不变

## 验收 3 + 新引擎重对拍

- [x] T020 vant-feedback：开 Popup → 滚动页面 → 遮罩与弹层不动；点遮罩
      关闭（069 验收第 3 条闭环，notes.md 补记）
- [x] T021 五个既有 vant 页 + vant-more/vant-nav 在重建引擎上重对拍
      （web ↔ iOS），T022/T032 的「旧引擎结论」逐项刷新
- [x] T022 命令式探针回归：vant-feedback 的 showToast/showConfirmDialog
      仍按预期报「非浏览器环境空操作」

## 文档与验收

- [x] T030 `docs/css-compat.md`：静态 vnode 支持策略、Tabs 下划线差异
- [x] T031 `pnpm run typecheck` + `pnpm test` + `flutter test` 全绿
- [x] T032 spec.md 第 6 节逐条核对；notes.md 记录收尾

## 第一轮执行补充记录（2026-09-19）

- T004 部分：vant-feedback 已恢复渲染（hoistStatic 修复设备验证 ✓）；
  van-search 恢复与 tabs+field 回归待 T011。
- T011 状态：widget 层排除适配器定位问题（overlay_host_test 两契约通过）；
  新线索——host 样式走 SetProps（JS ensureOverlayHost 的真实路径）时
  Positioned.fill 委托表现与 interned 路径不一致（bar 被拉伸至整屏），
  已在 widget 测试复现过一轮，复现步骤见 notes.md「遗留」。
- 新增遗留：vant `useRect` timer 抛错在引擎修复后仍每 tick 刷错误日志
  （行为无害，降噪待议）。

## 第二轮执行补充记录（2026-09-19）

- T011/T012：D3 不是代码缺陷——旧 dev server 与未重建的 CLI 产物。重建后
  NavBar 贴顶（仍顶进状态栏，已登记差异）、Tabbar 贴底。
- 重对拍 vant-nav 新发现并修复两处 Dart 布局缺口（`flex.dart` +
  新增 `stretch_flex.dart`，回归见 `vant_layout_test.dart` 四条）：
  - N1 flex 子项 `margin: auto` 被忽略 → NavBar 标题贴左、压住「返回」。
  - N2 不被父级拉伸的 flex 子项里 `stretch` 撑满父级整行 → Tabbar 文字左对齐。
- T020：Popup 打开后滑动，遮罩与弹层不动（遮罩吞手势，同 web lock-scroll）；
  点遮罩关闭、页面可滚动。
- T004：vant-nav 恢复 van-search（Search 区块）；tabs+field 同页正常渲染。
  输入时暴露 N3：vant Field 的 `onInput` 读 `event.target.composing` 抛
  TypeError，v-model 从未在 App 端生效。修复：DOM 事件对象带 `target`，
  input/textarea 元素有 live `value` 访问器（写入推原生）与空
  `setSelectionRange`（renderer.ts；回归 vue_overlay_pseudo.test.ts）。
- N4（N3 修好后才暴露）：Field 聚焦有值时清除图标出现，值区整体掉到第二行
  ——`.van-field { flex-wrap: wrap }` 映射 Wrap，`flex: 1` 失效。修复：
  有增长项、无 100% 宽子项的横向 wrap 按单行 Flex；横向行里百分比宽度的
  非内置标签（input）按 web 的 `flex-shrink: 1` 收缩（flex.dart；回归
  vant_layout_test.dart 两条）。
- T021：vant-basic / vant-form / vant-feedback / vant-more / vant-nav 逐页
  重对拍完成。剩余差异均为已登记项：iconfont 字形、loading 转圈、row 默认
  align-items: center（Cell 的值垂直居中）、D2 Tabs 下划线、D4/D5 溢出红条、
  D8 Card 行内流、NoticeBar 无省略号（D12 同批）、NavBar 顶进状态栏。

