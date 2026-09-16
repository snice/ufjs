# Plan: 消消乐宝石改「星星贴片」样式 + 开局雨落动画

对应 spec：`./spec.md`。纯 hello-fjs 页面层改动，不碰 runtime / cli /
flutter_fjs，宪法 II 三张表不涉。

## 宪法自查

- I 两端同源：页面源码三端共用；pixi 版被 mp exclude 是 058 既有事实。
  新增的"对齐面"是两份页面实现的绘制数值与动画节奏，收进共享模块。
- II 边界即契约：不涉。
- V 静默失效：Leafer 版不下沉 alpha（离屏合成限制）在 spec §4 与代码
  注释里写明，属于登记过的已知差异，不是静默降级。
- VI 注释记录权衡：雨落延迟公式、为什么不复用 glideTo 的 easeOut、
  Leafer 为何无 alpha，都留注释。
- VII JS 能包就不要下 Dart：本来就是 JS 自绘，不新增宿主能力。
- VIII 文档：示例页玩法级样式，docs/ 无需登记（ui-api/css-compat 不变）。

## 改哪些文件

| 文件 | 动作 |
|---|---|
| `examples/hello-fjs/src/match3/tile.ts` | 新建。贴片调色表（base → light/dark/star 程序化派生）、五角星顶点、雨落动画参数与延迟公式。两页共享，保证数值同源 |
| `examples/hello-fjs/src/pages/example/game/match3.vue` | drawGem 换贴片分层绘制；新增 playIntro 雨落；resolveBoard 盘外补充改重力下落 + 半透明入场 |
| `examples/hello-fjs/src/pages/example/game/leafer-match3.vue` | makeGem 换 Rect/Star 分层；同款 playIntro（无 alpha，落定挤压照做）；补充下落同 pixi 语义 |

不改：`@/match3/model`、`@/adapters/*`、`app.config.ts`（工作区里那笔
appid 注释改动与本 spec 无关，不动它）。

## 顺序

1. tile.ts：`hexMix`、`buildTiles(colors)` → `{ base, light, dark, star }`、
   `starPoints(outer, inner)`、雨落常量（ROW_GAP_MS、COL_JITTER_MS、
   FALL_PER_CELL_MS、SQUASH_MS）与 `introDelay(r, c, rows, rand)`。
2. pixi 页：drawGem 重写（rim/face/gloss/sparkle/star 五层 Graphics）；
   tween 工具补 `wait(ms)`；`playIntro()` —— 全部宝石先摆到盘外上方，
   按 introDelay 分批 easeInQuad 落下（alpha 0.45→1），落定挤压；
   build 完成与 restart 调用，期间 busy；spawns 换重力下落。
3. leafer 页：makeGem 重写（Rect rim/face/gloss/sparkle + Star）；
   同款 wait/playIntro（无 alpha）；spawns 同语义。
4. typecheck → 单测 → dev:web 走查两页 → iOS 模拟器 leafer 页。

## 风险

- pixi `Graphics` 每颗宝石从 2 层变 5 层：仍走批渲染（BATCHABLE_SIZE
  已放宽到 10000），8×8×5 ≈ 320 个小图形，量级无虞。
- Leafer 落定挤压用 `scale = {x,y}`：确认 IUnitPointData 形状可用，
  不行就退化为 uniform pulse（在实现时验证）。
- 雨落总时长 ≈ 7×80 + 120 + 单块 ~300ms ≈ 1s，不挡操作（busy 期间
  本来也不接输入）。
