<route>
{"title": "俄罗斯方块", "scroll": false, "tabBar": false, "group": "交互游戏", "desc": "canvas 逐帧重画，十字键控制；全屏页不显示 tabBar（specs/210）"}
</route>

<script setup lang="ts">
// 俄罗斯方块：棋盘和预览都画在 <canvas> 里，操作走页面自己的十字键。
//
// 两件事和 2048 那页不一样，都是 canvas 带来的：
//
// 1. **不是每帧都重画**。rAF 一直跑（重力要计时），但只有状态真的变了才
//    `paint()`，画之前先 `clearRect(0, 0, w, h)` 整块清 —— 整块清是宿主丢弃
//    旧显示列表的信号，局部清会让命令一帧帧堆下去（docs/canvas-compat.md §10）。
// 2. **格子尺寸在 `@resize` 里算**。App 侧 canvas 要等宿主布局完才有尺寸，
//    onMounted 时 width/height 还是 0；两端 @resize 载荷一样，所以这一份
//    代码两端都对。
//
// 十字键按住会连发：先等 DAS 再按 ARR 的节奏重复，和掌机手感对齐；旋转不连发。
import { onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import type { FjsCanvasApi, FjsCanvasContext2D } from 'fjs';

const COLS = 10;
const ROWS = 20;

/** 按住多久开始连发，以及连发间隔（毫秒）。 */
const DAS = 170;
const ARR = 55;
/** 整行消除的闪白时长。 */
const FLASH_MS = 160;

type Kind = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';
type Cell = Kind | '';
type Matrix = number[][];

const SHAPES: Record<Kind, Matrix> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
};

const COLORS: Record<Kind, string> = {
  I: '#31c7ef',
  J: '#4a63c8',
  L: '#ef7921',
  O: '#f7d308',
  S: '#3fbf4f',
  T: '#ad4d9c',
  Z: '#ef2029',
};

interface Piece {
  kind: Kind;
  cells: Matrix;
  x: number;
  y: number;
}

// ── 状态 ───────────────────────────────────────────────────────────────

const boardRef = ref<FjsCanvasApi>();
const nextRef = ref<FjsCanvasApi>();

const score = ref(0);
const lines = ref(0);
const level = ref(1);
const over = ref(false);
const paused = ref(false);
/** 当前按下的那个键，只用来给按钮上按下态。 */
const active = ref('');
// 最高分挂在模块上：离开页面再回来还在（这个 demo 不碰持久化存储）。
const best = ref(0);

const grid: Cell[][] = [];
let piece: Piece | null = null;
let nextKind: Kind = 'I';
let bag: Kind[] = [];

/** 正在闪白的那几行；非空时重力停住。 */
let flashing: number[] = [];
let flashLeft = 0;

/** 画布尺寸与格子边长，都在 @resize 里算好。 */
let cell = 0;
let ox = 0;
let oy = 0;

let fallLeft = 0;
let last = 0;
let raf = 0;
/** 状态变了才重画；rAF 本身一直跑，因为重力要计时。 */
let dirty = true;

const shapeOf = (kind: Kind): Matrix => SHAPES[kind].map((row) => [...row]);

function reset(): void {
  grid.length = 0;
  for (let r = 0; r < ROWS; r++) grid.push(Array<Cell>(COLS).fill(''));
  score.value = 0;
  lines.value = 0;
  level.value = 1;
  over.value = false;
  paused.value = false;
  flashing = [];
  bag = [];
  nextKind = draw();
  spawn();
  fallLeft = gravity();
  dirty = true;
}

