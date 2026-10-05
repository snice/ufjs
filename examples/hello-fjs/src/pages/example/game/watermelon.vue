<route>
{"title": "合成大西瓜", "scroll": false, "tabBar": false, "group": "交互游戏", "desc": "canvas 2d + 手写圆形刚体，两个一样的水果碰到就合成更大的；全屏页不显示 tabBar（specs/210）"}
</route>

<script setup lang="ts">
// 合成大西瓜：参考 bullhe4d/bigwatermelon（Cocos Creator 构建产物），素材从它的
// 图集里按 SpriteFrame 的 rect 切成单图放在 public/wm/。
//
// - f0..f10：11 级水果（葡萄 → 大西瓜），贴图尺寸就是碰撞直径
// - s / p / d：合成时的果汁溅斑、果肉碎块、汁滴，按水果等级各一套
//
// 原版物理用 Box2D，这里换成几十行的圆形刚体：冲量解碰撞（带摩擦和转动，
// 水果会滚），再按穿透深度做位置修正；每帧拆成若干子步，堆高了也不抖。
//
// **世界坐标**：宽固定 720（原版设计宽度），高随画布；缩放 k 取宽、高两者里
// 更紧的那个，画布太宽时左右留边、玩法区居中。
import { onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import { loadCanvasImage } from 'fjs';
import type { FjsCanvasApi, FjsCanvasContext2D, FjsCanvasImage, FjsTouchEvent } from 'fjs';

// ── 数值 ───────────────────────────────────────────────────────────────

const WORLD_W = 720;
/** 世界至少要这么高，更矮的画布按高度缩放。 */
const MIN_WORLD_H = 1100;
const TABLE_H = 127;

/** 每级水果的直径（原版 SpriteFrame 的 originalSize）。 */
const SIZES = [52, 80, 108, 119, 152, 183, 193, 258, 308, 308, 408];
const MAX_LEVEL = SIZES.length - 1;

const SPAWN_Y = 170;
const DEAD_LINE_Y = 250;

const GRAVITY = 2600;
const DROP_V = 700;
const RESTITUTION = 0.15;
const FRICTION = 0.35;
const SUBSTEPS = 6;

/** 前 6 个水果是固定的，之后在最小的 5 级里随机。 */
const OPENING = [0, 0, 1, 2, 2, 3];

type Phase = 'playing' | 'ending' | 'over';

interface Fruit {
  level: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  w: number;
  /** 出生缩放动画的时钟，0.5s 走完。 */
  grow: number;
  /** 碰过东西（落稳）后开始计时，超过 3s 还顶在线上才算输。 */
  settled: number;
  touched: boolean;
  /** 合成中：飞向另一个水果，不再参与碰撞。 */
  mergeTo: Fruit | null;
  mergeClock: number;
  /** 结束时闪红的那个。 */
  blink: boolean;
}

interface Particle {
  img: FjsCanvasImage;
  /** 溅斑画在水果下面，碎块和汁滴画在上面。 */
  splat: boolean;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** 飞出去用的时间。 */
  move: number;
  scale0: number;
  scale1: number;
  spin: number;
  angle: number;
  w: number;
  h: number;
  age: number;
  life: number;
  fade: number;
}

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  color: string;
}

// ── 素材 ───────────────────────────────────────────────────────────────

const images: Record<string, FjsCanvasImage> = {};
const loaded = ref(false);
const failed = ref('');
{
  const names = ['table', 'line'];
  for (let i = 0; i <= MAX_LEVEL; i++) names.push(`f${i}`);
  for (let i = 0; i < MAX_LEVEL; i++) names.push(`s${i}`, `p${i}`, `d${i}`);
  let left = names.length;
  for (const name of names) {
    images[name] = loadCanvasImage(
      `/wm/${name}.png`,
      () => {
        if (--left === 0) loaded.value = true;
      },
      (message) => {
        failed.value = `/wm/${name}.png: ${message}`;
      },
    );
  }
}

// ── 状态 ───────────────────────────────────────────────────────────────

const cv = ref<FjsCanvasApi>();

let phase: Phase = 'playing';
let score = 0;
// 挂在模块上：离开页面再回来还在（demo 不碰持久化存储）
let best = 0;

let fruits: Fruit[] = [];
let particles: Particle[] = [];
let confetti: Confetti[] = [];

/** 手里拿着、还没松手的水果。 */
let held: { level: number; x: number; fromX: number; toX: number; slide: number; grow: number } | null = null;
let dropCount = 0;
/** 松手后隔一会儿才出下一个。 */
let nextIn = 0;

