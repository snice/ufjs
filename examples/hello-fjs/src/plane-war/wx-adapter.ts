// wx adapter for the vendored WeChat mini-game (specs/214).
//
// The game under minigame/ is copied byte-for-byte from the WeChat project
// and talks to the WeChat globals: `wx.createCanvas/createImage`,
// `wx.onTouch*`, `wx.getWindowInfo`, `GameGlobal`, and the bare `canvas`
// global that `render.js` publishes. This module defines those globals
// (installed once, on page mount) so the game runs unmodified on the fjs
// canvas contract.
//
// Three deliberate shapes, each fixing a real mismatch:
//
// 1. `createCanvas()` returns a WRAPPER, not the fjs canvas — the fjs
//    canvas's width/height are read-only getters, and `render.js` assigns
//    `canvas.width = screenWidth` (a TypeError on a getter-only accessor
//    under ESM strict mode). The wrapper keeps writable mirrors that
//    `attachCanvas()`/`onCanvasResize()` keep in step with the real canvas.
// 2. The 2d context is handed out through a Proxy: the game passes its own
//    image shells (from `createImage()`) to `drawImage`, and the proxy
//    swaps in the real `loadCanvasImage` handle. Before an image decodes
//    the call is skipped entirely — the same "draws nothing until loaded,
//    next frame picks it up" semantics as canvas-compat §7. `fillText`
//    gets the same treatment for number args (DOM coerces, and the game
//    passes the numeric score).
// 3. `wx.createImage()` returns a shell with a writable `.src` — the game
//    assigns paths like `images/hero.png` AFTER construction, and a real
//    web Image element must never see a second `.src` assignment, so shell
//    and handle stay separate objects. Paths are rewritten into
//    `/plane-war/…` under public/ (same layout as flappy-bird's `/fb/`).
import { loadCanvasImage } from 'fjs';
import type { FjsCanvasApi, FjsCanvasContext2D, FjsCanvasImage, FjsTouchEvent } from 'fjs';

const ASSET_PREFIX = '/plane-war/';

interface PlaneWarImage {
  /** Marker the ctx proxy looks for on drawImage's first argument. */
  readonly __planeWarImage: true;
  src: string;
  readonly __handle?: FjsCanvasImage;
}

function rewritePath(src: string): string {
  if (/^(https?:|\/|data:)/.test(src)) return src;
  return ASSET_PREFIX + src;
}

function createImage(): PlaneWarImage {
  // Backing fields live next to the accessor: `src` is a defineProperty
  // setter, so assigning image.src inside it would recurse to oblivion
  // (gameinfo.js assigns atlas.src at module import — this blew the stack
  // once already; console.error on boot failure is there for the next one).
  const state: { path: string; handle?: FjsCanvasImage } = { path: '' };
  const image: PlaneWarImage = {
    __planeWarImage: true,
    get src(): string {
      return state.path;
    },
    set src(value: string) {
      state.path = value;
      state.handle = loadCanvasImage(
        rewritePath(value),
        () => {},
        (message) => console.info(`[plane-war] image failed: ${value} (${message})`),
      );
    },
    get __handle(): FjsCanvasImage | undefined {
      return state.handle;
    },
  };
  return image;
}

// ── canvas + context ────────────────────────────────────────────────────

let screenCanvas: FjsCanvasApi | null = null;

/** Logical size of the game canvas, mirrored for `getWindowInfo()` and the
 * canvas wrapper's writable width/height. */
const screen = { width: 0, height: 0 };

/** The 2d context handed to the game. STABLE across re-entries: main.js
 * captures `canvas.getContext('2d')` once at module load, so the proxy
 * itself must outlive any single canvas and resolve the CURRENT canvas's
 * real context on every access — each page mount is a new canvas node, and
 * a context bound to a previous mount keeps drawing into a canvas buried
 * under the navigator stack while the visible page stays blank. Method
 * bindings are cached per real context and reset on attach. */
let currentCtx: FjsCanvasContext2D | null = null;
let boundCtx: FjsCanvasContext2D | null = null;
const methodCache = new Map<PropertyKey, unknown>();

