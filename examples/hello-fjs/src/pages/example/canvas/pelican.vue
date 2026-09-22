<route>
{"title": "鹈鹕骑行", "group": "画布演示", "desc": "纯手写 canvas 2d + rAF，零依赖动画"}
</route>

<script setup lang="ts">
// 画布演示组里唯一不带三方库的一页：图形全是路径，动画就是
// requestAnimationFrame——页面想「自己画点会动的东西」照这页抄。
//
// 受 docs/canvas-compat.md 约束的三件事：
//   1. 首绘在 @resize，不在 onMounted：App 侧那时还没布局，尺寸是 0，
//      而 canvas 是保留式的，0 尺寸画的那一帧会留在画面上。
//   2. 尺寸不乘 devicePixelRatio：宿主按 dpr 光栅化，页面只用逻辑像素。
//   3. 整页不画文字：measureText 两端是不同排版引擎，亚像素差消不掉；
//      没有文字，这页两端就能逐帧对拍。
import { onBeforeUnmount, ref } from 'vue';
import type { FjsCanvasApi, FjsCanvasContext2D } from 'fjs';
import Panel from '@/components/Panel.vue';

defineOptions({ name: 'PelicanPage' });

type Ctx = FjsCanvasContext2D;

const cv = ref<FjsCanvasApi>();
/** ×1 慢 / ×2.5 快，点画布切换。每帧乘进时间增量，改完下一帧就生效。 */
const speed = ref(1);

let ctx: Ctx | null = null;
let raf = 0;
let last = 0;
/** 骑行时间（ms）。只由 rAF 传进来的 now 做差推进——掉帧就掉帧，
 *  用自增计数器的话，卡 3 秒回来会把这 3 秒一次补完，车轮飞转。 */
let t = 0;
let w = 0;
let h = 0;

function onResize(): void {
  const canvas = cv.value;
  if (!canvas) return;
  w = canvas.width;
  h = canvas.height;
  ctx = canvas.getContext('2d');
  if (!ctx) return;
  // 循环只起一次：旋转屏幕会再派 resize，只换尺寸不重开循环
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame(now: number): void {
  if (last) t += Math.min(now - last, 100) * speed.value;
  last = now;
  paint();
  raf = requestAnimationFrame(frame);
}

function onTap(): void {
  speed.value = speed.value === 1 ? 2.5 : 1;
}

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  raf = 0;
});

/** 场景宽度随画布走，所有滚动量都从 t 线性导出——速度切换整幕同步变。 */
function paint(): void {
  if (!ctx || !w || !h) return;
  const dist = t * 0.12; // 地面滚动位移：×1 时 120px/s

  ctx.clearRect(0, 0, w, h);
  paintSky(ctx, w, h);
  paintClouds(ctx, w, h, dist * 0.25);
  paintHills(ctx, w, h, dist * 0.5);
  paintGround(ctx, w, h, dist);

  // 车和鹈鹕钉在画面中央不动，景物往左走 = 车往右骑
  const R = Math.max(16, Math.min(32, h * 0.15));
  const gy = h - 22; // 地平线
  const bx = w / 2;
  paintBike(ctx, bx, gy, R, dist / R); // 轮转角 = 弧长 / 半径（纯滚动）
}

// ── 背景 ─────────────────────────────────────────────────────────────

