// fetch() for the native host. WHATWG-shaped subset, backed by Dart's
// HttpClient — QuickJS has no sockets, so every request crosses the same
// two channels the rest of the runtime uses:
//
//   JS -> Dart   invokeHost('fjs.http.request', id, requestJson)
//                invokeHost('fjs.http.abort', id)
//   Dart -> JS   dispatchEvent(id, 14 /* httpResponse */, responseJson)
//
// The request is fire-and-forget on the JS side: invokeHost returns as soon
// as Dart has started it, and the promise settles when the response event
// arrives. Binary bodies cross as HANDLES (spec 038, ABI 2): JS/Dart each
// put the bytes into the VM's table once and from then on only an int id
// travels — where the v1 path paid base64-inside-JSON on both directions.
// When the loaded engine predates handles, bodies fall back to base64 in
// the descriptor; a handle arriving without engine support is loud, never
// an empty body (constitution V).
//
// On web there is no native host and the browser's own fetch is used, so
// app code calls one fetch on both targets.
import { hasNativeHost, invokeHost } from '../host';
import { registerSystemHandler } from '../ui/element';
import { utf8Decode, utf8Encode } from '../ui/utf8';
import { base64Decode, base64Encode } from './base64';
import { devtoolsSlots } from '../devtools-hooks';

const EVENT_HTTP_RESPONSE = 14;

export type FjsHeadersInit =
  | FjsHeaders
  | Record<string, string>
  | readonly (readonly [string, string])[];

/** Case-insensitive header map (the fields of WHATWG Headers this runtime
 * needs; no guards, no CORS-forbidden-name filtering). */
export class FjsHeaders {
  /** lowercased name -> [original name, value] */
  private readonly map = new Map<string, [string, string]>();

  constructor(init?: FjsHeadersInit) {
    if (!init) return;
    if (init instanceof FjsHeaders) {
      init.forEach((value, name) => this.append(name, value));
    } else if (Array.isArray(init)) {
      for (const pair of init as readonly (readonly [string, string])[]) {
        this.append(pair[0], pair[1]);
      }
    } else {
      for (const name of Object.keys(init as Record<string, string>)) {
        this.append(name, (init as Record<string, string>)[name]);
      }
    }
  }

  get(name: string): string | null {
    return this.map.get(String(name).toLowerCase())?.[1] ?? null;
  }

  has(name: string): boolean {
    return this.map.has(String(name).toLowerCase());
  }

  set(name: string, value: string): void {
    this.map.set(String(name).toLowerCase(), [String(name), String(value)]);
  }

  /** Repeated names join with ", " — how they arrive from Dart too. */
  append(name: string, value: string): void {
    const key = String(name).toLowerCase();
    const prev = this.map.get(key);
    if (prev) prev[1] = `${prev[1]}, ${String(value)}`;
    else this.map.set(key, [String(name), String(value)]);
  }

  delete(name: string): void {
    this.map.delete(String(name).toLowerCase());
  }

  forEach(fn: (value: string, name: string, headers: FjsHeaders) => void): void {
    for (const [key, entry] of this.map) fn(entry[1], key, this);
  }

  *entries(): IterableIterator<[string, string]> {
    for (const [key, entry] of this.map) yield [key, entry[1]];
  }

  *keys(): IterableIterator<string> {
    for (const key of this.map.keys()) yield key;
  }

  *values(): IterableIterator<string> {
    for (const entry of this.map.values()) yield entry[1];
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  /** Wire form: original-cased name -> value. */
  toJSON(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const entry of this.map.values()) out[entry[0]] = entry[1];
    return out;
  }
}

/** Whether the loaded engine speaks the binary-handle ABI (2). Bodies
 * fall back to base64 when it does not — and a handle arriving anyway is
 * an error, not an empty body (constitution V). */
function supportsByteHandles(): boolean {
  return (
    hasNativeHost &&
    __fjs !== undefined &&
    __fjs.fns.engine.abiVersion >= 2 &&
    typeof __fjs.fns.readHandleBytes === 'function'
  );
}

/** Same precondition as [supportsByteHandles], but it also gives the caller
 * a narrowed `fns` (and throws — loudly — when called without checking). */
