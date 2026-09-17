// 把 F2 接到 fjs 的 <canvas> 上。
//
// F2 只要一个标准 CanvasRenderingContext2D（小程序 / Node 教程原话），不需要
// DOM。官方 Vue 教程走 @antv/f-vue，那层自己挂一个真 <canvas>——web 能跑、
// App 空白，宪法 I 不允许。所以这里用 @antv/f2 的 createElement +
// new Canvas({ context })，和 echarts/adapter.ts 同一条「喂上下文、不伪装 DOM」。
//
// 设备像素：和 ECharts 同一条。g-lite 会 setTransform 冲掉 web 侧预置的 dpr
// 缩放，图就按 1x 画在 2x 位图上，缩在左上角。所以先把 transform 归 identity，
// 再把 canvas.devicePixelRatio 交给 F2 自己 scale。App 上这个值是 1。
// ctx.canvas 仍然要藏：逼 F2 走 EventEmitter，两端触摸都走 handleTouch。
import { Canvas, CanvasRenderer } from '@antv/f2';
import { hasNativeHost } from 'fjs';
import type { FjsCanvasApi, FjsCanvasContext2D } from 'fjs';
import type { FjsTouchEvent } from 'fjs';

/** Most recent 2d context, so a document.createElement('canvas') that G
 * fires from a timer (its rAF polyfill is setTimeout) can still measure
 * text. Flutter logs that throw as `[fjs/timer]`. */
let lastContext: FjsCanvasContext2D | null = null;

export interface FjsF2Chart {
  canvas: Canvas;
  handleTouch(type: 'start' | 'move' | 'end', event: FjsTouchEvent): void;
  resize(): void;
  destroy(): void;
}

type F2CanvasEl = {
  isCanvasElement: true;
  dispatchEvent(e: object): void;
  width: number;
  height: number;
};

function isF2Wrapper(el: unknown): el is F2CanvasEl {
  return !!el && typeof el === 'object' && (el as { isCanvasElement?: boolean }).isCanvasElement === true;
}

function touchPoint(event: FjsTouchEvent): { x: number; y: number; identifier: number } | null {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) return null;
  return { x: touch.offsetX, y: touch.offsetY, identifier: 1 };
}

/** Hide the host canvas so F2 cannot bind to a real HTMLCanvasElement (web)
 * or try to write the read-only `width` on the fjs element (App).
 * createMobileCanvasElement then wraps us in an EventEmitter; every input
 * goes through handleTouch, both platforms.
 *
 * Must mutate `ctx.canvas` in place — do not Proxy the context. G calls
 * native 2D methods with the context as `this`; a Proxy throws
 * Illegal invocation in the browser. */
function hideHostCanvas(
  ctx: FjsCanvasContext2D,
  host: { width: number; height: number },
): void {
  Object.defineProperty(ctx, 'canvas', {
    get: () => host,
    configurable: true,
  });
}

/** g-mobile-canvas 内部把 dpr 向上取整（`Math.ceil`）后每帧 resetTransform
 * 再乘它，位图却是按真实 dpr 放大的。dpr 不是整数（3.5 的安卓机、2.625 的
 * 浏览器）时图就整体放大 ceil/dpr 倍、右边和底部被裁。这里把 G 设的每个
 * 绝对变换乘上 dpr/ceil(dpr)，让它的画面正好落在位图里。整数 dpr 不动。 */
