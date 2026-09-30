# Tasks: 162-native-clone-many

- [x] T1 op 编码——落在 native-style.ts `cloneMany`（复用 `styleTemplate` 通用写字通道，
      ops.ts 零改动；与 plan 的偏差，字符串打包与 defineTemplate 同款）
- [x] T2 fjs_style.h 枚举与线格式注释
- [x] T3 style.cpp：clone_at 重构 + CLONE_MANY 解码/展开。实现修正一处：root 插入**deferred
      到帧末**（word 流先于字节流处理，parent/anchor 可能由同帧字节 op 创建，word 阶段
      校验会误拒——VDOM 互操作场景）。anchor index 在帧末解析
- [x] T4 style_test.cpp CLONE_MANY 用例（展开顺序 / anchor 前插 / 文本覆盖）
- [x] T5 native-style.ts / style.ts 透传
- [x] T6 renderer.ts `fillCloneHosts` 抽取 + `cloneListMany`（root 走 trackInsert 补记）
- [x] T7 runtime.ts `VaporBackend.cloneList` 缝 + repeatTemplate（texts 随 op）/
      repeatTemplateLive（texts=null）接入
- [x] T8 backend-flutter（plan/textIdx 映射，不可批量返 null）/ web（cloneNode 等价）
- [x] T9 vitest：web 等价（新文件，happy-dom；顺带补上 web 入口缺失的
      `toDisplayString` 再导出——web vapor 首次被端到端跑，暴露的缺口）+ 既有回退 parity 全绿
- [x] T10 cmake 重建 + fjs-style-test ok + fjs-test ALL PASS
- [x] T11 bench：静态 12.4 → **10.2 ms**、Live 30.3 → **26.4 ms**、帧 47.8KB → 3.8KB（静态），
      更新 0.0/1.7/16.7 不变；performance.md 已记
- [x] T12 真机复测（build-apple.sh 重出产物后）：挂载中位 ~87 ms（VDOM ~93），帧流量
      21KB vs 47KB；更新 1.1–1.2 ms 改 1 格（VDOM ~60）、2000 格中位 ~48（VDOM ~75）——
      数字已记 performance.md
