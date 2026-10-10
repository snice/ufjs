// @ufjs/audio — createAudio() for fjs (specs/215).
//
// This module exists because its Flutter half carries a third-party pub
// dependency (audioplayers), and third-party deps stay out of the fjs core
// (constitution IX) — built-in host APIs are SDK-only, everything heavier
// ships as a module package.
//
// The entry is deliberately SELF-CONTAINED: it imports nothing from
// @ufjs/runtime (the @ufjs/webview / @ufjs/iconmind pattern), so bundling
// it never drags the core runtime into an mp chunk. What it needs from the
// runtime it reads off globals instead:
//
//   __fjs.fns.invokeHost            — installed by the C++ core
//   __fjsRegisterSystemHandler      — installed by the runtime when it
//                                     installs the event dispatcher; only
//                                     present on app targets, which is
//                                     exactly where the native gut runs
//
// One interface, three guts:
//
//   app (native host)   JS-allocated handle + fjs.audio.* host modules,
//                       ended/error arriving through the audio event
//                       (fjs.h FJS_EVENT_AUDIO = 45, dispatched by the
//                       fjs_audio Dart package, not by the core)
//   web                 HTMLAudioElement
//   mp (wx)             real wx.createInnerAudioContext, re-shaped —
//                       WeChat is the most complete audio end there is
//
// Deliberately NOT the full wx InnerAudioContext: obeyMuteSwitch, rate,
// buffered, onTimeUpdate and friends are out of scope for v1 — the surface
// is what games and notice sounds actually use. onPlay/onPause/onStop fire
// when the CALL is accepted, not as a playback-state receipt; only
// ended/error travel back from the host, because those are the two things
// JS cannot know on its own.

export const EVENT_AUDIO = 45;

/** Same rules as `<image>`'s src: the bundler gives every local file one
 * shape — a root-absolute path — and `asset://x` is the older spelling of
 * the same thing. Kept in step with the runtime's resolveImageSrc and the
 * Dart side's path normalization. */
function resolveSrc(src: string): string {
  if (!src.startsWith('asset://')) return src;
  return '/' + src.slice('asset://'.length).replace(/^\/+/, '');
}

export interface FjsAudio {
  /** Assigning loads the source (http(s) as-is, `/x` root-relative,
   * `asset://x` legacy spelling). Reassigning switches source; the config
   * below carries over. */
  src: string;
  loop: boolean;
  /** Plays as soon as the source has loaded. Applied when `src` is set —
   * wx code sets loop/autoplay BEFORE src, so order does not matter. */
  autoplay: boolean;
  /** 0–1. */
  volume: number;
  /** Seconds; 0 while unknown (the native host does not push duration in
   * v1 — the web and wx guts report it once metadata has loaded). */
  readonly duration: number;
  /** Seconds. Seekable before and during playback; wx's `= 0; play()`
   * replay idiom lands here. */
  currentTime: number;
  play(): void;
  pause(): void;
  /** Stops AND rewinds to 0, like wx's stop. */
  stop(): void;
  /** Releases the host-side player. The context is inert afterwards. */
  destroy(): void;
  onPlay: (() => void) | null;
  onPause: (() => void) | null;
  onStop: (() => void) | null;
  onEnded: (() => void) | null;
  onError: ((message: string) => void) | null;
}

// ---- host access (read off globals — see the header) ------------------------

type InvokeHostFn = (name: string, ...args: unknown[]) => unknown;

function nativeInvokeHost(): InvokeHostFn | null {
  const fns = (globalThis as { __fjs?: { fns?: { invokeHost?: InvokeHostFn } } }).__fjs?.fns;
  return typeof fns?.invokeHost === 'function' ? fns.invokeHost : null;
}

const hasNativeHost = nativeInvokeHost() !== null;

