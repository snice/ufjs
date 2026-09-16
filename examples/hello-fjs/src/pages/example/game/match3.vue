<route>
{"title": "消消乐 PixiJS", "scroll": false, "group": "交互游戏", "desc": "pixi.js 7 跑在 canvas webgl2 上，宝石全 Graphics 绘制"}
</route>

<script setup lang="ts">
// 消消乐：玩法参考 xiaozhu188/pixi-game-match3（pixi 7），实现是自写紧凑版
// （spec 058）。棋盘逻辑在 @/match3/model（纯函数），渲染交给 pixi.js ——
// 这是 three.js 之外第二个直接吃 @ufjs/webgl 命令流的第三方渲染库。
//
// 与 three-gltf.vue 相同的三件事，语义都从那边抄：
//   1. import 顺序：先 @/adapters/pixi/native-shims（原生宿主垫片，web 上 no-op），
//      再 @ufjs/webgl（注册 context 类型），再 pixi 本体。
//   2. context 自己 getContext，new Renderer({ context }) 传进去；
//      resolution 读 gl.canvas 的 buffer 比例（bufferRatio）。
//   3. canvas 标 defer-resize：首个 resize 报告等到页面转场结束才来，
//      那时 surface 已就绪，构造期的 getParameter 直接就是真值。
//      不要再加 ctx.ready() 轮询 —— 它在 Flutter 3.41 + iOS 26 模拟器上
//      会挂起整个 JS 线程（spec 058 实测；跳一跳页不轮询，一直正常）。
//
// 与 three-gltf.vue 不同的两件事：
//   - pixi 的 EventSystem 被有意绕过（垫片把它的 DOM 监听吞掉）：消消乐
//     只需要"触摸落在哪个格子"，页面用 offsetX/offsetY 除一下就是答案，
//     和 spine.vue 的 handleTouch 是同一个量级。
//   - 连续渲染（app.ticker 常驻），因为下落/消除动画是持续驱动；
//     keep-alive 离开时 app.stop() 兜底，不向后台发 GL 命令。
//
// 分数/连击/按钮都在画布外用 fjs 组件，不用 pixi Text —— 那会拉起
// document.fonts / TextMetrics 的 DOM 路径，垫片没有也不会去补。
import '@/adapters/pixi/native-shims';
import '@ufjs/webgl';
import { onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import {
  BaseTexture,
  Container,
  Graphics,
  GraphicsGeometry,
  Renderer,
  Resource,
  Texture,
  Ticker,
} from 'pixi.js';
import type { GLTexture, IRenderingContext } from 'pixi.js';
import { loadCanvasImage, type FjsCanvasApi, type FjsTouchEvent } from 'fjs';
import {
  collapse,
  createBoard,
  findClears,
  findMove,
  removeCells,
  shuffleBoard,
  swapCells,
} from '@/match3/model';
import type { Grid, Swap } from '@/match3/model';
import { RAIN, TILE_FILL, TILES, hexNum, planRain, starPoints } from '@/match3/tile';

defineOptions({ name: 'Match3Page' });

// 所有 Graphics 都走批渲染，不走 pixi 的 direct 路径。顶点数超过
// BATCHABLE_SIZE（默认 100）的 Graphics——棋盘底板、选中框——走
// Graphics._renderDirect，它用的 shader 缓存在 pixi 模块级 DEFAULT_SHADERS
// 里，uniform 同步函数也跟着它缓存一次、之后所有 Renderer 共用。同步函数
// 按生成那一刻的 program.uniformData 拼出来：iOS 上页面重进 / 热重载后
// 某个 Renderer 生成时 uniformData 缺项，translationMatrix 从此不再上传，
// 底板和选中框画不出来，宝石（批渲染）照常。批渲染的 shader 每个
// Renderer 各有一份，不受影响；本页 Graphics 最多几百个顶点，放宽上限
// 的开销可以忽略。
GraphicsGeometry.BATCHABLE_SIZE = 10000;

// pixi 的 Texture.WHITE 惰性 getter 会走 ADAPTER.createCanvas →
// document.createElement('canvas') —— 宿主上没有真 2d canvas，这条路必死。
// 这里把 getter 换成 1x1 白色图片纹理：白 PNG 经 loadCanvasImage 解码成
// FjsCanvasImage 句柄，上传走 texImage2DSource（spec 022 的图片句柄路径，
// spine 页同款、两端已验证）。web 上 loadCanvasImage 给的是 HTMLImageElement，
// 同一个 texImage2D 调用浏览器原生就收，所以两端走同一条路、不分支。
// Graphics 渲染用 WHITE 做基纹理采样，所以它必须能构造、能上传成纯白。
const WHITE_PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP4DwQACfsD/Wj6HMwAAAAASUVORK5CYII=';

class HandleImageResource extends Resource {
  constructor(private image: unknown) {
    // 尺寸必须经 super 传：Resource.valid 读的是 _width/_height，只覆盖
    // width/height getter 时 valid 恒为 false → BaseTexture 无效 →
    // GraphicsGeometry.validateBatching() 跳过所有图形，画布只剩 clear 色
    super(1, 1);
  }
  static test(_: unknown): boolean {
    // 不参与 autoDetect —— 只在下面手工构造 BaseTexture 时用
    return false;
  }
  upload(
    renderer: Renderer,
    _baseTexture: BaseTexture,
    _glTexture: GLTexture,
  ): boolean {
    const gl = renderer.gl as unknown as {
      TEXTURE_2D: number;
      RGBA: number;
      UNSIGNED_BYTE: number;
      texImage2D: (...args: unknown[]) => void;
    };
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.image,
    );
    return true;
  }
}