function proxyContext(): FjsCanvasContext2D {
  const drawImage = (...args: unknown[]): void => {
    if (!currentCtx) return;
    const first = args[0] as PlaneWarImage | undefined;
    if (first && first.__planeWarImage) {
      if (!first.__handle) return; // not decoded yet — draw nothing this frame
      args[0] = first.__handle;
    }
    (currentCtx.drawImage as (...a: unknown[]) => void)(...args);
  };
  return new Proxy({} as FjsCanvasContext2D, {
    get(_t, key) {
      if (!currentCtx) return undefined;
      if (key === 'drawImage') return drawImage;
      if (key === 'fillText' || key === 'strokeText') {
        let wrapped = methodCache.get(key) as ((...a: unknown[]) => void) | undefined;
        if (!wrapped) {
          // bind: on web these are native context methods — calling the
          // detached function throws "Illegal invocation" (the App side is
          // a plain JS state machine and would have hidden this).
          const original = (currentCtx[key as 'fillText']).bind(currentCtx);
          wrapped = (...a: unknown[]) => original(String(a[0]), a[1] as never, a[2] as never);
          methodCache.set(key, wrapped);
        }
        return wrapped;
      }
      const value = Reflect.get(currentCtx, key, currentCtx);
      if (typeof value === 'function') {
        let bound = methodCache.get(key) as unknown | undefined;
        if (!bound) {
          bound = (value as (...a: unknown[]) => unknown).bind(currentCtx);
          methodCache.set(key, bound);
        }
        return bound;
      }
      return value;
    },
    // Receiver must be the raw context: the default trap forwards sets with
    // the PROXY as receiver, so a native accessor on the context prototype
    // (ctx.fillStyle = …) runs with a non-native this and throws "Illegal
    // invocation" on web. App-side the context is a plain object, which is
    // why the game only died on the web end.
    set(_t, key, value) {
      if (!currentCtx) return true;
      Reflect.set(currentCtx, key, value, currentCtx);
      return true;
    },
  });
}

function createCanvas(): {
  width: number;
  height: number;
  getContext(type?: string): unknown;
} {
  return {
    get width(): number {
      return screen.width;
    },
    set width(value: number) {
      screen.width = value;
    },
    get height(): number {
      return screen.height;
    },
    set height(value: number) {
      screen.height = value;
    },
    getContext(type?: string): unknown {
      return type === '2d' ? proxyContext() : undefined;
    },
  };
}

// ── touch ───────────────────────────────────────────────────────────────

type TouchHandler = (event: {
  touches: Array<{ identifier: number; clientX: number; clientY: number }>;
  changedTouches: Array<{ identifier: number; clientX: number; clientY: number }>;
  timeStamp: number;
}) => void;

const touchHandlers: Record<'start' | 'move' | 'end' | 'cancel', TouchHandler[]> = {
  start: [],
  move: [],
  end: [],
  cancel: [],
};

function toTouchPoint(touch: {
  identifier: number;
  offsetX: number;
  offsetY: number;
}): { identifier: number; clientX: number; clientY: number } {
  // The game reads clientX/clientY, but canvas-compat §9 is explicit that
  // hit-testing belongs on offsetX/offsetY — the game canvas is meant to
  // be full-screen, and mapping here keeps that true wherever it sits.
  return { identifier: touch.identifier, clientX: touch.offsetX, clientY: touch.offsetY };
}

export function emitTouch(
  kind: 'start' | 'move' | 'end' | 'cancel',
  event: FjsTouchEvent,
): void {
  const shaped = {
    touches: event.touches.map(toTouchPoint),
    changedTouches: event.changedTouches.map(toTouchPoint),
    timeStamp: event.timeStamp,
  };
  for (const handler of touchHandlers[kind]) handler(shaped);
}

// ── install / dispose ───────────────────────────────────────────────────

let audioWarned = false;
let vibrateWarned = false;

function createInnerAudioContext(): Record<string, unknown> {
  if (!audioWarned) {
    audioWarned = true;
    console.info('[plane-war] ufjs 还没有音频能力，音效静音（specs/214 降级项）');
  }
  return {
    loop: false,
    autoplay: false,
    src: '',
    currentTime: 0,
    play(): void {},
    stop(): void {},
    destroy(): void {},
  };
}

function vibrateShort(): void {
  if (!vibrateWarned) {
    vibrateWarned = true;
    console.info('[plane-war] 震动降级为 no-op（specs/214）');
  }
}