function invokeHost(name: string, ...args: unknown[]): void {
  nativeInvokeHost()!(name, ...args);
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

/** Test hook: deterministic handles and a clean dispatcher/warn state. */
export function resetAudioHandles(): void {
  nextHandle = 1;
  audios.clear();
  dispatcherReady = false;
  warned.clear();
}

const audios = new Map<number, FjsAudioNative>();
let nextHandle = 1;
let dispatcherReady = false;

type RegisterSystemHandler = (
  type: number,
  handler: (id: number, payload?: string) => void,
) => void;

function ensureDispatcher(): void {
  if (dispatcherReady) return;
  const register = (globalThis as { __fjsRegisterSystemHandler?: RegisterSystemHandler })
    .__fjsRegisterSystemHandler;
  if (typeof register !== 'function') {
    // app target but the runtime predates the global (or fjsrun): commands
    // still go out, completion events have nowhere to land — say so once,
    // and let the next src assignment try again
    warnOnce(
      'no-dispatcher',
      'audio: the running runtime does not expose __fjsRegisterSystemHandler — ' +
        'ended/onError will not fire; upgrade @ufjs/runtime',
    );
    return;
  }
  dispatcherReady = true;
  register(EVENT_AUDIO, (id, payload) => {
    const audio = audios.get(id);
    if (!audio) return; // destroyed, or the VM was rebuilt (reload)
    let message: { t?: string; err?: string } = {};
    try {
      message = JSON.parse(payload ?? '{}') as typeof message;
    } catch {
      return;
    }
    if (message.t === 'ended') {
      audio._rewind();
      audio.onEnded?.();
      return;
    }
    if (message.t === 'error') audio.onError?.(message.err ?? 'audio failed');
  });
}

// ---- native gut ------------------------------------------------------------

class FjsAudioNative implements FjsAudio {
  readonly handle = nextHandle++;

  private _src = '';
  private _loop = false;
  private _autoplay = false;
  private _volume = 1;
  private _currentTime = 0;
  private _created = false;
  private _dead = false;

  onPlay: (() => void) | null = null;
  onPause: (() => void) | null = null;
  onStop: (() => void) | null = null;
  onEnded: (() => void) | null = null;
  onError: ((message: string) => void) | null = null;

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    if (value === '') return;
    ensureDispatcher();
    try {
      if (!this._created) {
        this._created = true;
        audios.set(this.handle, this);
      }
      // Reassignment re-enters create with the SAME handle — the host
      // disposes the old player and loads fresh, so the whole load path
      // (bytes, error reporting, autoplay) stays single-tracked. Config
      // rides along every time, so property assignment order does not
      // matter — the wx idiom is loop/autoplay first, src last.
      invokeHost(
        'fjs.audio.create',
        this.handle,
        value,
        JSON.stringify({ loop: this._loop, autoplay: this._autoplay, volume: this._volume }),
      );
    } catch {
      this._degrade();
    }
  }

  get loop(): boolean {
    return this._loop;
  }

  set loop(value: boolean) {
    this._loop = value;
    this._cmd('loop', value);
  }

  get autoplay(): boolean {
    return this._autoplay;
  }

  set autoplay(value: boolean) {
    this._autoplay = value;
    // no cmd: read from the create config / on the next src switch
  }

  get volume(): number {
    return this._volume;
  }

  set volume(value: number) {
    this._volume = value;
    this._cmd('volume', value);
  }

  get duration(): number {
    return 0; // v1: the native host does not report it (see the class doc)
  }

  get currentTime(): number {
    return this._currentTime;
  }

  set currentTime(value: number) {
    this._currentTime = value;
    this._cmd('seek', value);
  }

  play(): void {
    if (!this._ready('play')) return;
    invokeHost('fjs.audio.cmd', this.handle, 'play');
    this.onPlay?.();
  }

  pause(): void {
    if (!this._ready('pause')) return;
    invokeHost('fjs.audio.cmd', this.handle, 'pause');
    this.onPause?.();
  }

  stop(): void {
    if (!this._ready('stop')) return;
    invokeHost('fjs.audio.cmd', this.handle, 'stop');
    this._currentTime = 0;
    this.onStop?.();
  }

  destroy(): void {
    if (this._created && !this._dead) {
      try {
        invokeHost('fjs.audio.dispose', this.handle);
      } catch {
        // host gone mid-teardown (reload) — the entry dies with its map
      }
      audios.delete(this.handle);
    }
    this._dead = true;
    this.onPlay = this.onPause = this.onStop = this.onEnded = this.onError = null;
  }

  /** @internal — the dispatcher rewinds on ended, wx-style. */
  _rewind(): void {
    this._currentTime = 0;
  }

  private _ready(what: string): boolean {
    if (this._dead) return false;
    if (!this._created || this._src === '') {
      warnOnce(
        `play-before-src-${this.handle}`,
        `audio.${what}() before a src is set — assign audio.src first`,
      );
      return false;
    }
    return true;
  }

  private _cmd(cmd: string, value?: string | number | boolean): void {
    if (!this._created || this._dead) return; // picked up at create instead
    try {
      if (value === undefined) invokeHost('fjs.audio.cmd', this.handle, cmd);
      else invokeHost('fjs.audio.cmd', this.handle, cmd, value);
    } catch {
      this._degrade();
    }
  }

  /** The host rejected a call (fjsrun, a pre-215 host, module not built):
   * say so once and turn inert rather than throwing into game code. */
  private _degrade(): void {
    if (this._dead) return;
    this._dead = true;
    audios.delete(this.handle);
    warnOnce(
      'no-audio-module',
      'audio: this host has no fjs.audio module — install @ufjs/audio in the ' +
        'host app (npm) and fjs_audio (pub), or upgrade fjs',
    );
    this.onError?.('audio unavailable on this host');
  }
}