let whiteHandle: unknown = null;
let whiteReady = false;

// 用图片句柄版纹理替换 WHITE 的惰性 getter：首次访问（Renderer 构造）时
// 用已加载的句柄构造一次，之后缓存为普通属性。句柄未就绪就访问会被
// whiteReady 门挡住（见 onResize/maybeBoot）。
function installWhiteTexture(): void {
  Object.defineProperty(Texture, 'WHITE', {
    configurable: true,
    get() {
      const base = new BaseTexture(new HandleImageResource(whiteHandle));
      const texture = new Texture(base);
      Object.defineProperty(Texture, 'WHITE', {
        value: texture,
        configurable: true,
      });
      return texture;
    },
  });
}

onMounted(() => {
  const image = loadCanvasImage(
    WHITE_PNG,
    () => {
      whiteHandle = image;
      whiteReady = true;
      installWhiteTexture();
      // resize 可能早已来过并在这里等白图
      onResize();
    },
    (message) => {
      status.value = `白纹理加载失败：${message}`;
    },
  );
});

const ROWS = 8;
const COLS = 8;
const COLORS = 6;

const SWAP_MS = 140;
const POP_MS = 150;
const FALL_MS = 240;

// ── 状态 ───────────────────────────────────────────────────────────────

const cvRef = ref<FjsCanvasApi>();
const score = ref(0);
const best = ref(0);
/** 连锁进行中的当前连击数，0 表示不在连锁里。 */
const combo = ref(0);
const toast = ref('');
const status = ref('等待画布…');

const grid: Grid = createBoard(ROWS, COLS, COLORS, Math.random);
while (!findMove(grid)) shuffleBoard(grid, Math.random);

type Node = Container;
/** views[r][c] 是该格宝石的显示节点，与 grid 同步换位/置空。 */
const views: (Node | null)[][] = Array.from({ length: ROWS }, () =>
  Array<Node | null>(COLS).fill(null),
);

// 不用 Application：autoDetectRenderer 会把构造期的真实异常吞掉换成一句
// "Unable to auto-detect a suitable renderer"（spec 058 实测），直接 new
// Renderer 才能把桥上缺的东西暴露出来。ticker 也自己管，语义等价。
let renderer: Renderer | null = null;
let ticker: Ticker | null = null;
let stage: Container | null = null;
let layer: Container | null = null;
/** 宝石节点的父容器；与 boardBg/selMark 分开，重建宝石时不连带清掉它们。 */
let gems: Container | null = null;
let boardBg: Graphics | null = null;
let selMark: Graphics | null = null;
let booting = false;
let disposed = false;