function fitIntegerDpr(ctx: FjsCanvasContext2D, dpr: number): void {
  const k = dpr >= 1 ? dpr / Math.ceil(dpr) : 1;
  if (k === 1) return;
  const setTransform = ctx.setTransform.bind(ctx);
  Object.defineProperty(ctx, 'setTransform', {
    value: (a: number, b: number, c: number, d: number, e: number, f: number) =>
      setTransform(a * k, b * k, c * k, d * k, e * k, f * k),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(ctx, 'resetTransform', {
    value: () => setTransform(k, 0, 0, k, 0, 0),
    configurable: true,
    writable: true,
  });
}

type PathPt = { x: number; y: number };

function pointInPolygon(x: number, y: number, poly: PathPt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Font-metric pixels: red field + a black band. g-lite measureFont scans
 * for the first non-red row; all-zero data made ascent = baseline and
 * every text box huge, so F2's tooltip background stretched into a full-
 * width black bar. */
function metricImageData(w: number, h: number): ImageData {
  const width = Math.max(1, Math.ceil(w));
  const height = Math.max(1, Math.ceil(h));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 3] = 255;
  }
  const top = Math.max(1, Math.floor(height * 0.2));
  const bottom = Math.max(top + 1, Math.floor(height * 0.75));
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
  return { data, width, height } as ImageData;
}

function createStubContext(measure: FjsCanvasContext2D | null) {
  let font = '10px sans-serif';
  const polygons: PathPt[][] = [];
  let current: PathPt[] = [];
  let start: PathPt | null = null;

  function flush(): void {
    if (current.length) polygons.push(current);
    current = [];
    start = null;
  }

  function add(x: number, y: number): void {
    current.push({ x, y });
  }

  return {
    canvas: { width: 64, height: 64 },
    fillStyle: '#000',
    strokeStyle: '#000',
    textBaseline: 'alphabetic',
    textAlign: 'left',
    lineWidth: 1,
    globalAlpha: 1,
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
      if (measure) measure.font = value;
    },
    save() {},
    restore() {},
    setTransform() {},
    resetTransform() {},
    scale() {},
    translate() {},
    rotate() {},
    beginPath() {
      polygons.length = 0;
      current = [];
      start = null;
    },
    closePath() {
      if (start) add(start.x, start.y);
      flush();
    },
    moveTo(x: number, y: number) {
      flush();
      start = { x, y };
      add(x, y);
    },
    lineTo(x: number, y: number) {
      add(x, y);
    },
    rect(x: number, y: number, w: number, h: number) {
      this.moveTo(x, y);
      this.lineTo(x + w, y);
      this.lineTo(x + w, y + h);
      this.lineTo(x, y + h);
      this.closePath();
    },
    arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean) {
      let startA = a0;
      let endA = a1;
      if (ccw && endA > startA) endA -= Math.PI * 2;
      if (!ccw && endA < startA) endA += Math.PI * 2;
      const steps = Math.max(8, Math.ceil(Math.abs(endA - startA) / (Math.PI / 16)));
      if (!current.length) {
        this.moveTo(x + r * Math.cos(startA), y + r * Math.sin(startA));
      }
      for (let i = 1; i <= steps; i++) {
        const t = startA + ((endA - startA) * i) / steps;
        add(x + r * Math.cos(t), y + r * Math.sin(t));
      }
    },
    ellipse(
      x: number,
      y: number,
      rx: number,
      _ry: number,
      _rot: number,
      a0: number,
      a1: number,
      ccw?: boolean,
    ) {
      this.arc(x, y, rx, a0, a1, ccw);
    },
    arcTo() {},
    bezierCurveTo(_x1: number, _y1: number, _x2: number, _y2: number, x: number, y: number) {
      add(x, y);
    },
    quadraticCurveTo(_x1: number, _y1: number, x: number, y: number) {
      add(x, y);
    },
    fill() {
      flush();
    },
    stroke() {},
    clip() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    fillText() {},
    strokeText() {},
    measureText(text: string) {
      if (measure) {
        measure.font = font;
        return measure.measureText(text);
      }
      return { width: Math.max(1, text.length * 8) };
    },
    getImageData(_x: number, _y: number, w: number, h: number) {
      return metricImageData(w, h);
    },
    isPointInPath(x: number, y: number) {
      flush();
      return polygons.some((poly) => poly.length > 2 && pointInPolygon(x, y, poly));
    },
    isPointInStroke() {
      return false;
    },
  };
}

/** Web: a real <canvas> so g-lite's picker can beginPath / isPointInPath.
 * App: the stub above — Flutter's getImageData is null and isPointInPath
 * is a no-op, and we must not paint the metric sample onto the chart. */