/** 7-bag：一轮里七种各出一次，不会连着来五个 S。 */
function draw(): Kind {
  if (!bag.length) {
    bag = (Object.keys(SHAPES) as Kind[]).slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop()!;
}

/** 每级快一点，最快 90ms 一格。 */
const gravity = () => Math.max(90, 800 - (level.value - 1) * 70);

function spawn(): void {
  const kind = nextKind;
  nextKind = draw();
  const cells = shapeOf(kind);
  // 矩阵顶上可能有空行（I 和 3×3 的那几个），把它抵消掉，方块才是贴着顶出来的
  let top = 0;
  while (top < cells.length && cells[top].every((v) => !v)) top++;
  const next: Piece = {
    kind,
    cells,
    x: Math.floor((COLS - cells.length) / 2),
    y: -top,
  };
  if (hits(next, 0, 0)) {
    piece = null;
    over.value = true;
    if (score.value > best.value) best.value = score.value;
  } else {
    piece = next;
  }
}

/** p 整体位移 (dx, dy) 之后是否撞墙或撞到已固定的块。 */
function hits(p: Piece, dx: number, dy: number, cells = p.cells): boolean {
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      if (!cells[r][c]) continue;
      const x = p.x + c + dx;
      const y = p.y + r + dy;
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      // 顶部露在外面的那几格不算撞：新方块要能从画面上方落进来
      if (y >= 0 && grid[y][x]) return true;
    }
  }
  return false;
}

// ── 操作 ───────────────────────────────────────────────────────────────

function move(dx: number): void {
  if (!playable() || !piece || hits(piece, dx, 0)) return;
  piece.x += dx;
  dirty = true;
}

function rotate(): void {
  if (!playable() || !piece) return;
  const n = piece.cells.length;
  const turned = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => piece!.cells[n - 1 - c][r]),
  );
  // 简单踢墙：原地不行就往左右各挪一两格试试，贴边和贴 I 都靠这个
  for (const dx of [0, -1, 1, -2, 2]) {
    if (!hits(piece, dx, 0, turned)) {
      piece.cells = turned;
      piece.x += dx;
      dirty = true;
      return;
    }
  }
}

/** 软降：手动落一格，落一格加一分。 */
function softDrop(): void {
  if (!playable() || !piece) return;
  if (hits(piece, 0, 1)) {
    lock();
  } else {
    piece.y += 1;
    score.value += 1;
  }
  fallLeft = gravity();
  dirty = true;
}

/** 硬降：直落到底并立刻固定，每格两分。 */
function hardDrop(): void {
  if (!playable() || !piece) return;
  let n = 0;
  while (!hits(piece, 0, 1)) {
    piece.y += 1;
    n++;
  }
  score.value += n * 2;
  lock();
  fallLeft = gravity();
  dirty = true;
}

/** 落地：写进棋盘，找满行，没满行就直接出下一个。 */
function lock(): void {
  if (!piece) return;
  const p = piece;
  for (let r = 0; r < p.cells.length; r++) {
    for (let c = 0; c < p.cells[r].length; c++) {
      if (!p.cells[r][c]) continue;
      const y = p.y + r;
      if (y >= 0) grid[y][p.x + c] = p.kind;
    }
  }
  piece = null;

  const full: number[] = [];
  for (let r = 0; r < ROWS; r++) if (grid[r].every((v) => v)) full.push(r);
  if (full.length) {
    flashing = full;
    flashLeft = FLASH_MS;
  } else {
    spawn();
  }
  dirty = true;
}

/** 闪白播完：删掉那几行，上面的整体落下来，然后结算。 */
function collapse(): void {
  const rows = flashing;
  flashing = [];
  for (const r of rows) grid.splice(r, 1);
  for (let i = 0; i < rows.length; i++) grid.unshift(Array<Cell>(COLS).fill(''));
  score.value += [0, 100, 300, 500, 800][rows.length] * level.value;
  lines.value += rows.length;
  level.value = Math.floor(lines.value / 10) + 1;
  spawn();
  fallLeft = gravity();
  dirty = true;
}

const playable = () => !over.value && !paused.value && !flashing.length;

function restart(): void {
  reset();
}

function togglePause(): void {
  if (over.value) return;
  paused.value = !paused.value;
  dirty = true;
}