/** 画布逻辑尺寸与格子边长，@resize 里算好。 */
let cell = 0;
let ox = 0;
let oy = 0;

/** busy = 动画/结算中，输入只更新选中，不触发交换。 */
let busy = false;
let selected: { r: number; c: number } | null = null;

// ── tween 小工具 ───────────────────────────────────────────────────────
// 只够这个页面用：数字插值 + 完成回调。不引 gsap（spec Non-goal）。

interface Tween {
  left: number;
  dur: number;
  step: (k: number) => void;
  ease: (x: number) => number;
  done?: () => void;
}

const tweens: Tween[] = [];

const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3;
// 雨落下落用：匀速快落、到点急停（参考视频的手感）
const easeLinear = (x: number): number => x;
// 盘外补充下落用：起步慢、落地快的重力感
const easeInQuad = (x: number): number => x * x;

function animate(
  dur: number,
  step: (k: number) => void,
  ease: (x: number) => number = easeOutCubic,
): Promise<void> {
  return new Promise((resolve) => {
    tweens.push({ left: dur, dur, step, ease, done: resolve });
  });
}

function tick(): void {
  if (!renderer || !stage) return;
  let dt = ticker!.deltaMS;
  if (dt > 100) dt = 100;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.left -= dt;
    const k = 1 - Math.max(tw.left, 0) / tw.dur;
    tw.step(tw.ease(Math.min(k, 1)));
    if (tw.left <= 0) {
      tweens.splice(i, 1);
      tw.done?.();
    }
  }
  renderer.render(stage);
}

/** 宝石节点从当前 xy 滑到 (r,c) 格中心。 */
function glideTo(node: Node, r: number, c: number, dur: number, fromY?: number): Promise<void> {
  const x0 = node.x;
  const y0 = fromY ?? node.y;
  const x1 = c * cell + cell / 2;
  const y1 = r * cell + cell / 2;
  if (x0 === x1 && y0 === y1) return Promise.resolve();
  return animate(dur, (k) => {
    node.x = x0 + (x1 - x0) * k;
    node.y = y0 + (y1 - y0) * k;
  });
}

// ── 宝石绘制 ───────────────────────────────────────────────────────────

// 参考图的糖果贴片（spec 064）：深色外圈 → 本色内面 → 顶部光带 →
// 左上白高光 → 居中浅色五角星。六色同一剪影，靠色相区分；
// 浅/深/星三色由 @/match3/tile 从本色派生，与 Leafer 版同源。
function drawGem(g: Graphics, color: number): void {
  const s = cell * TILE_FILL;
  const half = s / 2;
  const tile = TILES[color];
  const radius = s * 0.22;
  const inset = s * 0.055;
  // 外圈 bevel：内面上移收边，露出下缘一道暗边
  g.beginFill(hexNum(tile.dark));
  g.drawRoundedRect(-half, -half, s, s, radius);
  g.endFill();
  const faceX = -half + inset;
  const faceY = -half + inset * 0.6;
  const faceW = s - inset * 2;
  g.beginFill(hexNum(tile.base));
  g.drawRoundedRect(faceX, faceY, faceW, s - inset * 1.6, radius * 0.85);
  g.endFill();
  g.beginFill(hexNum(tile.light), 0.5);
  g.drawRoundedRect(faceX, faceY, faceW, s * 0.42, radius * 0.85);
  g.endFill();
  g.beginFill(0xffffff, 0.9);
  g.drawRoundedRect(-half + s * 0.14, -half + s * 0.12, s * 0.16, s * 0.1, s * 0.05);
  g.endFill();
  // 星星带一圈淡描边：浅色星压在浅色光带上仍保得住轮廓
  g.lineStyle(1.5, hexNum(tile.dark), 0.25);
  g.beginFill(hexNum(tile.star));
  g.drawPolygon(starPoints(half * 0.62, half * 0.31));
  g.endFill();
}

function makeGem(color: number): Node {
  const node = new Container();
  const g = new Graphics();
  drawGem(g, color);
  node.addChild(g);
  return node;
}