/** 合出大西瓜的庆祝动画，0 表示没在放。 */
let bigClock = 0;
let endClock = 0;
let popQueue: Fruit[] = [];
let popClock = 0;
let lineBlink = 0;
/** 上一次松手的位置，下一个水果从这里出来。 */
let lastX = WORLD_W / 2;

let k = 0;
let worldH = 0;
/** 世界原点在画布上的横向偏移（画布比 720 宽时居中）。 */
let originX = 0;
let floorY = 0;

let raf = 0;
let last = 0;

function reset(): void {
  phase = 'playing';
  score = 0;
  fruits = [];
  particles = [];
  confetti = [];
  held = null;
  dropCount = 0;
  nextIn = 0.1;
  bigClock = 0;
  endClock = 0;
  popQueue = [];
  popClock = 0;
}
reset();

const radius = (level: number): number => SIZES[level] / 2;

function randomNext(): number {
  return dropCount < OPENING.length ? OPENING[dropCount] : Math.floor(Math.random() * 5);
}

function spawnHeld(): void {
  const level = randomNext();
  const r = radius(level);
  const cx = Math.max(r, Math.min(WORLD_W - r, lastX));
  held = { level, x: cx, fromX: cx, toX: cx, slide: 1, grow: 0 };
}

function makeFruit(level: number, x: number, y: number, vy: number): Fruit {
  return {
    level,
    x,
    y,
    vx: 0,
    vy,
    angle: 0,
    w: 0,
    grow: 0,
    settled: 0,
    touched: false,
    mergeTo: null,
    mergeClock: 0,
    blink: false,
  };
}

// ── 输入 ───────────────────────────────────────────────────────────────

function toWorldX(e: FjsTouchEvent): number | null {
  const t = e.changedTouches[0] ?? e.touches[0];
  return t ? t.offsetX / k - originX : null;
}

function toWorldY(e: FjsTouchEvent): number | null {
  const t = e.changedTouches[0] ?? e.touches[0];
  return t ? t.offsetY / k : null;
}

/** 拿着的水果能不能动：长出来了、没在放大西瓜动画。 */
const canAim = (): boolean => phase === 'playing' && !!held && held.grow >= 0.5 && bigClock === 0;

function clampHeld(x: number): number {
  const r = radius(held!.level);
  return Math.max(r, Math.min(WORLD_W - r, x));
}

function onTouchStart(e: FjsTouchEvent): void {
  if (!loaded.value || !k) return;
  if (phase === 'over') {
    const x = toWorldX(e);
    const y = toWorldY(e);
    const b = buttonRect();
    if (x !== null && y !== null && endClock > 0.6 && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      reset();
    }
    return;
  }
  if (!canAim()) return;
  const x = toWorldX(e);
  if (x === null) return;
  // 按下时水果滑过去（0.1s），而不是瞬移
  held!.fromX = held!.x;
  held!.toX = clampHeld(x);
  held!.slide = 0;
}

function onTouchMove(e: FjsTouchEvent): void {
  if (!canAim()) return;
  const x = toWorldX(e);
  if (x === null) return;
  held!.toX = clampHeld(x);
  held!.x = held!.toX;
  held!.slide = 1;
}

function onTouchEnd(): void {
  if (!canAim()) return;
  const h = held!;
  fruits.push(makeFruit(h.level, h.toX, SPAWN_Y, DROP_V));
  fruits[fruits.length - 1].grow = 0.5;
  lastX = h.toX;
  held = null;
  dropCount++;
  nextIn = 0.5;
}

// ── 物理 ───────────────────────────────────────────────────────────────

/** 圆撞静态面：n 从墙指向水果，pen 是穿透深度。 */
function hitWall(f: Fruit, nx: number, ny: number, pen: number): void {
  const r = bodyRadius(f);
  f.x += nx * pen;
  f.y += ny * pen;
  const vn = f.vx * nx + f.vy * ny;
  if (vn >= 0) return;
  const jn = -(1 + RESTITUTION) * vn;
  f.vx += jn * nx;
  f.vy += jn * ny;
  // 切向：接触点速度 = v + ω × (−r·n)，摩擦冲量顺带把水果搓转
  const tx = -ny;
  const ty = nx;
  const vt = f.vx * tx + f.vy * ty - f.w * r;
  let jt = -vt / 3;
  const limit = FRICTION * jn;
  jt = Math.max(-limit, Math.min(limit, jt));
  f.vx += jt * tx;
  f.vy += jt * ty;
  f.w -= (2 * jt) / r;
  f.touched = true;
}

