// Synchronous layout reads, served by the host's geometry module
// (flutter_fjs/lib/src/geometry.dart). Component libraries measure before
// they act — vant's Rate reads each star's rect on a click, its Slider turns
// `clientX - rect.left` into a value — and the DOM answers synchronously, so
// these do too. Like the DOM, a read forces a synchronous reflow: pending
// ops are flushed first and the host lays out what they changed before it
// measures (specs/073 — vant's collapse un-hides its content and reads
// `offsetHeight` in the same tick; the last frame's layout said 0 and the
// height transition was skipped). Coordinates are logical pixels in the
// window, the same space touch events report.
import { flushNow, hasNativeHost, invokeHost } from '../host';

/** The DOMRect subset libraries read. */
export interface FjsRect {
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

function makeRect(left: number, top: number, width: number, height: number): FjsRect {
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height };
}

/** Parses the host's `"[a,b,…]"` answer; null when absent (a node not laid
 * out yet, a host without the module, no host at all). */
function hostNumbers(name: string, ...args: number[]): number[] | null {
  if (!hasNativeHost) return null;
  try {
    const raw = invokeHost<string | null>(name, ...args);
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number') ? (parsed as number[]) : null;
  } catch {
    // an older host without the module: measure as the DOM does a
    // detached node — an all-zero rect, never a throw
    return null;
  }
}

/** The element's border box, like DOM getBoundingClientRect(). All zeros
 * when the node is not laid out (the DOM's answer for a detached or
 * `display: none` element). */
export function boundingRectOf(id: number): FjsRect {
  // the host can only lay out what it has been sent
  if (hasNativeHost) flushNow();
  const r = hostNumbers('fjs.ui.rect', id);
  return r && r.length === 4 ? makeRect(r[0], r[1], r[2], r[3]) : makeRect(0, 0, 0, 0);
}

/** A paragraph's laid-out size at [maxWidth] (0 = no wrapping), measured
 * by the host without a node: what DOM code gets from a detached `<div>`'s
 * offsetWidth/offsetHeight after setting its text. [style] is a resolved
 * style map (camelCase, lengths as numbers — the style engine's `computed`),
 * laid out with the same TextStyle a text node renders with. Null without a
 * host that has the module (specs/128). */
export function measureTextBlock(
  style: Record<string, unknown>,
  text: string,
  maxWidth = 0,
): { width: number; height: number; lines: number } | null {
  if (!hasNativeHost) return null;
  let raw: unknown;
  try {
    raw = invokeHost<string | null>('fjs.ui.measureText', JSON.stringify(style), text, maxWidth);
  } catch {
    return null;
  }
  if (typeof raw !== 'string') return null;
  const r = JSON.parse(raw) as unknown;
  return Array.isArray(r) && r.length === 3 && r.every((n) => typeof n === 'number')
    ? { width: r[0], height: r[1], lines: r[2] }
    : null;
}

/** Where the last pointer went down or up — a tap's position, for the
 * click event's clientX/clientY. Null before the first touch. */
export function lastPointer(): { x: number; y: number } | null {
  const p = hostNumbers('fjs.ui.pointer');
  return p && p.length === 2 ? { x: p[0], y: p[1] } : null;
}