function rebuildViews(): void {
  if (!gems) return;
  gems.removeChildren().forEach((node) => node.destroy({ children: true }));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const node = makeGem(grid[r][c]);
      node.x = c * cell + cell / 2;
      node.y = r * cell + cell / 2;
      views[r][c] = node;
      gems.addChild(node);
    }
  }
  selMark!.visible = false;
}

// 开局雨落（spec 064）：整盘宝石按 planRain 的走位一行接一行落定。
// 下落是匀速直线，每颗宝石一条 tween 跑全程，按已流逝时间算进度 ——
// startMs 之前的时段停在出发点上（顶部几行从盘外出发）。
// pixi 版下落中半透明，落定恢复并做一次纵向挤压回弹；期间 busy 挡输入。
async function playIntro(): Promise<void> {
  busy = true;
  setSelected(null);
  const plan = planRain(ROWS, COLS, Math.random);
  const runs: Promise<void>[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const node = views[r][c];
      if (!node) continue;
      const step = plan[r][c];
      const y1 = r * cell + cell / 2;
      const y0 = step.fromCellY * cell + cell / 2;
      const total = step.startMs + step.durMs;
      node.y = y0;
      node.alpha = RAIN.fallingAlpha;
      runs.push((async () => {
        await animate(total, (k) => {
          const p = Math.min(1, Math.max(0, (k * total - step.startMs) / step.durMs));
          node.y = y0 + (y1 - y0) * p;
          node.alpha = RAIN.fallingAlpha + (1 - RAIN.fallingAlpha) * p;
        }, easeLinear);
        node.alpha = 1;
        await animate(RAIN.squashMs, (k) => {
          node.scale.set(1 + 0.12 * (1 - k), 1 - 0.14 * (1 - k));
        });
      })());
    }
  }
  await Promise.all(runs);
  busy = false;
}

// ── 回合流程 ───────────────────────────────────────────────────────────

function setSelected(pos: { r: number; c: number } | null): void {
  selected = pos;
  if (!selMark) return;
  if (!pos) {
    selMark.visible = false;
    return;
  }
  selMark.visible = true;
  selMark.x = pos.c * cell;
  selMark.y = pos.r * cell;
}

/** 交换并结算。非法交换自己弹回去，返回 false。 */
async function trySwap(a: Swap): Promise<void> {
  busy = true;
  setSelected(null);
  const { r1, c1, r2, c2 } = a;
  swapCells(grid, r1, c1, r2, c2);
  const va = views[r1][c1]!;
  const vb = views[r2][c2]!;
  views[r1][c1] = vb;
  views[r2][c2] = va;
  await Promise.all([glideTo(va, r2, c2, SWAP_MS), glideTo(vb, r1, c1, SWAP_MS)]);

  if (!findClears(grid).length) {
    // 不成立：原路弹回
    swapCells(grid, r1, c1, r2, c2);
    views[r1][c1] = va;
    views[r2][c2] = vb;
    await Promise.all([glideTo(va, r1, c1, SWAP_MS), glideTo(vb, r2, c2, SWAP_MS)]);
    busy = false;
    return;
  }
  await resolveBoard();
  busy = false;
}

