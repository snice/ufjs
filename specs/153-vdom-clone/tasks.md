# Tasks: 153-vdom-clone

- [x] T1 运行时 `vue/template-block.ts`：`fjsTemplate` 类型（克隆 / 兜底 / 更新 / move / remove），shim 导出
- [x] T2 运行时单测
- [x] T3 编译 `template/clone-blocks.ts` + 接入 `templateCompilerOptions`（仅 Flutter）
- [x] T4 编译单测（合格 / 不合格 / v-for key / 混排文字 / 模板根不改）
- [x] T5 `examples/bench`：native:ts / native:on / native:verify / vapor（含 FlatLive 更新）对拍与计时
- [x] T6 泄漏检查（elements 回基线）
- [x] T7 demo 16 页、bench:mount、hello-fjs 66 页 verify；bench:mount 计时
- [x] T8 typecheck / pnpm test
- [x] T9 文档 + spec §8
- [x] T10 模拟器冒烟