/** 两个水果相撞；质量按面积算。 */
function hitPair(a: Fruit, b: Fruit): void {
  const ra = bodyRadius(a);
  const rb = bodyRadius(b);
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d2 = dx * dx + dy * dy;
  const sum = ra + rb;
  if (d2 >= sum * sum) return;

  if (a.level === b.level && a.level < MAX_LEVEL && a.grow >= 0.5 && b.grow >= 0.5 && phase === 'playing') {
    startMerge(a, b);
    return;
  }

  if (d2 < 1e-6) {
    dx = 0;
    dy = 1;
    d2 = 1;
  }
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const ima = 1 / (ra * ra);
  const imb = 1 / (rb * rb);
  const pen = sum - d;
  const share = pen / (ima + imb);
  a.x -= nx * share * ima;
  a.y -= ny * share * ima;
  b.x += nx * share * imb;
  b.y += ny * share * imb;
  a.touched = b.touched = true;

  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  const jn = (-(1 + RESTITUTION) * vn) / (ima + imb);
  a.vx -= jn * ima * nx;
  a.vy -= jn * ima * ny;
  b.vx += jn * imb * nx;
  b.vy += jn * imb * ny;

  const tx = -ny;
  const ty = nx;
  const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - b.w * rb - a.w * ra;
  let jt = -vt / (3 * (ima + imb));
  const limit = FRICTION * jn;
  jt = Math.max(-limit, Math.min(limit, jt));
  a.vx -= jt * ima * tx;
  a.vy -= jt * ima * ty;
  b.vx += jt * imb * tx;
  b.vy += jt * imb * ty;
  a.w -= (2 * jt * ima) / ra;
  b.w -= (2 * jt * imb) / rb;
}

/** 出生时从 0 长大，碰撞半径跟着涨，把周围的水果慢慢挤开。 */
function bodyRadius(f: Fruit): number {
  // 留个下限：半径 0 会让质量、转动惯量除零
  return Math.max(2, radius(f.level) * Math.min(1, backOut(Math.min(1, f.grow / 0.5))));
}

function step(dt: number): void {
  const live = fruits.filter((f) => !f.mergeTo);
  for (const f of live) {
    f.vy += GRAVITY * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.angle += f.w * dt;
    // 一点点阻尼，堆起来的水果能静下来
    f.vx *= 0.999;
    f.w *= 0.995;
  }
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (a.mergeTo) continue;
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (!b.mergeTo) hitPair(a, b);
        if (a.mergeTo) break;
      }
    }
    for (const f of live) {
      if (f.mergeTo) continue;
      const r = bodyRadius(f);
      if (f.x < r) hitWall(f, 1, 0, r - f.x);
      if (f.x > WORLD_W - r) hitWall(f, -1, 0, f.x - (WORLD_W - r));
      if (f.y > floorY - r) hitWall(f, 0, -1, f.y - (floorY - r));
    }
  }
}

// ── 合成 ───────────────────────────────────────────────────────────────

function startMerge(a: Fruit, b: Fruit): void {
  // 上面那个飞向下面那个，0.1s 后在下面那个的位置长出更大一级
  const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
  upper.mergeTo = lower;
  upper.mergeClock = 0;
  lower.mergeTo = lower;
  lower.mergeClock = 0;
}

function finishMerge(upper: Fruit, lower: Fruit): void {
  fruits = fruits.filter((f) => f !== upper && f !== lower);
  const level = lower.level;
  score += level + 1;
  juice(level, lower.x, lower.y, SIZES[level]);
  const next = makeFruit(level + 1, lower.x, lower.y, 100);
  fruits.push(next);
  if (level + 1 === MAX_LEVEL) celebrate();
}

function updateMerges(dt: number): void {
  for (const f of fruits) {
    if (!f.mergeTo || f.mergeTo === f) continue;
    const target = f.mergeTo;
    f.mergeClock += dt;
    const t = Math.min(1, f.mergeClock / 0.1);
    f.x += (target.x - f.x) * t;
    f.y += (target.y - f.y) * t;
    if (t >= 1) {
      finishMerge(f, target);
      return updateMerges(0);
    }
  }
}

// ── 特效 ───────────────────────────────────────────────────────────────

