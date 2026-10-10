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
// 4. audio + vibration (specs/215) forward to the built-in vibrateShort and
//    the @ufjs/audio module's createAudio (audio needs the audioplayers pub
//    dependency, so it is a module package, not core). Two real-life gaps
//    close here rather than in the game: leaving the page must STOP the
//    Music singleton's still-alive contexts (the game module outlives the
//    page, and bgm would keep playing), and the web build's first bgm
//    attempt usually lands before any user gesture — browser autoplay
//    policy rejects it, so the first touch re-kicks every autoplay context
//    once.
import { createAudio } from '@ufjs/audio';
import type { FjsAudio } from '@ufjs/audio';
import { vibrateShort as fjsVibrateShort } from 'fjs';
import type { FjsVibrateType } from 'fjs';
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
  // The web build's first bgm attempt lands before any user gesture and the
  // browser autoplay policy rejects it (the runtime warns once). The first
  // touch IS a gesture — re-kick every autoplay context still pending. On
  // the native host play() on a playing context is a no-op, so this is
  // free there.
  if (gesturePending.size > 0) {
    for (const audio of [...gesturePending]) {
      gesturePending.delete(audio);
      audio.play();
    }
  }
  const shaped = {
    touches: event.touches.map(toTouchPoint),
    changedTouches: event.changedTouches.map(toTouchPoint),
    timeStamp: event.timeStamp,
  };
  for (const handler of touchHandlers[kind]) handler(shaped);
}

// ── install / dispose ───────────────────────────────────────────────────

/** Every wx audio context handed out, alive until the game destroys it.
 * Music's contexts are module singletons that outlive the page — this set
 * is what lets disposeGame/bootGame stop and re-kick them (see the header,
 * shape 4). */
const liveAudio = new Set<FjsAudio>();
/** autoplay contexts still waiting for the web's first user gesture. */
const gesturePending = new Set<FjsAudio>();

type WxVibrateOptions = { type?: FjsVibrateType };

/** The wx InnerAudioContext surface the game touches (plus the callback
 * properties the adapter passes through for other vendored games). */
type WxInnerAudio = FjsAudio & {
  readonly __wxAudio: true;
};

function createInnerAudioContext(): WxInnerAudio {
  const audio = createAudio();
  liveAudio.add(audio);
  if (audio.autoplay) gesturePending.add(audio);
  const wrapper: WxInnerAudio = {
    __wxAudio: true,
    get src(): string {
      return audio.src;
    },
    set src(value: string) {
      audio.src = rewritePath(value);
    },
    get loop(): boolean {
      return audio.loop;
    },
    set loop(value: boolean) {
      audio.loop = value;
    },
    get autoplay(): boolean {
      return audio.autoplay;
    },
    set autoplay(value: boolean) {
      audio.autoplay = value;
      if (value) gesturePending.add(audio);
      else gesturePending.delete(audio);
    },
    get volume(): number {
      return audio.volume;
    },
    set volume(value: number) {
      audio.volume = value;
    },
    get currentTime(): number {
      return audio.currentTime;
    },
    set currentTime(value: number) {
      audio.currentTime = value;
    },
    get duration(): number {
      return audio.duration;
    },
    play(): void {
      audio.play();
      gesturePending.delete(audio);
    },
    pause(): void {
      audio.pause();
    },
    stop(): void {
      audio.stop();
    },
    destroy(): void {
      audio.destroy();
      liveAudio.delete(audio);
      gesturePending.delete(audio);
    },
    get onPlay(): (() => void) | null {
      return audio.onPlay;
    },
    set onPlay(value: (() => void) | null) {
      audio.onPlay = value;
    },
    get onPause(): (() => void) | null {
      return audio.onPause;
    },
    set onPause(value: (() => void) | null) {
      audio.onPause = value;
    },
    get onStop(): (() => void) | null {
      return audio.onStop;
    },
    set onStop(value: (() => void) | null) {
      audio.onStop = value;
    },
    get onEnded(): (() => void) | null {
      return audio.onEnded;
    },
    set onEnded(value: (() => void) | null) {
      audio.onEnded = value;
    },
    get onError(): ((message: string) => void) | null {
      return audio.onError;
    },
    set onError(value: ((message: string) => void) | null) {
      audio.onError = value;
    },
  };
  return wrapper;
}

