# Spec: hello-fjs 画布示例「鹈鹕骑行」

- **ID**: 096-canvas-pelican-ride
- **状态**: done（2026-09-22 typecheck + build + build:mp 全绿，web 端可视
  验证通过；Android/iOS 真机对拍为手工项，见 tasks T021）
- **日期**: 2026-09-22

## 1. 要解决什么

`/example/canvas` 分组（画布演示）里现有 7 个页面全是「库驱动」的：ECharts、
F2、three.js、Spine、手写 WebGL——canvas 2d 本体只在组件页 `/comp/canvas`
里以静态图块出现过。缺一个**不依赖任何三方图形库、纯手写 2d 绘制 + 动画
循环**的示例：页面想自己画点会动的东西时该照着抄的那份代码，现在没有。

## 2. 不做什么（Non-goals）

- **不加新依赖**。不引入 pixi / animejs 之外的新动画或图形库，动画就是
  `requestAnimationFrame` + 每帧重画。
- **不改 runtime / 协议 / 组件**。`<canvas>` 组件、`FjsCanvasContext2D`
  类型、op 协议全部现状可用，本 spec 只在 `examples/hello-fjs` 里加页面。
- **不做交互游戏**。那是 `交互游戏` 分组的活；本页只有轻交互（点一下换
  动作/速度即可，不做碰撞、计分）。
- **不做小程序端适配验证**。新页面进 `canvas` 分包自动随 `fjs build --mp`
  编译，但真机表现不作为本 spec 验收项。
- **不做 `docs/` 文档新增**。不改能力面，canvas 用法照
  [docs/canvas-compat.md](../../../docs/canvas-compat.md) 已有条目写。

## 3. 用户可见的行为

新增页面 `examples/hello-fjs/src/pages/example/canvas/pelican.vue`，
首页 → 示例 → **画布演示** 分组里出现一条「鹈鹕骑行」：

- 画面：一只鹈鹕骑着自行车从左往右循环前行，车轮转动、腿蹬踏、鹈鹕
  喙里叼的鱼尾巴摆动、背景视差滚动（云 + 地面），全部用 canvas 2d 路径
  手绘（`arc` / `bezierCurveTo` / `fill` / `stroke` / `translate` /
  `rotate`），不贴图片。
- 动画：`requestAnimationFrame` 循环，`onBeforeUnmount` 里
  `cancelAnimationFrame`；时间用传入的 `now` 累积角度而不是自增计数器，
  掉帧不加速。
- 尺寸：在 `@resize` 里首绘并记录 `width`/`height`（不在 `onMounted` 画，
  App 侧那时尺寸是 0）；页面不乘 `devicePixelRatio`。
- 交互：点一下画布切换骑行速度（慢/快两档），速度变化即时生效；
  触摸载荷用 `FjsTouchEvent` 的相对坐标判定点没点在画布内——只做整块
  画布切换，不做精确命中。
- 面板：复用 `Panel` 组件放分组标题与一句说明，布局与
  `example/canvas/webgl.vue` 一致。
- 分组元信息走 `<route>` 块：`{"title": "鹈鹕骑行", "group": "画布演示",
  "desc": "纯手写 canvas 2d + rAF，零依赖动画"}`，目录页手风琴自动出现。

期望形态（关键片段）：

```vue
<route>
{"title": "鹈鹕骑行", "group": "画布演示", "desc": "纯手写 canvas 2d + rAF，零依赖动画"}
</route>

<script setup lang="ts">
import type { FjsCanvasApi, FjsCanvasContext2D, FjsTouchEvent } from 'fjs';

const cv = ref();
let raf = 0;
let t = 0;            // 累积的骑行时间（ms），由每次 rAF 的 now 差值推进
let last = 0;

function frame(now: number): void {
  if (last) t += Math.min(now - last, 100) * speed.value; // 掉帧封顶
  last = now;
  paint();            // 每帧全量重画：2d 场景量小，不值得做脏矩形
  raf = requestAnimationFrame(frame);
}

function onResize(): void {           // 首绘 + 开始循环，两端同一入口
  paint();
  if (!raf) raf = requestAnimationFrame(frame);
}

function onTap(_e: FjsTouchEvent): void {
  speed.value = speed.value === 1 ? 2.5 : 1;
}

onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <Panel title="鹈鹕骑行" desc="…">
    <canvas ref="cv" class="cv" @resize="onResize" @tap="onTap" />
  </Panel>
</template>
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 同一份 2d 绘制代码，命令编码成显示列表由 CustomPaint 回放 | 浏览器原生 `CanvasRenderingContext2D` |
| 事件载荷 | `@resize` `{"width":n,"height":n}`；`@tap` 字符串化触摸载荷（相对画布坐标） | 同左 |
| 已知差异 | 字体度量亚像素差——本页**不画文字**，规避掉；`shadow` 逐像素差异同理，本页不用 shadow | — |

只使用 `docs/canvas-compat.md` 里标 ✅ 的 API；不用 `roundRect`（❌），
圆角用 `arcTo`/`arc` 拼，不用 `getImageData`、`filter`。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）：不涉及
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）：不涉及
- [ ] 事件类型（`element.ts` + `fjs.h`）：不涉及
- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck` 通过。
2. `pnpm --filter hello-fjs run build` 通过（页面进产物，路由表含新条目）。
3. `pnpm --filter hello-fjs run dev:web`：首页 → 示例 → 画布演示出现
   「鹈鹕骑行」，点进去画面持续动画、点画布切速度、离开页面后控制台无
   rAF 泄漏报错。
4. `fjs dev` + `fjs run android`（或 iOS）：同一条路由、同一画面构图、
   同样的速度切换，动画流畅。
5. `pnpm --filter hello-fjs run build:mp` 通过（新页落进 `canvas` 分包，
   不需要改 `package.json` 的 subpackages 配置）。

## 7. 待澄清

- [ ] 无（「鹈鹕骑行」的具体画面按第 3 节自由发挥，构图细节不设门禁；
      若你有指定构图/配色再提）