/** 原版 createFruitL：10 块果肉 + 20 滴果汁往外崩，底下一大滩溅斑。 */
function juice(level: number, x: number, y: number, size: number): void {
  const burst = (img: FjsCanvasImage, w: number, h: number, spin: boolean): Particle => {
    const a = Math.random() * Math.PI * 2;
    const dist = 30 * Math.random() + size / 2;
    const move = 0.5 * Math.random();
    return {
      img,
      splat: false,
      x,
      y,
      dx: Math.sin(a) * dist,
      dy: Math.cos(a) * dist,
      move,
      scale0: 0.5 * Math.random() + size / 100,
      scale1: 0.3,
      spin: spin ? ((Math.random() * 720 - 360) * Math.PI) / 180 : 0,
      angle: 0,
      w,
      h,
      age: 0,
      life: move + 0.5,
      fade: 0.1,
    };
  };
  const splat: Particle = {
    img: images[`s${level}`],
    splat: true,
    x,
    y,
    dx: 0,
    dy: 0,
    move: 0.2,
    scale0: 0,
    scale1: size / 150,
    spin: 0,
    angle: Math.random() * Math.PI * 2,
    w: 319,
    h: 292,
    age: 0,
    life: 0,
    fade: 1,
  };
  particles.push(splat);
  for (let i = 0; i < 10; i++) particles.push(burst(images[`p${level}`], 38, 40, true));
  for (let i = 0; i < 20; i++) particles.push(burst(images[`d${level}`], 24, 41, false));
}

function updateParticles(dt: number): void {
  for (const p of particles) p.age += dt;
  particles = particles.filter((p) => p.age < p.life + p.fade);
  for (const c of confetti) {
    c.vy += 900 * dt;
    c.vx *= 0.98;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.angle += c.spin * dt;
  }
  confetti = confetti.filter((c) => c.y < worldH + 40);
}

const CONFETTI_COLORS = ['#ffd84d', '#3ad05e', '#3a7bff', '#34d6e0', '#b37cff', '#ff5a5a'];

function celebrate(): void {
  bigClock = 0.0001;
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 400 + Math.random() * 900;
    confetti.push({
      x: WORLD_W / 2,
      y: worldH * 0.4,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 500,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 20,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    });
  }
}

// ── 更新 ───────────────────────────────────────────────────────────────

function update(dt: number): void {
  updateParticles(dt);

  if (phase === 'over') {
    endClock += dt;
    return;
  }

  if (phase === 'ending') {
    endClock += dt;
    // 先闪 3 下，再从上往下一个个爆掉算分
    if (endClock > 1.8) {
      popClock -= dt;
      while (popClock <= 0 && popQueue.length) {
        const f = popQueue.shift()!;
        fruits = fruits.filter((x) => x !== f);
        score += f.level + 1;
        juice(f.level, f.x, f.y, SIZES[f.level]);
        popClock += 0.1;
      }
      // 最后一个爆完再等 1.2s 出结算
      if (!popQueue.length && popClock < -1.2) {
        if (score > best) best = score;
        phase = 'over';
        endClock = 0;
      }
    }
    return;
  }

  if (bigClock > 0) {
    bigClock += dt;
    if (bigClock >= 3) {
      bigClock = 0;
      score += 100;
    }
  }

  if (held) {
    held.grow += dt;
    if (held.slide < 1) {
      held.slide = Math.min(1, held.slide + dt / 0.1);
      held.x = held.fromX + (held.toX - held.fromX) * held.slide;
    }
  } else {
    nextIn -= dt;
    if (nextIn <= 0) spawnHeld();
  }

  for (const f of fruits) f.grow += dt;
  const h = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) step(h);
  updateMerges(dt);

  let highest = Infinity;
  for (const f of fruits) {
    if (f.mergeTo) continue;
    if (f.touched) f.settled += dt;
    const top = f.y - radius(f.level);
    if (f.settled > 0.3) highest = Math.min(highest, top);
    if (f.settled > 3 && top < DEAD_LINE_Y) {
      gameOver(f);
      return;
    }
  }
  // 最高的水果离线不到 100 时，警戒线开始闪
  lineBlink = highest - DEAD_LINE_Y < 100 ? lineBlink + dt : 0;
}

function gameOver(culprit: Fruit): void {
  phase = 'ending';
  endClock = 0;
  culprit.blink = true;
  held = null;
  // 合成到一半的直接落定
  for (const f of fruits) f.mergeTo = null;
  popQueue = [...fruits].sort((a, b) => a.y - b.y);
  popClock = 0;
  bigClock = 0;
}