// ── 十字键 ─────────────────────────────────────────────────────────────

let holdTimer: ReturnType<typeof setTimeout> | null = null;
let repeatTimer: ReturnType<typeof setInterval> | null = null;

/** 按下就先走一步，按住超过 DAS 再按 ARR 连发；旋转传 repeat=false。 */
function press(key: string, fire: () => void, repeat = true): void {
  release();
  active.value = key;
  fire();
  if (!repeat) return;
  holdTimer = setTimeout(() => {
    repeatTimer = setInterval(fire, ARR);
  }, DAS);
}

function release(): void {
  if (holdTimer) clearTimeout(holdTimer);
  if (repeatTimer) clearInterval(repeatTimer);
  holdTimer = null;
  repeatTimer = null;
  active.value = '';
}

// ── 循环 ───────────────────────────────────────────────────────────────

function tick(now: number): void {
  raf = requestAnimationFrame(tick);
  const dt = last ? Math.min(now - last, 100) : 16;
  last = now;

  if (flashing.length) {
    flashLeft -= dt;
    if (flashLeft <= 0) collapse();
    dirty = true;
  } else if (playable() && piece) {
    fallLeft -= dt;
    if (fallLeft <= 0) {
      fallLeft = gravity();
      if (hits(piece, 0, 1)) lock();
      else piece.y += 1;
      dirty = true;
    }
  }

  if (dirty) paint();
}

// 在 setup 里就把棋盘建好：@resize 可能早于 onMounted 派进来，那时 paint()
// 已经要读 grid 了。
reset();

function start(): void {
  if (raf) return;
  last = 0;
  raf = requestAnimationFrame(tick);
}

function stop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  release();
}

onMounted(start);
onUnmounted(stop);
// 路由是 keep-alive 的：翻到别的页面就把帧回调停掉，别在后台空转
onActivated(start);
onDeactivated(stop);

// ── 绘制 ───────────────────────────────────────────────────────────────

/** 尺寸变了重新算格子边长：整数边长 + 居中偏移，格线才不会糊。 */
function onResize(): void {
  const cv = boardRef.value;
  if (!cv) return;
  cell = Math.floor(Math.min(cv.width / COLS, cv.height / ROWS));
  ox = Math.floor((cv.width - cell * COLS) / 2);
  oy = Math.floor((cv.height - cell * ROWS) / 2);
  dirty = true;
  paint();
}

/** 一块砖：底色 + 左上高光 + 右下暗边，比纯色块立体一点。 */
function brick(ctx: FjsCanvasContext2D, x: number, y: number, size: number, color: string, alpha = 1): void {
  const pad = Math.max(1, Math.round(size * 0.06));
  const s = size - pad * 2;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x + pad, y + pad, s, s);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.fillRect(x + pad, y + pad, s, Math.max(1, Math.round(s * 0.16)));
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(x + pad, y + pad + s - Math.max(1, Math.round(s * 0.16)), s, Math.max(1, Math.round(s * 0.16)));
  ctx.globalAlpha = 1;
}