function paintSky(c: Ctx, w: number, h: number): void {
  // 渐变每帧重建有开销，但这是示例页：一张图里状态齐全比省两次分配重要
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#dcebff');
  g.addColorStop(1, '#f7fbff');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

function paintClouds(c: Ctx, w: number, h: number, offset: number): void {
  const period = w + 160;
  c.fillStyle = '#ffffff';
  for (let i = 0; i < 3; i++) {
    // 模周期取模：云从左边出、右边进，接缝在画布外看不见
    const x = (((i * 173 - offset) % period) + period) % period - 80;
    const y = 18 + i * 16;
    c.beginPath();
    c.arc(x, y, 14, 0, Math.PI * 2);
    c.arc(x + 16, y - 6, 18, 0, Math.PI * 2);
    c.arc(x + 36, y, 13, 0, Math.PI * 2);
    c.fill();
  }
}

function paintHills(c: Ctx, w: number, h: number, offset: number): void {
  const gy = h - 22;
  const period = w + 240;
  c.fillStyle = '#b7e4c7';
  for (let i = 0; i < 2; i++) {
    const x = (((i * 311 - offset) % period) + period) % period - 120;
    c.beginPath();
    c.arc(x, gy + 30, 74, Math.PI, 0);
    c.fill();
  }
}

function paintGround(c: Ctx, w: number, h: number, dist: number): void {
  const gy = h - 22;
  c.fillStyle = '#d8f0df';
  c.fillRect(0, gy, w, h - gy);
  // 路面虚线自己摆段，不用 setLineDash——宿主把虚线切成实段，
  // 长路径上有成本，这里每帧几十个小段，直接 fillRect 最便宜
  c.fillStyle = '#ffffff';
  const gap = 56;
  for (let x = -(dist % gap); x < w; x += gap) {
    c.fillRect(x, gy + 10, 26, 4);
  }
}

// ── 车 + 鹈鹕 ────────────────────────────────────────────────────────

function paintBike(c: Ctx, bx: number, gy: number, R: number, rot: number): void {
  const rearX = bx - R * 1.7;
  const frontX = bx + R * 1.7;
  const hubY = gy - R;
  const crankX = bx;
  const crankY = gy - R * 0.85;
  const seatX = bx - R * 0.95;
  const seatY = gy - R * 3.1;
  const barX = bx + R * 1.25;
  const barY = gy - R * 3.3;
  const CR = R * 0.5; // 曲柄长

  paintWheel(c, rearX, hubY, R, rot);
  paintWheel(c, frontX, hubY, R, rot);

  // 车架：后轴—中轴—座—把—前轴，一条折线加一根上管
  c.strokeStyle = '#fa5151';
  c.lineWidth = Math.max(3, R * 0.12);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(rearX, hubY);
  c.lineTo(crankX, crankY);
  c.lineTo(seatX, seatY);
  c.lineTo(barX, barY);
  c.lineTo(frontX, hubY);
  c.moveTo(seatX, seatY);
  c.lineTo(barX, barY);
  c.stroke();
  // 座与把手
  c.strokeStyle = '#4c4c4c';
  c.lineWidth = Math.max(3, R * 0.14);
  c.beginPath();
  c.moveTo(seatX - R * 0.3, seatY);
  c.lineTo(seatX + R * 0.25, seatY);
  c.moveTo(barX, barY);
  c.lineTo(barX + R * 0.3, barY - R * 0.15);
  c.stroke();

  // 脚踏：两只交替上下——曲柄转角直接用轮转角（齿比 1:1，示例不较真）
  const pedalA = [
    { x: crankX + CR * Math.cos(rot), y: crankY + CR * Math.sin(rot) },
    { x: crankX + CR * Math.cos(rot + Math.PI), y: crankY + CR * Math.sin(rot + Math.PI) },
  ];
  c.strokeStyle = '#4c4c4c';
  c.lineWidth = Math.max(3, R * 0.12);
  c.beginPath();
  c.arc(crankX, crankY, R * 0.14, 0, Math.PI * 2);
  c.moveTo(crankX, crankY);
  c.lineTo(pedalA[0].x, pedalA[0].y);
  c.moveTo(crankX, crankY);
  c.lineTo(pedalA[1].x, pedalA[1].y);
  c.stroke();

  paintPelican(c, seatX, seatY, R, crankX, crankY, pedalA, rot);
}

function paintWheel(c: Ctx, x: number, y: number, R: number, rot: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.strokeStyle = '#33383c';
  c.lineWidth = Math.max(3, R * 0.14);
  c.beginPath();
  c.arc(0, 0, R, 0, Math.PI * 2);
  c.stroke();
  // 辐条：跟着转，车轮转没转一眼看得出来（匀速圆周不画这个就看不出来）
  c.lineWidth = Math.max(1.5, R * 0.06);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    c.beginPath();
    c.moveTo(-R * 0.9 * Math.cos(a), -R * 0.9 * Math.sin(a));
    c.lineTo(R * 0.9 * Math.cos(a), R * 0.9 * Math.sin(a));
    c.stroke();
  }
  c.restore();
}

