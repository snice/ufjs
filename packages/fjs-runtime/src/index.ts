// @ufjs/runtime — JS runtime for the flutter_fjs native host.
//
// User-facing surface:
//   import { h, create, setProps, setText } from 'fjs';        // element API
//   import { createApp, flutterRoot } from 'fjs/vue';          // Vue 3 renderer
//   import { invokeHost } from 'fjs';                          // host modules
//   import { fetch } from 'fjs';                               // HTTP (also global)
import './raf';
// spec 089/090: the DevTools data plane (__fjsDevtools — Elements/Network
// serialization the `fjs debug` relay evaluates). Bundled only where the
// bundler sets __FJS_DEVTOOLS__=true; plain/release builds DCE it away.
import { bootIfEnabled } from './devtools';
bootIfEnabled();

export { h, create, createRoot, insert, remove, setText, setProps, setStyle, flush } from './ui/element';
export type { Element, CanvasElement } from './ui/element';
// canvas: the page-facing half. The display-list encoder and the surface
// bookkeeping stay internal — a page reaches them through getContext().
export { FjsPath2D as Path2D } from './canvas/path2d';
export { registerContextType, resolveContext, hasContextType } from './canvas/context-registry';
export { loadCanvasImage, FjsCanvasImage } from './canvas/image';
// canvas internals a context MODULE (@ufjs/webgl) builds on: the byte
// buffer the display list uses, the synchronous frame push its sync queries
// need, and the surface/target shapes its factory receives. WebGL's own
// implementation lives in @ufjs/webgl (spec 022).
export { ByteBuf } from './canvas/display-list';
// utf8Decode is exported for polyfills that must offer the DOM's TextDecoder
// on the native host (three.js's GLTFLoader path, spec 023) — the runtime's
// own decoding never goes through a class-shaped global.
export { utf8Encode, utf8Decode, utf8DecodeBytes } from './ui/utf8';
// base64Encode feeds polyfills that hand the host's image loader in-memory
// bytes as a data: URL (three.js's createImageBitmap path, spec 023).
export { base64Encode } from './net/base64';
export { flushNow, getWriter } from './host';
export type { OpWriter } from './ui/ops';
export type { CanvasSurface } from './canvas/context-2d';
export type { FjsCanvasOpWriter } from './canvas/surface';
export type { CanvasContextTarget } from './canvas/context-registry';
export type {
  FjsCanvasApi,
  FjsCanvasContext2D,
  FjsCanvasGradient,
  FjsCanvasImageSource,
  FjsCanvasPattern,
  FjsCanvasTextMetrics,
} from './canvas/types';
export { invokeHost, nowMs, gc, engineInfo, setTimeout, setInterval, clearTimeout, clearInterval, toast, setToastHandler, hasNativeHost, setOpSink } from './host';
// Promise-shaped host module calls (spec 039); rejects without a native host
export { invokeHostAsync } from './host-async';
export { Worker } from './worker';
export { fetch, FjsHeaders as Headers, FjsResponse as Response, FjsAbortController as AbortController } from './net/fetch';
export type { FjsRequestInit as RequestInit, FjsHeadersInit as HeadersInit, FjsAbortSignal as AbortSignal } from './net/fetch';
export { UiOp } from './ui/ops';
export type { FjsImagePath, FjsHtmlPath, FjsImageSrc, FjsHtmlSrc } from './assets';
export type { RichTextNode, RichTextElementNode, RichTextTextNode, RichTextSpace } from './rich-text/types';
// Framework-agnostic style engine: the Vue renderer drives this instance,
// and any other adapter (or a benchmark) constructs its own the same way —
// see docs/custom-renderer.md.
export { StyleEngine } from './css/style';
export type { CssRule, Selector } from './css/parser';
export type { FjsTouch, FjsTouchEvent, FjsTouchType, FjsEventTarget } from './ui/touch';
