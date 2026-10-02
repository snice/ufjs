// getContext is a registry, not a switch.
//
// `canvas.getContext('2d')` is one member of a family the web keeps
// extending — 'webgl', 'webgl2', 'webgpu', 'bitmaprenderer'. Only '2d' is
// implemented here (spec 019); 'webgl'/'webgl2' arrive as the @ufjs/webgl
// MODULE (spec 022), which registers them into this registry on import —
// apps that never import it pay nothing, and a context type is exactly the
// kind of thing that should arrive as a module: the WebGL context needed a
// different host widget, a different command protocol and a much larger
// surface, and none of that touched the `canvas` tag, the element layer or
// this file's callers.
//
// So the tag knows about "context types" and nothing else, and an
// unregistered type is a warn-once + null on BOTH platforms. The web build
// could hand back real contexts for anything the browser has — and that is
// precisely why it does not: a page that works in the browser and paints
// nothing in the app is the failure constitution I exists to prevent.
import type { CanvasSurface } from './context-2d';
import { warnCanvasOnce } from './warn';

/** What a factory is handed. Exactly one of `surface` / `domCanvas` is set:
 * the Flutter path draws through a display list, the web path through the
 * browser's own context. */
export interface CanvasContextTarget {
  /** The object pages see as `canvas` (and as `ctx.canvas`). */
  canvas: unknown;
  /** Flutter path. */
  surface?: CanvasSurface;
  /** Web path: the real <canvas>. */
  domCanvas?: {
    getContext(type: string, attrs?: unknown): unknown;
  };
}

export type CanvasContextFactory = (
  target: CanvasContextTarget,
  attributes?: unknown,
) => unknown;

const factories = new Map<string, CanvasContextFactory>();

/** Registers an implementation for a context type. This is the seam a
 * future `@ufjs/webgl` plugs into; nothing else about `canvas` changes. */
export function registerContextType(
  type: string,
  factory: CanvasContextFactory,
): void {
  factories.set(type, factory);
}

export function hasContextType(type: string): boolean {
  return factories.has(type);
}

/** Resolves a context, caching per (canvas, type) — the DOM returns the same
 * object every time, and a page that calls getContext twice must not end up
 * with two independent state machines. */
/** Per-canvas context type that already claimed the surface. A DOM canvas
 * hands out contexts of exactly one kind — after `getContext('webgl')` the
 * same canvas returns null for `'2d'`, and vice versa. Only a SUCCESSFUL
 * factory call claims; a warn-once null for an unimplemented type does not
 * (a page probing `getContext('webgpu')` should not lock its canvas out). */
const claimed = new WeakMap<Map<string, unknown>, string>();

export function resolveContext(
  cache: Map<string, unknown>,
  type: string,
  target: CanvasContextTarget,
  attributes?: unknown,
): unknown {
  const cached = cache.get(type);
  if (cached !== undefined) return cached;
  const owner = claimed.get(cache);
  if (owner !== undefined && owner !== type) {
    warnCanvasOnce(
      `context:${type}`,
      `canvas.getContext("${type}") returns null: this canvas already ` +
        `created a "${owner}" context. A DOM canvas hands out one kind of ` +
        'context per element, and so do we (on both platforms).',
    );
    cache.set(type, null);
    return null;
  }
  // the browser's own 2d context on web; on Flutter canvas/surface.ts
  // registers the display-list one when the canvas component brings it in
  // (specs/185 — no top-level registration here, so an app that never
  // draws does not carry the 2d implementation)
  const factory = factories.get(type) ?? (type === '2d' && target.domCanvas ? domCanvas2d : undefined);
  if (!factory) {
    warnCanvasOnce(
      `context:${type}`,
      `canvas.getContext("${type}") is not supported by fjs; see ` +
        'docs/canvas-compat.md. Returning null on both Flutter and web so ' +
        'a page behaves the same on either.',
    );
    cache.set(type, null);
    return null;
  }
  const context = factory(target, attributes);
  cache.set(type, context);
  if (context !== null) claimed.set(cache, type);
  return context;
}

const domCanvas2d: CanvasContextFactory = (target) => target.domCanvas?.getContext('2d') ?? null;