// ---- web gut ---------------------------------------------------------------

type AudioElement = HTMLAudioElement & {
  loop: boolean;
  volume: number;
  currentTime: number;
  duration: number;
};

class FjsAudioWeb implements FjsAudio {
  private readonly el: AudioElement;
  private _autoplay = false;
  private _onEnded: (() => void) | null = null;
  private _onError: ((message: string) => void) | null = null;

  onPlay: (() => void) | null = null;
  onPause: (() => void) | null = null;
  onStop: (() => void) | null = null;

  constructor() {
    this.el = new Audio() as AudioElement;
    // element 'play'/'pause' events are NOT wired: onPlay/onPause/onStop
    // fire at the call site on all three guts (see the header comment)
    this.el.addEventListener('ended', () => {
      this._onEnded?.();
    });
    this.el.addEventListener('error', () => {
      this._onError?.(`audio load failed: ${this.el.src}`);
    });
  }

  get src(): string {
    return this.el.src;
  }

  set src(value: string) {
    if (value === '') return;
    this.el.src = resolveSrc(value);
    if (this._autoplay) this.play();
  }

  get loop(): boolean {
    return this.el.loop;
  }

  set loop(value: boolean) {
    this.el.loop = value;
  }

  get autoplay(): boolean {
    return this._autoplay;
  }

  set autoplay(value: boolean) {
    this._autoplay = value;
    if (value && this.el.src) this.play();
  }

  get volume(): number {
    return this.el.volume;
  }

  set volume(value: number) {
    this.el.volume = Math.min(1, Math.max(0, value));
  }

  get duration(): number {
    const d = this.el.duration;
    return Number.isFinite(d) ? d : 0;
  }

  get currentTime(): number {
    return this.el.currentTime;
  }

  set currentTime(value: number) {
    // assigning before the browser has metadata throws — drop it, the next
    // play() starts from wherever the element is (same as the DOM's rules)
    try {
      this.el.currentTime = value;
    } catch {
      /* metadata not loaded yet */
    }
  }

  play(): void {
    // Browser autoplay policies reject programmatic play before a user
    // gesture — an environmental limit, warned once, not an error thrown
    // into game code.
    this.el.play().catch(() => {
      warnOnce(
        'web-autoplay-blocked',
        'audio.play() was rejected by the browser autoplay policy — ' +
          'it will work once the page has had a user gesture',
      );
    });
    this.onPlay?.();
  }

  pause(): void {
    this.el.pause();
    this.onPause?.();
  }

  stop(): void {
    this.el.pause();
    try {
      this.el.currentTime = 0;
    } catch {
      /* metadata not loaded yet */
    }
    this.onStop?.();
  }

  destroy(): void {
    this.el.pause();
    this.el.removeAttribute('src');
    this._onEnded = this._onError = null;
    this.onPlay = this.onPause = this.onStop = null;
  }

  get onEnded(): (() => void) | null {
    return this._onEnded;
  }

  set onEnded(value: (() => void) | null) {
    this._onEnded = value;
  }

  get onError(): ((message: string) => void) | null {
    return this._onError;
  }

  set onError(value: ((message: string) => void) | null) {
    this._onError = value;
  }
}

// ---- wx gut ----------------------------------------------------------------

/** The slice of wx's InnerAudioContext this gut touches — declared here so
 * the package needs no @types/weixin-app. */
interface WxInnerAudioContext {
  src: string;
  loop: boolean;
  autoplay: boolean;
  volume: number;
  readonly duration: number;
  readonly currentTime: number;
  play(): void;
  pause(): void;
  stop(): void;
  seek(position: number): void;
  destroy(): void;
  onPlay(cb: () => void): void;
  onPause(cb: () => void): void;
  onStop(cb: () => void): void;
  onEnded(cb: () => void): void;
  onError(cb: (err: { errMsg?: string }) => void): void;
  offPlay(cb: () => void): void;
  offPause(cb: () => void): void;
  offStop(cb: () => void): void;
  offEnded(cb: () => void): void;
}

function wxCreateInnerAudio(): (() => WxInnerAudioContext) | null {
  const create = (globalThis as {
    wx?: { createInnerAudioContext?: () => WxInnerAudioContext };
  }).wx?.createInnerAudioContext;
  return typeof create === 'function' ? create : null;
}

/** wx registers one callback per onX call, so a FjsAudio callback PROPERTY
 * (reassignable) is bridged as off-previous/on-next. */
