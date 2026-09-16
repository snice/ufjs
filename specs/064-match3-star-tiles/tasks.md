# Tasks: 消消乐宝石改「星星贴片」样式 + 开局雨落动画

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 共享层

- [x] T001 新建 `src/match3/tile.ts`：hexMix / buildTiles / starPoints /
      雨落常量与 planRain（首版为逐颗散落，走查后按视频改为行节拍编排）

## 实现

- [x] T010 `match3.vue`（pixi）：drawGem 换五层贴片绘制
- [x] T011 `match3.vue`：tween 补 ease 参数；playIntro 行节拍雨落
      （匀速快落 + 半透明 + 挤压），build 与 restart 接入，busy 门禁
- [x] T012 `match3.vue`：resolveBoard 盘外补充改重力下落 + 半透明入场
- [x] T013 `leafer-match3.vue`：makeGem 换 Rect/Star 分层（无 Group opacity）
- [x] T014 `leafer-match3.vue`：playIntro（无 alpha、有挤压）+ 补充下落

## 走查

- [x] T020 `dev:web`（:5174）：两页宝石为圆角贴片 + 浅色五角星；雨落
      逐行自下而上、行间衔接（首版逐颗散落被用户打回，已改行节拍）；
      交换 → 消除 → 计分（pixi 12 分、leafer 3 分）无回归
- [ ] T021 iOS 模拟器 leafer 页同款表现，无离屏合成报错（未跑）

## 测试

- [x] T030 `pnpm --filter hello-fjs run typecheck` 通过
- [x] T031 `pnpm test` 全绿（fjs / runtime / webgl）

## 验收

- [ ] T050 spec.md 第 6 节逐条核对（剩 iOS 一项，其余已过）