/** 连锁结算：消除 → 下落补充 → 再查，直到稳定；随后查死局。 */
async function resolveBoard(): Promise<void> {
  combo.value = 0;
  for (let chain = 1; ; chain++) {
    const clears = findClears(grid);
    if (!clears.length) break;
    combo.value = chain;
    score.value += clears.length * chain;
    if (score.value > best.value) best.value = score.value;
    if (chain > 1) showToast(`连击 ×${chain}`);
    await Promise.all(clears.map((idx) => popGem(Math.floor(idx / COLS), idx % COLS)));
    removeCells(grid, clears);

    const { falls, spawns } = collapse(grid, COLORS, Math.random);
    const moving: Promise<void>[] = [];
    for (const f of falls) {
      const node = views[f.r1][f.c]!;
      views[f.r1][f.c] = null;
      views[f.r2][f.c] = node;
      moving.push(glideTo(node, f.r2, f.c, FALL_MS));
    }
    for (const s of spawns) {
      const node = makeGem(s.color);
      views[s.r][s.c] = node;
      gems!.addChild(node);
      node.x = s.c * cell + cell / 2;
      // 盘外补充沿用雨落语言：重力加速 + 半透明入场；盘内已有的坍缩
      // 仍走 glideTo 的 easeOut —— 一个是"从天上进来"，一个是"原地归位"
      const y0 = (s.from + 0.5) * cell;
      const y1 = s.r * cell + cell / 2;
      node.y = y0;
      node.alpha = RAIN.fallingAlpha;
      moving.push(
        animate(FALL_MS, (k) => {
          node.y = y0 + (y1 - y0) * k;
          node.alpha = RAIN.fallingAlpha + (1 - RAIN.fallingAlpha) * k;
        }, easeInQuad).then(() => {
          node.alpha = 1;
        }),
      );
    }
    await Promise.all(moving);
  }
  combo.value = 0;
  if (!findMove(grid)) {
    showToast('无可消除，自动重排');
    await animate(120, (k) => {
      if (layer) layer.alpha = 1 - k;
    });
    shuffleBoard(grid, Math.random);
    rebuildViews();
    await animate(120, (k) => {
      if (layer) layer.alpha = k;
    });
  }
}

/** 消除动画：缩放消失后把节点摘掉。 */
async function popGem(r: number, c: number): Promise<void> {
  const node = views[r][c];
  views[r][c] = null;
  if (!node) return;
  await animate(POP_MS, (k) => {
    node.scale.set(1 - k);
    node.alpha = 1 - k;
  });
  node.destroy({ children: true });
}

function hint(): void {
  if (busy || !renderer) return;
  const move = findMove(grid);
  if (!move) return;
  busy = true;
  const a = views[move.r1][move.c1]!;
  const b = views[move.r2][move.c2]!;
  animate(500, (k) => {
    const s = 1 + 0.16 * Math.abs(Math.sin(k * Math.PI * 2));
    a.scale.set(s);
    b.scale.set(s);
  }).then(() => {
    a.scale.set(1);
    b.scale.set(1);
    busy = false;
  });
}

function restart(): void {
  if (busy || !renderer) return;
  score.value = 0;
  combo.value = 0;
  showToast('新的一局');
  shuffleBoard(grid, Math.random);
  rebuildViews();
  void playIntro();
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
    toastTimer = null;
  }, 1400);
}

// ── 触摸 → 格子 ────────────────────────────────────────────────────────

let pressR = -1;
let pressC = -1;
let pressX = 0;
let pressY = 0;
let dragUsed = false;

function cellAt(x: number, y: number): { r: number; c: number } | null {
  if (!cell) return null;
  const c = Math.floor((x - ox) / cell);
  const r = Math.floor((y - oy) / cell);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

const adjacent = (a: { r: number; c: number }, b: { r: number; c: number }): boolean =>
  Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

function onTouch(type: 'start' | 'move' | 'end', event: FjsTouchEvent): void {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) return;
  const pos = cellAt(touch.offsetX, touch.offsetY);

  if (type === 'start') {
    if (!pos) return;
    pressR = pos.r;
    pressC = pos.c;
    pressX = touch.offsetX;
    pressY = touch.offsetY;
    dragUsed = false;
    return;
  }
  if (type === 'move') {
    if (!pos || busy || dragUsed || pressR < 0) return;
    const dx = touch.offsetX - pressX;
    const dy = touch.offsetY - pressY;
    // 位移过半格就按主导方向和邻格交换，这是消消乐的通用手势
    if (Math.abs(dx) < cell * 0.5 && Math.abs(dy) < cell * 0.5) return;
    const from = { r: pressR, c: pressC };
    const to = Math.abs(dx) > Math.abs(dy)
      ? { r: pressR, c: pressC + (dx > 0 ? 1 : -1) }
      : { r: pressR + (dy > 0 ? 1 : -1), c: pressC };
    dragUsed = true;
    if (to.r < 0 || to.r >= ROWS || to.c < 0 || to.c >= COLS) return;
    void trySwap({ r1: from.r, c1: from.c, r2: to.r, c2: to.c });
    return;
  }
  // touchend：没拖动就当 tap —— 选中 / 与选中邻格交换 / 换一个选中
  if (dragUsed || busy) {
    pressR = -1;
    return;
  }
  if (!pos) {
    setSelected(null);
    return;
  }
  if (selected && adjacent(selected, pos)) {
    void trySwap({ r1: selected.r, c1: selected.c, r2: pos.r, c2: pos.c });
    return;
  }
  setSelected(selected && selected.r === pos.r && selected.c === pos.c ? null : pos);
}