function bridgeCallback(
  ctx: WxInnerAudioContext,
  on: 'onPlay' | 'onPause' | 'onStop' | 'onEnded',
  off: 'offPlay' | 'offPause' | 'offStop' | 'offEnded',
): { get(): (() => void) | null; set(v: (() => void) | null): void } {
  let current: (() => void) | null = null;
  return {
    get: () => current,
    set(v) {
      if (current) ctx[off](current);
      current = v;
      if (v) ctx[on](v);
    },
  };
}

class FjsAudioWx implements FjsAudio {
  private readonly ctx: WxInnerAudioContext;
  private _userError: ((message: string) => void) | null = null;

  // onPlay/onPause/onStop/onEnded/onError are accessor pairs below (the
  // wx callbacks register through the bridges), not plain fields

  private readonly _play: ReturnType<typeof bridgeCallback>;
  private readonly _pause: ReturnType<typeof bridgeCallback>;
  private readonly _stop: ReturnType<typeof bridgeCallback>;
  private readonly _ended: ReturnType<typeof bridgeCallback>;

  constructor() {
    const create = wxCreateInnerAudio()!;
    this.ctx = create();
    this._play = bridgeCallback(this.ctx, 'onPlay', 'offPlay');
    this._pause = bridgeCallback(this.ctx, 'onPause', 'offPause');
    this._stop = bridgeCallback(this.ctx, 'onStop', 'offStop');
    this._ended = bridgeCallback(this.ctx, 'onEnded', 'offEnded');
    // onError differs from the void callbacks: wx carries {errMsg}, the
    // FjsAudio face carries a bare message — one permanent wx registration
    // forwards into whatever callback is currently assigned
    this.ctx.onError((err) => {
      this._userError?.(err?.errMsg ?? 'audio error');
    });
  }

  get src(): string {
    return this.ctx.src;
  }

  set src(value: string) {
    this.ctx.src = resolveSrc(value);
  }

  get loop(): boolean {
    return this.ctx.loop;
  }

  set loop(value: boolean) {
    this.ctx.loop = value;
  }

  get autoplay(): boolean {
    return this.ctx.autoplay;
  }

  set autoplay(value: boolean) {
    this.ctx.autoplay = value;
  }

  get volume(): number {
    return this.ctx.volume;
  }

  set volume(value: number) {
    this.ctx.volume = value;
  }

  get duration(): number {
    return this.ctx.duration || 0;
  }

  get currentTime(): number {
    return this.ctx.currentTime;
  }

  set currentTime(value: number) {
    this.ctx.seek(value);
  }

  play(): void {
    this.ctx.play();
  }

  pause(): void {
    this.ctx.pause();
  }

  stop(): void {
    this.ctx.stop();
  }

  destroy(): void {
    this.ctx.destroy();
    this._userError = null;
  }

  get onPlay(): (() => void) | null {
    return this._play.get();
  }

  set onPlay(v: (() => void) | null) {
    this._play.set(v);
  }

  get onPause(): (() => void) | null {
    return this._pause.get();
  }

  set onPause(v: (() => void) | null) {
    this._pause.set(v);
  }

  get onStop(): (() => void) | null {
    return this._stop.get();
  }

  set onStop(v: (() => void) | null) {
    this._stop.set(v);
  }

  get onEnded(): (() => void) | null {
    return this._ended.get();
  }

  set onEnded(v: (() => void) | null) {
    this._ended.set(v);
  }

  get onError(): ((message: string) => void) | null {
    return this._userError;
  }

  set onError(v: ((message: string) => void) | null) {
    this._userError = v;
  }
}

// ---- factory ---------------------------------------------------------------

const INERT_MESSAGE =
  'audio: no native host, no Audio element and no wx in this environment — ' +
  'createAudio() is inert here';

function createInertAudio(): FjsAudio {
  warnOnce('inert-audio', INERT_MESSAGE);
  return {
    src: '',
    loop: false,
    autoplay: false,
    volume: 1,
    duration: 0,
    currentTime: 0,
    play(): void {},
    pause(): void {},
    stop(): void {},
    destroy(): void {},
    onPlay: null,
    onPause: null,
    onStop: null,
    onEnded: null,
    onError: null,
  } as unknown as FjsAudio;
}

/** Gut order matters, and not just by preference: a page-level wx SHIM (the
 * plane-war adapter installs wx.createInnerAudioContext implemented AS
 * createAudio()) must not hijack the web gut into infinite recursion, so
 * the browser's own Audio wins wherever it exists. mp has no Audio global —
 * wx is reached exactly there. Native wins over both (the app target). */
export function createAudio(): FjsAudio {
  if (hasNativeHost) return new FjsAudioNative();
  if (typeof Audio === 'function') return new FjsAudioWeb();
  if (wxCreateInnerAudio()) return new FjsAudioWx();
  return createInertAudio();
}