function paintPelican(
  c: Ctx,
  seatX: number,
  seatY: number,
  R: number,
  crankX: number,
  crankY: number,
  pedals: { x: number; y: number }[],
  rot: number,
): void {
  const bodyX = seatX + R * 0.35;
  const bodyY = seatY - R * 0.9;
  const bodyRx = R * 1.25;
  const bodyRy = R * 0.8;
  const hipX = bodyX - R * 0.2;
  const hipY = bodyY + bodyRy * 0.7;
  const headX = bodyX + R * 1.15;
  const headY = bodyY - R * 1.75;

  // 腿：髋→脚两点连杆，膝用二次曲线往前提一点弯，跟着曲柄交替蹬
  c.strokeStyle = '#ff9f0a';
  c.lineWidth = Math.max(3.5, R * 0.16);
  for (const pedal of pedals) {
    const midX = (hipX + pedal.x) / 2 + R * 0.28;
    const midY = (hipY + pedal.y) / 2;
    c.beginPath();
    c.moveTo(hipX, hipY);
    c.quadraticCurveTo(midX, midY, pedal.x, pedal.y);
    c.stroke();
    c.fillStyle = '#ff9f0a';
    c.beginPath();
    c.arc(pedal.x, pedal.y, R * 0.13, 0, Math.PI * 2);
    c.fill();
  }

  // 身体：椭圆 + 收拢的翅膀（翅尖随蹬踏节奏小幅摆，幅度给小，大了像扇）
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#d9d9d9';
  c.lineWidth = Math.max(2, R * 0.08);
  c.beginPath();
  c.ellipse(bodyX, bodyY, bodyRx, bodyRy, -0.12, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.save();
  c.translate(bodyX - R * 0.15, bodyY);
  c.rotate(Math.sin(rot * 2) * 0.12);
  c.fillStyle = '#f1f2f6';
  c.beginPath();
  c.ellipse(-R * 0.2, R * 0.1, bodyRx * 0.6, bodyRy * 0.5, 0.25, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // 尾羽
  c.fillStyle = '#f1f2f6';
  c.beginPath();
  c.moveTo(bodyX - bodyRx * 0.9, bodyY - R * 0.15);
  c.lineTo(bodyX - bodyRx * 1.7, bodyY - R * 0.55);
  c.lineTo(bodyX - bodyRx * 1.6, bodyY + R * 0.35);
  c.closePath();
  c.fill();

  // 脖子：身体前上方向前上抬到头
  c.strokeStyle = '#ffffff';
  c.lineWidth = Math.max(6, R * 0.34);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(bodyX + bodyRx * 0.55, bodyY - bodyRy * 0.35);
  c.quadraticCurveTo(bodyX + R * 1.5, bodyY - R * 1.1, headX, headY);
  c.stroke();

  // 头 + 一眼
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(headX, headY, R * 0.45, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#33383c';
  c.beginPath();
  c.arc(headX + R * 0.16, headY - R * 0.1, R * 0.08, 0, Math.PI * 2);
  c.fill();

  // 长喙：鹈鹕的辨识度全在这——上下两片，叼着摆尾的鱼
  const beakTipX = headX + R * 1.6;
  const beakTipY = headY + R * 0.55;
  c.fillStyle = '#ffb142';
  c.beginPath();
  c.moveTo(headX + R * 0.2, headY + R * 0.05);
  c.lineTo(beakTipX, beakTipY);
  c.lineTo(headX + R * 0.25, headY + R * 0.42);
  c.closePath();
  c.fill();
  c.fillStyle = '#ff9f0a';
  c.beginPath();
  c.moveTo(headX + R * 0.2, headY + R * 0.12);
  c.quadraticCurveTo(headX + R * 1.0, beakTipY + R * 0.4, beakTipX, beakTipY);
  c.lineTo(headX + R * 0.25, headY + R * 0.42);
  c.closePath();
  c.fill();

  // 鱼：尾鳍用 sin 摆，骑得越快摆得越快（rot 里已经含速度）
  c.save();
  c.translate(beakTipX - R * 0.45, beakTipY + R * 0.1);
  c.rotate(Math.sin(rot * 3) * 0.35);
  c.fillStyle = '#54a0ff';
  c.beginPath();
  c.ellipse(0, 0, R * 0.42, R * 0.17, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(-R * 0.36, 0);
  c.lineTo(-R * 0.68, -R * 0.2);
  c.lineTo(-R * 0.68, R * 0.2);
  c.closePath();
  c.fill();
  c.restore();
}
</script>

<template>
  <Panel title="鹈鹕骑行" desc="零依赖：路径手绘 + requestAnimationFrame，一份代码两端同帧">
    <canvas ref="cv" class="cv" @resize="onResize" @tap="onTap" />
    <text class="tip">点画布切换速度 · 当前 ×{{ speed }}</text>
  </Panel>
</template>

<style scoped>
.cv {
  width: 100%;
  height: 200px;
  border-radius: 8px;
  /* 手势自己吃，别让外层 scroll-view 抢走 tap（canvas-compat §9） */
  touch-action: none;
}
.tip {
  font-size: 12px;
  color: var(--fjs-faint);
  text-align: center;
}
</style>