// ── 启动与生命周期 ─────────────────────────────────────────────────────

/** three-gltf.vue 同款 shim：pixi 只需要 width/height/style/事件登记。 */
function asDomCanvas(buffer: { readonly width: number; readonly height: number }): HTMLCanvasElement {
  return {
    width: buffer.width,
    height: buffer.height,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
}

/** GL buffer 与逻辑尺寸的比例 —— 读 gl.canvas，不读元素（见 three-gltf.vue）。 */
function bufferRatio(buffer: { readonly width: number }, logicalWidth: number): number {
  if (logicalWidth <= 0 || buffer.width <= 0) return 1;
  return buffer.width / logicalWidth;
}

function layout(): void {
  const cv = cvRef.value;
  if (!cv || !cv.width || !cv.height) return;
  const pad = 8;
  cell = Math.floor(Math.min((cv.width - pad * 2) / COLS, (cv.height - pad * 2) / ROWS));
  ox = Math.floor((cv.width - cell * COLS) / 2);
  oy = Math.floor((cv.height - cell * ROWS) / 2);
  if (!layer) return;
  layer.x = ox;
  layer.y = oy;
  redrawBg();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const node = views[r][c];
      if (node) {
        node.x = c * cell + cell / 2;
        node.y = r * cell + cell / 2;
      }
    }
  }
  if (selMark?.visible && selected) {
    selMark.x = selected.c * cell;
    selMark.y = selected.r * cell;
  }
  drawSelMark();
}

function drawSelMark(): void {
  if (!selMark) return;
  selMark.clear();
  selMark.lineStyle(2, 0xffffff, 0.85);
  selMark.drawRoundedRect(2, 2, cell - 4, cell - 4, 10);
}

function redrawBg(): void {
  if (!boardBg) return;
  boardBg.clear();
  const w = cell * COLS;
  const h = cell * ROWS;
  boardBg.beginFill(0x12141c);
  boardBg.drawRoundedRect(0, 0, w, h, 10);
  boardBg.endFill();
  boardBg.lineStyle(1, 0xffffff, 0.05);
  for (let c = 1; c < COLS; c++) {
    boardBg.moveTo(c * cell, 0);
    boardBg.lineTo(c * cell, h);
  }
  for (let r = 1; r < ROWS; r++) {
    boardBg.moveTo(0, r * cell);
    boardBg.lineTo(w, r * cell);
  }
}