function byteHandleFns(): FjsNativeFns {
  const fns = hasNativeHost ? __fjs?.fns : undefined;
  if (!fns || fns.engine.abiVersion < 2 || typeof fns.readHandleBytes !== 'function') {
    throw new TypeError(
      'fetch: binary handles unavailable — the engine predates FJS_ABI_VERSION 2',
    );
  }
  return fns;
}

export class FjsResponse {
  constructor(
    /** Null when the body arrives as a handle. */
    bytes: Uint8Array | null,
    init: {
      status: number;
      statusText: string;
      headers: FjsHeaders;
      url: string;
      redirected: boolean;
    },
    handle: number | null = null,
  ) {
    this.bodyCache = bytes ?? undefined;
    this.bodyHandle = handle;
    this.status = init.status;
    this.statusText = init.statusText;
    this.headers = init.headers;
    this.url = init.url;
    this.redirected = init.redirected;
  }

  readonly status: number;
  readonly statusText: string;
  readonly headers: FjsHeaders;
  readonly url: string;
  readonly redirected: boolean;
  readonly type = 'default';

  /** The C++-side bytes, materialized on first body read. Once read, the
   * bytes live here and the handle is released — later reads cost nothing
   * and nothing new can fail, which is why this stays sync. */
  private bodyCache: Uint8Array | undefined;
  private readonly bodyHandle: number | null;

  /** Bodies arrive whole, so nothing is ever consumed — kept for shape. */
  readonly bodyUsed = false;

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  /** Pulls the body into JS memory exactly once. The C++ buffer is
   * released as soon as the copy exists; an unconsumed response keeps its
   * handle until the VM dies — the one registered retention (see
   * docs/jsi-and-native-modules.md). */
  private materialize(): Uint8Array {
    if (this.bodyCache) return this.bodyCache;
    if (this.bodyHandle == null) return new Uint8Array(0);
    if (!supportsByteHandles()) {
      throw new TypeError(
        'fetch: response body arrived as a binary handle but this runtime ' +
          'predates them — upgrade @ufjs/runtime to match the flutter_fjs host',
      );
    }
    const fns = byteHandleFns();
    const buf = fns.readHandleBytes(this.bodyHandle);
    fns.releaseHandle(this.bodyHandle);
    this.bodyCache = new Uint8Array(buf);
    // spec 089: the app read the body — THIS is the copy the Network panel
    // records. Capturing here (not at response time) sidesteps both the
    // empty-borrow race on fresh handles and giant speculative copies.
    devtoolsSlots.netBodyMaterialized(this.bodyHandle, this.bodyCache);
    return this.bodyCache;
  }

  text(): Promise<string> {
    return Promise.resolve(utf8Decode(this.materialize()));
  }

  json(): Promise<unknown> {
    return this.text().then((t) => JSON.parse(t));
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = this.materialize();
    return Promise.resolve(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
  }

  /** The body is a plain buffer here, so a clone shares it (and materializes
   * eagerly — two clones could not safely share one handle). */
  clone(): FjsResponse {
    return new FjsResponse(this.materialize(), {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
      url: this.url,
      redirected: this.redirected,
    });
  }

  bytesBody(): Promise<Uint8Array> {
    return Promise.resolve(this.materialize());
  }
}

// ---- AbortController -------------------------------------------------------
// QuickJS ships none, and without one there is no way to cancel a request or
// hang a timeout off it. Minimal, and only installed as a global when the
// engine has nothing there already.

export interface FjsAbortSignal {
  aborted: boolean;
  reason?: unknown;
  addEventListener?(type: 'abort', listener: () => void): void;
  removeEventListener?(type: 'abort', listener: () => void): void;
  // loose enough to accept a DOM AbortSignal, whose handler takes an Event
  onabort?: ((...args: never[]) => unknown) | null;
}

class AbortSignalImpl implements FjsAbortSignal {
  aborted = false;
  reason: unknown = undefined;
  onabort: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  addEventListener(type: 'abort', listener: () => void): void {
    if (type === 'abort') this.listeners.add(listener);
  }