// ── 循环 ───────────────────────────────────────────────────────────────

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (loaded.value && k) update(dt);
  paint();
}

function startLoop(): void {
  if (raf) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}

function stopLoop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

onMounted(startLoop);
// 路由是 keep-alive 的：离开就停帧回调，回来再接上
onActivated(startLoop);
onDeactivated(stopLoop);
onUnmounted(stopLoop);

function onResize(): void {
  const instance = cv.value;
  if (!instance || !instance.width || !instance.height) return;
  k = Math.min(instance.width / WORLD_W, instance.height / MIN_WORLD_H);
  worldH = instance.height / k;
  originX = (instance.width / k - WORLD_W) / 2;
  const oldFloor = floorY;
  floorY = worldH - TABLE_H;
  // 画布变矮时把水果整体挪上去，免得埋进桌子
  if (oldFloor && floorY !== oldFloor) for (const f of fruits) f.y += floorY - oldFloor;
  startLoop();
}

// ── 绘制 ───────────────────────────────────────────────────────────────

function backOut(t: number): number {
  const s = 1.70158;
  const u = t - 1;
  return u * u * ((s + 1) * u + s) + 1;
}

function paint(): void {
  const instance = cv.value;
  const ctx = instance?.getContext('2d');
  if (!ctx || !instance || !k) return;

  ctx.clearRect(0, 0, instance.width, instance.height);
  ctx.fillStyle = '#f5d67e';
  ctx.fillRect(0, 0, instance.width, instance.height);

  ctx.save();
  ctx.scale(k, k);
  ctx.translate(originX, 0);
  ctx.fillStyle = '#ffe89d';
  ctx.fillRect(0, 0, WORLD_W, worldH);

  if (!loaded.value) {
    ctx.fillStyle = '#9a6a2f';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(failed.value ? '素材加载失败' : '加载中…', WORLD_W / 2, worldH / 2);
    ctx.restore();
    return;
  }

  ctx.drawImage(images.table, 0, floorY, WORLD_W, TABLE_H);
  paintParticles(ctx, true);
  paintDeadLine(ctx);
  for (const f of fruits) paintFruit(ctx, f);
  paintHeld(ctx);
  paintParticles(ctx, false);
  paintHud(ctx);
  paintCelebration(ctx);
  if (phase === 'over') paintOver(ctx);

  ctx.restore();
}