function onResize(): void {
  const cv = cvRef.value;
  if (!cv) return;
  // 已启动：跟随尺寸变化重设渲染器与棋盘布局
  if (renderer) {
    renderer.resize(cv.width, cv.height);
    layout();
    return;
  }
  if (booting || !cv.width) return;
  // 白纹理必须就位（Renderer 构造会立刻读 Texture.WHITE）
  if (!whiteReady) return;
  const ctx = (cv.getContext('webgl2') ??
    cv.getContext('webgl')) as unknown as WebGLRenderingContext | null;
  if (!ctx) {
    status.value = '此环境没有 WebGL';
    return;
  }
  booting = true;
  try {
    const instance = new Renderer({
      view: asDomCanvas(ctx.canvas),
      // pixi 的 IRenderingContext 是完整 DOM 类型；桥 context 在运行时
      // 提供它用到的每个方法（同 three-gltf 的传法）
      context: ctx as unknown as IRenderingContext,
      width: cv.width,
      height: cv.height,
      backgroundColor: '#0b0d13',
      antialias: true,
      resolution: bufferRatio(ctx.canvas, cv.width),
      autoDensity: false,
    });
    renderer = instance;
    stage = new Container();
    layer = new Container();
    stage.addChild(layer);
    boardBg = new Graphics();
    layer.addChild(boardBg);
    gems = new Container();
    layer.addChild(gems);
    selMark = new Graphics();
    layer.addChild(selMark);
    // 先算格子尺寸再建宝石：启动这次 resize 之后未必还有下一次
    layout();
    rebuildViews();
    ticker = new Ticker();
    ticker.add(tick);
    ticker.start();
    void playIntro();
    status.value = '';
    booting = false;
  } catch (error) {
    booting = false;
    // 启动失败必须可见，不许黑着（constitution V）。
    // QuickJS 的 Error.stack 前几帧足够定位是 pixi 哪个系统在调用缺失 API。
    const message = error instanceof Error ? error.message : String(error);
    const stack = (error as Error).stack ?? '';
    const frames = stack
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('at '))
      .slice(0, 4);
    status.value = `pixi 启动失败：${message}\n${frames.join('\n')}`;
  }
}

onActivated(() => {
  ticker?.start();
  // 从别的页面回来可能错过 resize，补一次布局
  layout();
});
onDeactivated(() => ticker?.stop());
onUnmounted(() => {
  disposed = true;
  ticker?.stop();
  // stage 挂在 renderer 上：destroy 连子树一起清
  renderer?.destroy();
  renderer = null;
  ticker = null;
});

// 自动化走查用的调试钩子（spec 058 的 web / iOS 验收都靠它定位可行步）。
// 只读棋盘与几何，不改变行为；示例应用，不做环境开关。
(globalThis as unknown as Record<string, unknown>).__match3 = {
  grid,
  geometry: () => ({ cell, ox, oy }),
  findMove: () => findMove(grid),
};
</script>

<template>
  <view class="page">
    <view class="hud">
      <view class="stat">
        <text class="k">分数</text>
        <text class="v">{{ score }}</text>
      </view>
      <view class="stat">
        <text class="k">最高</text>
        <text class="v">{{ best }}</text>
      </view>
      <view class="stat">
        <text class="k">连击</text>
        <text class="v">{{ combo > 1 ? `×${combo}` : '—' }}</text>
      </view>
    </view>

    <view class="stage">
      <canvas
        defer-resize
        ref="cvRef"
        class="board"
        @resize="onResize"
        @touchstart="(e: FjsTouchEvent) => onTouch('start', e)"
        @touchmove="(e: FjsTouchEvent) => onTouch('move', e)"
        @touchend="(e: FjsTouchEvent) => onTouch('end', e)"
        @touchcancel="(e: FjsTouchEvent) => onTouch('end', e)"
      />
      <view v-if="status" class="mask">
        <text class="mask-text">{{ status }}</text>
      </view>
    </view>

    <view class="bar">
      <button class="btn" size="mini" @tap="hint()">提示</button>
      <button class="btn ghost" size="mini" @tap="restart()">重开</button>
      <view class="grow">
        <text v-if="toast" class="toast">{{ toast }}</text>
        <text v-else class="tip">点选相邻宝石交换，或朝一个方向拖动</text>
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
.stage {
  position: relative;
  flex-grow: 1;
  margin-top: 12px;
}
.board {
  width: 100%;
  height: 100%;
  /* 画布自己吃触摸，不让外层滚动抢手势 */
  touch-action: none;
}
.mask {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background-color: rgba(11, 13, 19, 0.78);
}
.mask-text {
  font-size: 13px;
  color: #e8ebf2;
}
.bar {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.btn {
  padding: 8px 14px;
  border-radius: 8px;
  background-color: #232838;
  color: #cfd5e4;
  font-size: 14px;
}
.ghost {
  background-color: #171a24;
  color: #8a91a6;
}
.grow {
  flex-grow: 1;
}
.toast {
  font-size: 13px;
  font-weight: 700;
  color: #feca57;
}
.tip {
  font-size: 12px;
  color: #7b8296;
}
</style>