  removeEventListener(type: 'abort', listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** @internal */
  fire(reason: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason;
    this.onabort?.();
    for (const l of [...this.listeners]) l();
    this.listeners.clear();
  }
}

export class FjsAbortController {
  readonly signal: FjsAbortSignal = new AbortSignalImpl();

  abort(reason?: unknown): void {
    (this.signal as AbortSignalImpl).fire(
      reason ?? new Error('The operation was aborted'),
    );
  }
}

// ---- request ---------------------------------------------------------------

export interface FjsRequestInit {
  method?: string;
  headers?: FjsHeadersInit;
  body?: string | Uint8Array | ArrayBuffer | null;
  /** 'follow' (default) or 'manual' — 'manual' returns the 3xx itself. */
  redirect?: 'follow' | 'manual';
  signal?: FjsAbortSignal | null;
  /** fjs extension: fail the request after this many ms. */
  timeout?: number;
}

interface WireResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  redirected?: boolean;
  headers?: Record<string, string>;
  bodyBase64?: string;
  /** Binary-handle ABI: the body's id in the VM's byte table. */
  handle?: number | null;
  error?: string;
}

interface Pending {
  resolve: (res: FjsResponse) => void;
  reject: (err: unknown) => void;
  detach: () => void;
}

const pending = new Map<number, Pending>();
let nextRequestId = 1;
let dispatcherReady = false;

function ensureDispatcher(): void {
  if (dispatcherReady) return;
  dispatcherReady = true;
  registerSystemHandler(EVENT_HTTP_RESPONSE, (id, payload) => {
    const entry = pending.get(id);
    if (!entry) return; // aborted, or a late duplicate
    pending.delete(id);
    entry.detach();
    let wire: WireResponse;
    try {
      wire = JSON.parse(payload ?? '{}') as WireResponse;
    } catch (e) {
      entry.reject(new TypeError(`fetch: malformed response payload (${String(e)})`));
      return;
    }
    if (wire.ok === false || wire.error) {
      entry.reject(new TypeError(wire.error ?? 'fetch failed'));
      return;
    }
    const handle = typeof wire.handle === 'number' ? wire.handle : null;
    if (handle != null && !supportsByteHandles()) {
      entry.reject(
        new TypeError(
          'fetch: response body arrived as a binary handle but this runtime ' +
            'predates them — upgrade @ufjs/runtime to match the flutter_fjs host',
        ),
      );
      return;
    }
    entry.resolve(
      new FjsResponse(
        handle == null && wire.bodyBase64
          ? base64Decode(wire.bodyBase64)
          : null,
        {
          status: wire.status ?? 0,
          statusText: wire.statusText ?? '',
          headers: new FjsHeaders(wire.headers),
          url: wire.url ?? '',
          redirected: wire.redirected ?? false,
        },
        handle,
      ),
    );
    // spec 089: after resolve — the devtools body borrow must not precede
    // the app's own materialization options
    devtoolsSlots.netResponse({
      id,
      url: wire.url ?? '',
      status: wire.status ?? 0,
      statusText: wire.statusText ?? '',
      headers: wire.headers ?? {},
      bodyBase64: wire.bodyBase64,
      handle,
    });
  });
}

/** Encodes the request body into the descriptor. Handles when the engine
 * supports them (one copy into the table, no base64, no JSON escaping);
 * base64 keeps older hosts working. */
function encodeBody(
  body: FjsRequestInit['body'],
): { bodyBase64?: string; bodyHandle?: number } {
  if (body == null || body === '') return {};
  const toBytes = (): Uint8Array => {
    if (typeof body === 'string') return utf8Encode(body);
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    throw new TypeError('fetch: body must be a string, Uint8Array or ArrayBuffer');
  };
  const bytes = toBytes();
  if (supportsByteHandles()) {
    return { bodyHandle: byteHandleFns().handleBytes(bytes) };
  }
  return { bodyBase64: base64Encode(bytes) };
}

/** WHATWG fetch, minus streaming: the response body arrives whole. On web
 * this forwards to the browser's fetch. */
export function fetch(input: string, init: FjsRequestInit = {}): Promise<FjsResponse> {
  // checked before either path: a browser fetch rejects an already-aborted
  // signal itself, but only after it has been handed the request
  const signal = init.signal ?? null;
  if (signal?.aborted) {
    return Promise.reject(abortError(signal.reason));
  }
  if (!hasNativeHost) return webFetch(input, init);

  const url = String(input);
  ensureDispatcher();
  const id = nextRequestId++;
  const headers = new FjsHeaders(init.headers);

  let payload: string;
  try {
    payload = JSON.stringify({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: headers.toJSON(),
      ...encodeBody(init.body),
      followRedirects: init.redirect !== 'manual',
      timeoutMs: typeof init.timeout === 'number' ? init.timeout : undefined,
    });
  } catch (e) {
    return Promise.reject(e);
  }

  return new Promise<FjsResponse>((resolve, reject) => {
    let onAbort: (() => void) | null = null;
    const detach = () => {
      if (onAbort && signal?.removeEventListener) {
        signal.removeEventListener('abort', onAbort);
      }
      onAbort = null;
    };
    pending.set(id, { resolve, reject, detach });
    devtoolsSlots.netRequest({
      id,
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: headers.toJSON(),
    });

    if (signal?.addEventListener) {
      onAbort = () => {
        if (!pending.delete(id)) return;
        detach();
        try {
          invokeHost('fjs.http.abort', id);
        } catch {
          // the request already finished on the Dart side
        }
        reject(abortError(signal.reason));
      };
      signal.addEventListener('abort', onAbort);
    }

    try {
      invokeHost('fjs.http.request', id, payload);
    } catch (e) {
      pending.delete(id);
      detach();
      reject(new TypeError(`fetch: ${String(e)}`));
    }
  });
}

/** Web path: the browser's fetch does the work, but two things this
 * runtime's fetch accepts are not things it accepts — `timeout`, which is
 * ours, and a signal from the runtime's own AbortController, which is not a
 * DOM AbortSignal. Both are bridged onto a real AbortController here, so
 * `import { fetch } from 'fjs'` behaves the same on both targets.
 *
 * (The *global* fetch on web is the browser's untouched — the runtime only
 * installs globals where the engine has none. Code that wants the extension
 * on both targets imports fetch from 'fjs'.) */
function webFetch(input: string, init: FjsRequestInit): Promise<FjsResponse> {
  const g = globalThis as unknown as {
    fetch?: (u: string, i?: unknown) => Promise<unknown>;
    AbortController?: new () => { abort(reason?: unknown): void; signal: FjsAbortSignal };
  };
  if (typeof g.fetch !== 'function') {
    return Promise.reject(new TypeError('fetch: no native host and no global fetch'));
  }
  const timeout = typeof init.timeout === 'number' ? init.timeout : 0;
  const outer = init.signal ?? null;
  if ((timeout <= 0 && !outer) || !g.AbortController) {
    return g.fetch(input, init) as Promise<FjsResponse>;
  }

  const controller = new g.AbortController();
  const onOuterAbort = () => controller.abort(outer?.reason);
  outer?.addEventListener?.('abort', onOuterAbort);

  const timer =
    timeout > 0
      ? setTimeout(() => controller.abort(timeoutError(timeout)), timeout)
      : null;

  return (g.fetch(input, { ...init, signal: controller.signal }) as Promise<FjsResponse>)
    .finally(() => {
      if (timer !== null) clearTimeout(timer as unknown as number);
      outer?.removeEventListener?.('abort', onOuterAbort);
    });
}

function timeoutError(ms: number): Error {
  const err = new Error(`request timed out after ${ms}ms`);
  err.name = 'TimeoutError';
  return err;
}

function abortError(reason: unknown): unknown {
  if (reason instanceof Error) return reason;
  const err = new Error(
    typeof reason === 'string' ? reason : 'The operation was aborted',
  );
  err.name = 'AbortError';
  return err;
}

// ---- globals ---------------------------------------------------------------
// Same rule as the timers in host.ts: only where there is a native host, and
// never over something the environment already provides.

if (hasNativeHost) {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.fetch !== 'function') g.fetch = fetch;
  if (typeof g.Headers !== 'function') g.Headers = FjsHeaders;
  if (typeof g.Response !== 'function') g.Response = FjsResponse;
  if (typeof g.AbortController !== 'function') g.AbortController = FjsAbortController;
}