function paint(): void {
  const cv = boardRef.value;
  const ctx = cv?.getContext('2d');
  if (!ctx || !cv || !cell) return;
  dirty = false;

  const w = cell * COLS;
  const h = cell * ROWS;
  // 整块清：既是「这一帧重画」的常规写法，也是宿主丢弃旧显示列表的信号
  ctx.clearRect(0, 0, cv.width, cv.height);

  ctx.fillStyle = '#12141c';
  ctx.fillRect(ox, oy, w, h);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < COLS; c++) {
    ctx.moveTo(ox + c * cell + 0.5, oy);
    ctx.lineTo(ox + c * cell + 0.5, oy + h);
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.moveTo(ox, oy + r * cell + 0.5);
    ctx.lineTo(ox + w, oy + r * cell + 0.5);
  }
  ctx.stroke();

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const kind = grid[r][c];
      if (kind) brick(ctx, ox + c * cell, oy + r * cell, cell, COLORS[kind]);
    }
  }

  // 落点提示：当前方块直落到底的位置，半透明描个影子
  if (piece && playable()) {
    let drop = 0;
    while (!hits(piece, 0, drop + 1)) drop++;
    if (drop > 0) {
      ctx.fillStyle = COLORS[piece.kind];
      for (let r = 0; r < piece.cells.length; r++) {
        for (let c = 0; c < piece.cells[r].length; c++) {
          if (!piece.cells[r][c]) continue;
          const y = piece.y + r + drop;
          if (y < 0) continue;
          ctx.globalAlpha = 0.18;
          ctx.fillRect(ox + (piece.x + c) * cell + 1, oy + y * cell + 1, cell - 2, cell - 2);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  if (piece) {
    for (let r = 0; r < piece.cells.length; r++) {
      for (let c = 0; c < piece.cells[r].length; c++) {
        if (!piece.cells[r][c]) continue;
        const y = piece.y + r;
        if (y < 0) continue;
        brick(ctx, ox + (piece.x + c) * cell, oy + y * cell, cell, COLORS[piece.kind]);
      }
    }
  }

  // 消行闪白：亮度按剩余时间退，退完 collapse() 才真的删行
  if (flashing.length) {
    ctx.fillStyle = `rgba(255, 255, 255, ${(flashLeft / FLASH_MS) * 0.85})`;
    for (const r of flashing) ctx.fillRect(ox, oy + r * cell, w, cell);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, w - 1, h - 1);

  paintNext();
}

function paintNext(): void {
  const cv = nextRef.value;
  const ctx = cv?.getContext('2d');
  if (!ctx || !cv || !cv.width) return;
  ctx.clearRect(0, 0, cv.width, cv.height);

  const cells = SHAPES[nextKind];
  // 只按真正有砖的那几行几列居中，I 和 O 才不会偏在角上
  let minR = cells.length;
  let maxR = -1;
  let minC = cells.length;
  let maxC = -1;
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      if (!cells[r][c]) continue;
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
    }
  }
  const cw = maxC - minC + 1;
  const ch = maxR - minR + 1;
  const size = Math.floor(Math.min(cv.width / 4.4, cv.height / 2.6));
  const left = Math.round((cv.width - cw * size) / 2);
  const top = Math.round((cv.height - ch * size) / 2);
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (!cells[r][c]) continue;
      brick(ctx, left + (c - minC) * size, top + (r - minR) * size, size, COLORS[nextKind]);
    }
  }
}
</script>