function paintFruit(ctx: FjsCanvasContext2D, f: Fruit): void {
  const size = SIZES[f.level] * backOut(Math.min(1, f.grow / 0.5));
  if (size <= 0) return;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle);
  ctx.drawImage(images[`f${f.level}`], -size / 2, -size / 2, size, size);
  ctx.restore();
  if (f.blink && phase === 'ending' && endClock < 1.8 && Math.floor(endClock / 0.3) % 2 === 0) {
    ctx.fillStyle = 'rgba(255, 40, 40, 0.55)';
    ctx.beginPath();
    ctx.arc(f.x, f.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintHeld(ctx: FjsCanvasContext2D): void {
  if (!held || phase !== 'playing') return;
  const t = Math.min(1, held.grow / 0.5);
  const size = SIZES[held.level] * backOut(t);
  if (size <= 0) return;
  ctx.drawImage(images[`f${held.level}`], held.x - size / 2, SPAWN_Y - size / 2, size, size);
}

function paintDeadLine(ctx: FjsCanvasContext2D): void {
  if (phase === 'playing' && lineBlink > 0 && Math.floor(lineBlink / 0.3) % 2 === 0) {
    ctx.drawImage(images.line, (WORLD_W - 711) / 2, DEAD_LINE_Y - 4, 711, 8);
  }
}

function paintParticles(ctx: FjsCanvasContext2D, splats: boolean): void {
  for (const p of particles) {
    if (p.splat !== splats) continue;
    const t = p.move > 0 ? Math.min(1, p.age / p.move) : 1;
    let alpha = 1;
    let scale: number;
    if (p.splat) {
      scale = p.scale0 + (p.scale1 - p.scale0) * t;
      alpha = Math.max(0, 1 - p.age / p.fade);
    } else {
      scale = p.scale0 + (p.scale1 - p.scale0) * Math.min(1, p.age / p.life);
      if (p.age > p.life) alpha = Math.max(0, 1 - (p.age - p.life) / p.fade);
    }
    const ease = 1 - (1 - t) ** 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x + p.dx * ease, p.y + p.dy * ease);
    ctx.rotate(p.angle + p.spin * Math.min(1, p.age / p.life));
    ctx.drawImage(p.img, (-p.w * scale) / 2, (-p.h * scale) / 2, p.w * scale, p.h * scale);
    ctx.restore();
  }
}

function outlinedText(ctx: FjsCanvasContext2D, text: string, x: number, y: number, size: number): void {
  ctx.font = `bold ${size}px sans-serif`;
  ctx.lineWidth = size / 6;
  ctx.strokeStyle = '#b8772c';
  ctx.fillStyle = '#ffffff';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function paintHud(ctx: FjsCanvasContext2D): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  outlinedText(ctx, String(score), 32, 28, 72);
  if (best > 0) {
    ctx.textAlign = 'right';
    outlinedText(ctx, `最高 ${best}`, WORLD_W - 32, 44, 34);
  }
}

function paintCelebration(ctx: FjsCanvasContext2D): void {
  if (bigClock > 0) {
    const t = bigClock;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * Math.min(1, t / 0.5) * (t > 2 ? 3 - t : 1)})`;
    ctx.fillRect(0, 0, WORLD_W, worldH);

    // 原版：从下面跳到中间（1s），停 1s，再缩着飞上去（1s）
    const cy = worldH * 0.45;
    let y: number;
    let s: number;
    if (t < 1) {
      y = cy + 300 * (1 - t) - Math.sin(t * Math.PI) * 300;
      s = t;
    } else if (t < 2) {
      y = cy;
      s = 1;
    } else {
      const u = t - 2;
      y = cy - u * worldH * 0.45;
      s = 1 - u;
    }
    const size = 408 * s;
    ctx.save();
    ctx.translate(WORLD_W / 2, y);
    ctx.rotate(t * 1.2);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.fillStyle = 'rgba(255, 236, 140, 0.35)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(size * 1.1, -size * 0.12);
      ctx.lineTo(size * 1.1, size * 0.12);
      ctx.fill();
    }
    ctx.restore();
    ctx.drawImage(images.f10, WORLD_W / 2 - size / 2, y - size / 2, size, size);
  }
  for (const c of confetti) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = c.color;
    ctx.fillRect(-10, -5, 20, 10);
    ctx.restore();
  }
}

function roundRect(ctx: FjsCanvasContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function panelRect(): { x: number; y: number; w: number; h: number } {
  const w = 560;
  const h = 460;
  return { x: (WORLD_W - w) / 2, y: worldH * 0.42 - h / 2, w, h };
}

function buttonRect(): { x: number; y: number; w: number; h: number } {
  const p = panelRect();
  const w = 320;
  const h = 100;
  return { x: (WORLD_W - w) / 2, y: p.y + p.h - h - 48, w, h };
}

function paintOver(ctx: FjsCanvasContext2D): void {
  const t = Math.min(1, endClock / 0.4);
  const ease = 1 - (1 - t) ** 3;
  ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * ease})`;
  ctx.fillRect(0, 0, WORLD_W, worldH);

  ctx.save();
  ctx.globalAlpha = ease;
  ctx.translate(0, (1 - ease) * 120);
  const p = panelRect();
  roundRect(ctx, p.x, p.y, p.w, p.h, 36);
  ctx.fillStyle = '#fff7de';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#e0a84a';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9a6a2f';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText('游戏结束', WORLD_W / 2, p.y + 70);
  ctx.fillStyle = '#e8781e';
  ctx.font = 'bold 110px sans-serif';
  ctx.fillText(String(score), WORLD_W / 2, p.y + 180);
  ctx.fillStyle = '#b08b5a';
  ctx.font = '34px sans-serif';
  ctx.fillText(score >= best ? '新纪录！' : `最高 ${best}`, WORLD_W / 2, p.y + 262);

  const b = buttonRect();
  roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
  ctx.fillStyle = '#3cb44b';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px sans-serif';
  ctx.fillText('再来一局', WORLD_W / 2, b.y + b.h / 2);
  ctx.restore();
}
</script>

<template>
  <view class="page">
    <canvas
      ref="cv"
      class="cv"
      @resize="onResize"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    />
  </view>
</template>

<style scoped>
.page {
  width: 100%;
  height: 100%;
  background-color: #ffe89d;
}
.cv {
  width: 100%;
  height: 100%;
  touch-action: none;
}
</style>