function createOffscreen(ctx: FjsCanvasContext2D | null) {
  if (typeof HTMLCanvasElement !== 'undefined') {
    const el = document.createElement('canvas');
    el.width = 64;
    el.height = 64;
    return el;
  }
  const stubCtx = createStubContext(ctx);
  return {
    width: 64,
    height: 64,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    getContext(type: string) {
      return type === '2d' ? stubCtx : null;
    },
  };
}

/** g-lite OffscreenCanvasCreator: `new window.OffscreenCanvas` throws, the
 * catch does `document.createElement('canvas')`. That runs inside G's
 * setTimeout rAF polyfill, so the host logs `[fjs/timer]` and our
 * `new Canvas()` try/catch never sees it. A real `document` would also
 * flip ECharts onto HTML tooltip — this stub only implements createElement
 * / createElementNS, nothing a page can mount. */
function installF2HostStubs(): void {
  if (!hasNativeHost) return;
  const g = globalThis as Record<string, unknown>;
  // 合并而不是"已有就跳过"：pixi 垫片（adapters/pixi/native-shims）也会装一个
  // 残缺 document。先进消消乐再进图表页时，跳过会让 G 拿不到能量文字的 canvas。
  // F2 的 createElement 覆盖对方的：它的 canvas getContext('webgl') 同样返回
  // null，pixi 需要的行为不变。
  const doc = (g.document ?? {}) as Record<string, unknown>;
  if (doc.__fjsF2Stub) return;
  Object.assign(doc, {
    __fjsF2Stub: true,
    documentElement: doc.documentElement ?? { style: { fontSize: '50px' } },
    body: doc.body ?? { appendChild() {}, removeChild() {} },
    head: doc.head ?? { appendChild() {}, removeChild() {} },
    defaultView: doc.defaultView ?? g,
    createElement(tag: string) {
      if (String(tag).toLowerCase() === 'canvas') return createOffscreen(lastContext);
      return { style: {}, appendChild() {}, removeChild() {}, setAttribute() {} };
    },
    createElementNS(_ns: string, tag: string) {
      return { style: {}, appendChild() {}, removeChild() {}, setAttribute() {}, tagName: tag };
    },
  });
  g.document = doc;
}

installF2HostStubs();

function paintError(ctx: FjsCanvasContext2D, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn('[fjs] F2 failed', err);
  ctx.save();
  ctx.fillStyle = '#c00';
  ctx.font = '13px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(message, 8, 8);
  ctx.restore();
}