function vibrateShort(options?: WxVibrateOptions): void {
  fjsVibrateShort(options?.type ?? 'heavy');
}

/** Pending game frames, keyed by native rAF id. Only frames that belong to
 * the game's own loop are tracked: the shim attributes a schedule to the
 * game when it happens INSIDE a tracked frame's callback (the loop re-arms
 * itself, so its whole chain is attributed) or during bootGame's capture
 * window (the loop root). Everything else — Vue's transition nextFrame,
 * other pages — passes through the native rAF untouched: a global gate
 * here would kill the framework's own pending frames and freeze the page
 * leave transition mid-flight. `disposeGame()` flips every tracked entry
 * dead and cancels it; the loop's re-arm never fires and the game stops.
 * A cancel that lands after the frame was dequeued is covered by the
 * entry.live check at fire time. */
interface GameFrame {
  live: boolean;
  id: number;
  wrapped: (t: number) => void;
}
const gameFrames = new Map<number, GameFrame>();
let captureRoot = false;
let inGameFrame = 0;
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
    const owns = captureRoot || inGameFrame > 0;
    captureRoot = false;
    if (!owns) return raf(cb);
    const entry: GameFrame = { live: true, id: 0, wrapped: () => {} };
    entry.wrapped = (t: number): void => {
      if (!entry.live) return;
      gameFrames.delete(entry.id);
      inGameFrame++;
      try {
        cb(t);
      } finally {
        inGameFrame--;
      }
    };
    entry.id = raf(entry.wrapped);
    gameFrames.set(entry.id, entry);
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
 * the dead instances' touch handlers, clears the rAF bookkeeping, and
 * stops every live audio context — the Music singleton outlives the page,
 * and without this bgm keeps playing over whatever comes next. The next
 * mount boots a brand-new game via `bootGame()`. Idempotent. */
export function disposeGame(): void {
  for (const entry of gameFrames.values()) entry.live = false;
  if (nativeCaf) for (const id of [...gameFrames.keys()]) nativeCaf(id);
  gameFrames.clear();
  touchHandlers.start.length = 0;
  touchHandlers.move.length = 0;
  touchHandlers.end.length = 0;
  touchHandlers.cancel.length = 0;
  // stop (not destroy): the contexts are module singletons the next game
  // reuses — destroying here would silence every re-entry
  for (const audio of liveAudio) audio.stop();
  gesturePending.clear();
}

/** Boot (or re-boot after dispose) the game. main.js default-exports the
 * Main class; `new Main()` runs start(), whose databus.reset() makes every
 * life a fresh game — the module-level `instance` singletons inside the
 * game (databus/music) are reused but fully reset by that same call. The
 * original entry `minigame/game.js` stays in the tree untouched; it is the
 * WeChat bootstrap and is not exercised here. */
export async function bootGame(): Promise<void> {
  installPlaneWarWx();
  // @ts-expect-error — 原样拷贝的微信小游戏，纯 JS 无类型
  const { default: Main } = await import('./minigame/js/main.js');
  // captureRoot opens HERE, immediately before new Main(): start() schedules
  // the loop synchronously inside the constructor, so the root frame is
  // captured with no window for anyone else's rAF to slip in tracked.
  captureRoot = true;
  new Main();
  // Music is a module singleton built on the FIRST import — a re-entered
  // game reuses its contexts, and only bgm's autoplay would have started
  // it. disposeGame stopped everything on leave, so replay the autoplay
  // ones here: bgm restarts with the new game, wx-style.
  for (const audio of liveAudio) {
    if (audio.autoplay) {
      audio.currentTime = 0;
      audio.play();
    }
  }
}
