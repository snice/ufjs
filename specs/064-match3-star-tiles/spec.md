# Spec: 消消乐宝石改「星星贴片」样式 + 开局雨落动画

- **ID**: 064-match3-star-tiles
- **状态**: in-progress
- **日期**: 2026-09-16

## 1. 要解决什么

hello-fjs 的两个消消乐页面（`match3.vue` pixi 版、`leafer-match3.vue`
Leafer 版）目前的宝石是 6 种不同剪影的纯色块（圆/菱形/星/圆角方/三角/
六边形 + 一笔高光），开局时整盘瞬间摆好，消除补充也是一次平移。
用户给了参考截图（全民消除星星）：宝石是**糖果质感的圆角方块贴片，
中央一颗同色系浅色五角星**；并给了参考视频：开局时方块**从画面上方
错落地"下雨"落进场**，底行先落定、逐行向上堆齐，空中阶段呈半透明，
落定有轻微挤压回弹。要求两个页面照此重画宝石、照此落下。

## 2. 不做什么（Non-goals）

- 不改玩法与难度：仍是 8×8、6 色（参考图的原游戏是 4 色同剪影，
  本仓库保持 6 色已有难度；样式统一为"圆角方块 + 五角星"后靠色相区分，
  6 色相（红/橙/黄/绿/蓝/紫）彼此仍可辨）。
- 不改 `@/match3/model`：棋盘纯函数（createBoard/findClears/collapse/…）
  一行不动。
- 不改 pixi / Leafer 的接入方式与平台适配层（`@/adapters/*`）。
- 不做音效、粒子、消除爆点等额外表现。
- 不动 `@ufjs/runtime` / `@ufjs/cli` / flutter_fjs：这是页面级改动，
  不涉协议（宪法 II 三张表都不碰）。
- 小程序端不做专门走查（leafer 页真机走查仍是 spec 059 T052，用户侧）。

## 3. 用户可见的行为

两个页面（`/pages/example/game/match3`、`/pages/example/game/leafer-match3`）
行为一致：

1. **宝石样式**：每颗宝石是一块近满格的圆角贴片（约占格子 92%），
   自外向内：深色外圈（bevel）→ 本色底 → 顶部一条浅色光带 →
   左上角白色小高光 → 居中一颗浅色五角星（约占贴片 2/3）。
   6 种颜色同一剪影，只有色相不同；每色的浅色/深色/星色由本色程序化
   派生（mix 白/黑），两个页面取同一组数值（共享 `@/match3/tile.ts`）。
2. **开局雨落**（首次进页、「重开」、以及改变尺寸导致重建时）：
   - **一行一行自下而上落定**：每行作为一个整体落进自己的行号，
     落定时刻按固定节拍（约 130ms/行）推进；上一行还在半空时下一行
     已经出发，连成一段不间断的"雨"（收尾衔接，不散乱）。
   - 落差随行号递增：底行从落点上方约 1.4 格出发，顶部几行从盘外
     出发；同一行内每颗有小幅随机落差（不破坏行的整体感）。
   - 下落为匀速快落、到点急停（对齐参考视频的手感），全程约 1.1s。
   - pixi 版空中半透明（alpha 0.45），落定恢复不透明；Leafer 版不下沉
     alpha（Group opacity < 1 会触发离屏合成，App 端没有离屏画布，
     spec 059 已有约定），直接以下落 + 落定挤压表达。
   - 落定瞬间轻微挤压回弹（scale 1.12×0.86 → 1，约 100ms）。
   - 雨落期间 `busy`，不接受交换输入。
3. **消除补充**：`resolveBoard` 里盘外补充的新宝石改用同款重力下落
   （easeInQuad + pixi 半透明入场的雨落语言）；盘内已有宝石的坍缩平移
   维持现状（短距离 easeOutCubic，与交换手感一致）。
4. 交换、无效回弹、消除缩放、连击计分、死局重排、提示等其余行为不变。

```vue
<!-- 页面代码形状不变，只是 drawGem/makeGem 换实现、build 后多一步 playIntro -->
const tiles = buildTiles(GEM_COLORS); // @/match3/tile.ts
```

## 4. 两端约定（宪法 I）

本 spec 只改 hello-fjs 页面的 canvas 自绘内容，页面源码三端共用，
宪法 I 天然成立。需要登记的"两端"是**同仓库两份实现的对齐**：

| | match3.vue（pixi，WebGL） | leafer-match3.vue（canvas 2d） |
|---|---|---|
| 宝石绘制 | Graphics 分层：rim/face/gloss/sparkle/star | Rect×3 + Rect 高光 + Star，同一组数值 |
| 调色 | `@/match3/tile.ts` 的 hex 转 number | 直接用 hex/rgba 字符串 |
| 雨落半透明 | alpha 0.45 → 1 | **不做**（离屏合成限制，059 §4 已登记） |
| 落定挤压 | `scale.set(sx, sy)` | `scale = { x, y }` |
| 其余动画节奏 | 同一组常量（delay 公式、时长、缓动） | 同左 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck` 通过。
2. `pnpm test` 全绿（运行时与 CLI 不受影响）。
3. `pnpm --filter hello-fjs run dev:web` 起服务，浏览器打开两个页面：
   - 宝石为圆角贴片 + 浅色五角星，6 色同剪影，观感对齐参考图；
   - 进页与「重开」触发雨落：底行先定、逐行上堆、约 1 秒量级落完，
     pixi 版空中半透明、两版落定都有轻微挤压；
   - 雨落期间点棋盘不触发交换；落完后交换 → 消除 → 补充全流程无回归，
     补充的新宝石以重力下落入场。
4. `pnpm --filter hello-fjs run run:ios`（iPhone 模拟器）leafer 页同样
   表现，无离屏合成报错；pixi 页 `build:mp` 仍被 exclude 不受影响。

## 7. 待澄清

- [x] 无阻塞项。备注：参考图原游戏为 4 色，本 spec 默认保持 6 色难度
  （见 §2）；若要照搬 4 色，改 `COLORS` 常量一处即可，不影响本 spec
  的其余内容。
