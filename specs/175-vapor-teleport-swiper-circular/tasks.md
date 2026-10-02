# Tasks: 175-vapor-teleport-swiper-circular

- [x] T1 VaporBackend.querySelector（Flutter / web）
- [x] T2 VaporTeleport
- [x] T3 swiper circular 快照克隆（web 纯 vapor）
- [x] T4 单测：teleport（web / Flutter）、swiper circular
- [x] T5 typecheck + pnpm test；未使用时不进包
- [x] T6 vapor-app 演示；浏览器 + iOS；check
- [x] T7 文档（vue3.md / vapor-contract.md / web.md）

## 结果
- 单测：Teleport web 2 条（进 body / disabled 来回 / to 变化 / 内容里 v-if / 卸载移除；无目标告警原地）、Flutter 1 条（`to="body"` 进应用浮层宿主、disabled 搬回同一元素）；swiper circular 1 条；根位置 v-for 1 条
- 顺带修：作为 slot / 组件根的 `v-for`（`createFor` 无插入点）条目从不进树、组件卸载也带不走它们——纯 vapor 下 `<swiper><swiper-item v-for>` 原来是空的
- transition 两个测试文件改用假时钟（真定时器在满载测试下抢时序，偶发失败）
- 浏览器：克隆格在首尾、真页面各一次；从第 0 页往回拖经头部克隆落到第 2 页，偏移回到真实格；遮罩挂在 body 下盖满视口，点击关闭；无报错
- iOS 模拟器（dev）：遮罩盖住整屏含导航栏（应用浮层宿主），点击关闭；circular swiper 正常
- vapor-app Flutter check 通过