/** Pending game frames, keyed by native rAF id. The shim below passes
 * every caller through to the native rAF — but while the game is alive
 * its frames are also tracked in the map, so `disposeGame()` can cancel
 * exactly them and stop re-arming. That flag matters because of a race:
 * a pop that lands mid-frame cancels a callback the scheduler already
 * invoked, and the loop's re-arm would otherwise escape. After dispose
 * the shim simply refuses to schedule (gameAlive=false) — the escaped
 * re-arm dies at the next frame boundary; everyone else keeps a plain
 * pass-through. */
const gameFrames = new Map<number, (t: number) => void>();
let gameAlive = false;
let nativeCaf: ((id: number) => void) | null = null;

export function installPlaneWarWx(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.__planeWarWxInstalled) return;
  g.__planeWarWxInstalled = true;
  // Identity, not a shim object: `GameGlobal.databus = …` etc. are meant to
  // be app-wide globals, and bare `canvas` (set by render.js via
  // `GameGlobal.canvas = …`) has to resolve from module scope.
  g.GameGlobal = g;

  const raf = g.requestAnimationFrame as (cb: (t: number) => void) => number;
  const caf = g.cancelAnimationFrame as (id: number) => void;
  nativeCaf = caf;
  g.requestAnimationFrame = (cb: (t: number) => void): number => {
    if (!gameAlive) return raf(cb);
    const entry = { id: 0 };
    const wrapped = (t: number): void => {
      // gameAlive is checked at FIRE time, not schedule time: a pop that
      // lands after the scheduler dequeued this callback must not run the
      // loop body — otherwise it re-arms through the !gameAlive
      // pass-through below and the loop escapes disposal forever.
      if (!gameAlive) return;
      gameFrames.delete(entry.id);
      cb(t);
    };
    entry.id = raf(wrapped);
    gameFrames.set(entry.id, wrapped);
    return entry.id;
  };
  g.cancelAnimationFrame = (id: number): void => {
    gameFrames.delete(id);
    caf(id);
  };

  g.wx = {
    createCanvas,
    createImage,
    getWindowInfo: () => ({ screenWidth: screen.width, screenHeight: screen.height }),
    getSystemInfoSync: () => ({ screenWidth: screen.width, screenHeight: screen.height }),
    onTouchStart: (handler: TouchHandler): void => void touchHandlers.start.push(handler),
    onTouchMove: (handler: TouchHandler): void => void touchHandlers.move.push(handler),
    onTouchEnd: (handler: TouchHandler): void => void touchHandlers.end.push(handler),
    onTouchCancel: (handler: TouchHandler): void => void touchHandlers.cancel.push(handler),
    vibrateShort,
    createInnerAudioContext,
  };
}

/** Page calls this from `@resize` (and once on mount) so `wx.getWindowInfo`
 * and the canvas wrapper track the real logical size. A NEW canvas node
 * (page re-mounted) also rebinds the context the stable proxy resolves to. */
export function attachPlaneWarCanvas(cv: FjsCanvasApi | undefined): void {
  if (!cv) return;
  if (screenCanvas !== cv) {
    screenCanvas = cv;
    currentCtx = cv.getContext('2d');
    methodCache.clear();
  }
  screen.width = cv.width;
  screen.height = cv.height;
}

/** Page leave (back / unmount): the game dies, exactly like leaving a
 * mini-game in WeChat. Cancels the pending loop frame (the loop re-arms
 * itself one frame at a time, so killing the pending one stops it), drops
 * the dead instances' touch handlers, and clears the rAF bookkeeping. The
 * next mount boots a brand-new game via `bootGame()`. Idempotent. */
export function disposeGame(): void {
  gameAlive = false;
  if (nativeCaf) for (const id of [...gameFrames.keys()]) nativeCaf(id);
  gameFrames.clear();
  touchHandlers.start.length = 0;
  touchHandlers.move.length = 0;
  touchHandlers.end.length = 0;
  touchHandlers.cancel.length = 0;
}

/** Boot (or re-boot after dispose) the game. main.js default-exports the
 * Main class; `new Main()` runs start(), whose databus.reset() makes every
 * life a fresh game — the module-level `instance` singletons inside the
 * game (databus/music) are reused but fully reset by that same call. The
 * original entry `minigame/game.js` stays in the tree untouched; it is the
 * WeChat bootstrap and is not exercised here. */
export async function bootGame(): Promise<void> {
  installPlaneWarWx();
  gameAlive = true;
  // @ts-expect-error — 原样拷贝的微信小游戏，纯 JS 无类型
  const { default: Main } = await import('./minigame/js/main.js');
  new Main();
}