<template>
  <view class="page">
    <view class="hud">
      <view class="stats">
        <view class="stat">
          <text class="k">分数</text>
          <text class="v">{{ score }}</text>
        </view>
        <view class="stat">
          <text class="k">消行</text>
          <text class="v">{{ lines }}</text>
        </view>
        <view class="stat">
          <text class="k">等级</text>
          <text class="v">{{ level }}</text>
        </view>
      </view>
      <view class="next">
        <text class="k">下一个</text>
        <canvas ref="nextRef" class="next-cv" @resize="paintNext" />
      </view>
    </view>

    <view class="stage">
      <!-- 棋盘和预览是两张画布：预览只在换块时重画，不跟着棋盘每帧走 -->
      <canvas ref="boardRef" class="board" @resize="onResize" />
      <view v-if="over || paused" class="mask">
        <text class="mask-title">{{ over ? '游戏结束' : '暂停中' }}</text>
        <text v-if="over" class="mask-sub">得分 {{ score }} · 最高 {{ best }}</text>
      </view>
    </view>

    <view class="pad">
      <!-- 十字键：中间那格空着，纯粹是十字的轴心 -->
      <view class="cross">
        <view class="row">
          <view class="hole" />
          <view
            class="key"
            :class="{ on: active === 'up' }"
            @touchstart="press('up', rotate, false)"
            @touchend="release()"
            @touchcancel="release()"
          >
            <text class="glyph">⟳</text>
          </view>
          <view class="hole" />
        </view>
        <view class="row">
          <view
            class="key"
            :class="{ on: active === 'left' }"
            @touchstart="press('left', () => move(-1))"
            @touchend="release()"
            @touchcancel="release()"
          >
            <text class="glyph">◀</text>
          </view>
          <view class="axis" />
          <view
            class="key"
            :class="{ on: active === 'right' }"
            @touchstart="press('right', () => move(1))"
            @touchend="release()"
            @touchcancel="release()"
          >
            <text class="glyph">▶</text>
          </view>
        </view>
        <view class="row">
          <view class="hole" />
          <view
            class="key"
            :class="{ on: active === 'down' }"
            @touchstart="press('down', softDrop)"
            @touchend="release()"
            @touchcancel="release()"
          >
            <text class="glyph">▼</text>
          </view>
          <view class="hole" />
        </view>
      </view>

      <view class="side">
        <view
          class="drop"
          :class="{ on: active === 'drop' }"
          @touchstart="press('drop', hardDrop, false)"
          @touchend="release()"
          @touchcancel="release()"
        >
          <text class="drop-text">硬降</text>
        </view>
        <view class="side-row">
          <button class="btn" @tap="togglePause()">{{ paused ? '继续' : '暂停' }}</button>
          <button class="btn ghost" @tap="restart()">重开</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  width: 100%;
  height: 100%;
  padding: 12px 16px 16px;
  background-color: #0b0d13;
}
.hud {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.stats {
  flex-grow: 1;
  flex-direction: row;
  gap: 8px;
}
.stat {
  flex-grow: 1;
  padding: 6px 0;
  align-items: center;
  border-radius: 8px;
  background-color: #171a24;
}
.k {
  font-size: 11px;
  color: #7b8296;
}
.v {
  margin-top: 2px;
  font-size: 17px;
  font-weight: 700;
  color: #e8ebf2;
}
.next {
  width: 84px;
  padding: 6px 0 4px;
  align-items: center;
  border-radius: 8px;
  background-color: #171a24;
}
.next-cv {
  margin-top: 2px;
  width: 72px;
  height: 34px;
}
.stage {
  position: relative;
  flex-grow: 1;
  margin-top: 12px;
}
.board {
  width: 100%;
  height: 100%;
  /* 画布自己吃触摸：留着以后在棋盘上加手势，也不会被外层滚动抢走 */
  touch-action: none;
}
.mask {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background-color: rgba(11, 13, 19, 0.78);
}
.mask-title {
  font-size: 22px;
  font-weight: 700;
  color: #e8ebf2;
}
.mask-sub {
  font-size: 13px;
  color: #8a91a6;
}
.pad {
  margin-top: 14px;
  flex-direction: row;
  align-items: center;
  gap: 16px;
}
.cross {
  width: 168px;
}
.row {
  flex-direction: row;
}
.key,
.hole,
.axis {
  width: 56px;
  height: 52px;
}
.key {
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background-color: #232838;
}
/* 按下态照 WeUI：变深一档，不做位移动画 */
.key.on {
  background-color: #171b27;
}
.axis {
  background-color: #232838;
}
.glyph {
  font-size: 20px;
  color: #cfd5e4;
}
.side {
  flex-grow: 1;
  gap: 10px;
}
.drop {
  height: 62px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background-color: #2f6df6;
}
.drop.on {
  background-color: #2459c8;
}
.drop-text {
  font-size: 17px;
  font-weight: 700;
  color: #ffffff;
}
.side-row {
  flex-direction: row;
  gap: 10px;
}
.btn {
  flex-grow: 1;
  padding: 8px 0;
  border-radius: 8px;
  background-color: #232838;
  color: #cfd5e4;
  font-size: 14px;
}
.ghost {
  background-color: #171a24;
  color: #8a91a6;
}
</style>