/** 在一个 fjs canvas 上创建 F2 图。尺寸为 0 时返回 null，调用方等 @resize。 */
export function createF2Chart(
  canvas: FjsCanvasApi | undefined,
  children: unknown,
): FjsF2Chart | null {
  const ctx = canvas?.getContext('2d') as FjsCanvasContext2D | null;
  if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return null;
  lastContext = ctx;
  installF2HostStubs();

  let width = canvas.width;
  let height = canvas.height;
  const host = { width, height };
  hideHostCanvas(ctx, host);
  // Flutter 的 canvas.devicePixelRatio 是 1（宿主整场景光栅化）。web 必须用
  // 浏览器的值：Vue expose 的 getter 有时会在 surface 还没挂上时被读成 1，
  // G 每帧 resetTransform 再按 getDPR() 乘，传 1 图就缩在 2x 位图左上角。
  // 小程序没有 DOM：backing store 按 canvas.devicePixelRatio 放大，必须用它；
  // 基础库全局上的 devicePixelRatio 不一定是同一个数，差一点图就整体放大被裁。
  const pixelRatio =
    '__fjs' in globalThis
      ? 1
      : typeof document === 'undefined'
        ? canvas.devicePixelRatio || 1
        : globalThis.devicePixelRatio || canvas.devicePixelRatio || 1;
  fitIntegerDpr(ctx, pixelRatio);
  // fjs web 已经 setTransform(dpr)。G 还会再 scale(pixelRatio)；不先清掉
  // 会叠乘，清掉却不把 dpr 交给 F2 就会缩在左上角。
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  let f2: Canvas;
  try {
    // isTouchEvent：g-lite 默认 `event instanceof TouchEvent`，我们派的是
    // 普通对象（App 上没有 TouchEvent）。
    f2 = new Canvas({
      context: ctx as unknown as CanvasRenderingContext2D,
      // 关掉脏矩形重绘。G 默认只清 + 只重画变脏的那几块，浏览器上这是省事，
      // 在 fjs 上是反过来的：宿主保留显示列表，只有「整块 clearRect」才丢弃
      // 旧命令，所以脏矩形模式下每帧都在往列表尾巴上追加，重绘成本按帧数
      // 线性涨（三张图各自涨），进页面几秒就卡。整块清一次反而是常数成本，
      // ECharts 一直是这么画的。
      renderer: new CanvasRenderer({ enableDirtyRectangleRendering: false }),
      width,
      height,
      pixelRatio,
      children,
      // 入场动画照官方默认开着：rAF 两端都有（App 上是宿主帧回调），
      // 折线 400ms 左右画完。
      animate: true,
      // g-lite 默认（true）是「等宿主派一个原生 click」。宿主没有 DOM，
      // 我们也不该伪造一个；关掉它，g 自己按 pointerdown/up 合成 click，
      // 走的和 press / pan 同一条触摸流。
      // web 让 g-lite 自己 new OffscreenCanvas——真 2d 才有 beginPath，
      // 点饼图才能命中。App 没有那套 API，才喂软件桩。HMR 后若还报
      // beginPath，硬刷新一次：g-lite 的 OffscreenCanvasCreator 是单例，
      // 会把第一次的桩缓存到死。
      offscreenCanvas:
        typeof HTMLCanvasElement === 'undefined' ? (createOffscreen(ctx) as never) : undefined,
      requestAnimationFrame: globalThis.requestAnimationFrame?.bind(globalThis),
      cancelAnimationFrame: globalThis.cancelAnimationFrame?.bind(globalThis),
      isTouchEvent: (event: { changedTouches?: unknown }) => Array.isArray(event?.changedTouches),
      useNativeClickEvent: false,
    });
  } catch (err) {
    paintError(ctx, err);
    return null;
  }

  void f2.render().catch((err: unknown) => paintError(ctx, err));

  function dispatch(el: F2CanvasEl, type: string, point: { x: number; y: number; identifier: number }, ended: boolean): void {
    const finger = {
      clientX: point.x,
      clientY: point.y,
      identifier: point.identifier,
    };
    el.dispatchEvent({
      type,
      clientX: point.x,
      clientY: point.y,
      touches: ended ? [] : [finger],
      changedTouches: [finger],
      target: el,
      preventDefault() {},
      stopPropagation() {},
    });
  }

  return {
    canvas: f2,
    handleTouch(type, event) {
      const el = f2.getCanvasEl();
      if (!isF2Wrapper(el)) return;
      const point = touchPoint(event);
      if (!point) return;
      // 只派 touch*：G 的手势插件从这条流里认 press / pan / click，
      // F2 的 Tooltip（默认 triggerOn: 'press'）和 selection 都吃这些。
      const name = type === 'start' ? 'touchstart' : type === 'move' ? 'touchmove' : 'touchend';
      dispatch(el, name, point, type === 'end');
    },
    resize() {
      if (canvas.width === width && canvas.height === height) return;
      width = canvas.width;
      height = canvas.height;
      host.width = width;
      host.height = height;
      const el = f2.getCanvasEl();
      if (isF2Wrapper(el)) {
        el.width = width;
        el.height = height;
      }
      // web ResizeObserver 重设 backing store 时会把 dpr transform 加回来，
      // G 的 resize 还要再 scale 一次，这里同样先清掉。
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      void f2.resize(width, height);
    },
    destroy() {
      f2.destroy();
    },
  };
}
