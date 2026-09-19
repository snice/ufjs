// Synchronous layout reads, served by the host's geometry module
// (flutter_fjs/lib/src/geometry.dart). Component libraries measure before
// they act — vant's Rate reads each star's rect on a click, its Slider turns
// `clientX - rect.left` into a value — and the DOM answers synchronously, so
// these do too. The answer is the LAST FRAME's layout: unlike the DOM there
// is no forced synchronous reflow (layout lives on the other side of the
// bridge), which is what those libraries measure anyway — a box that is
// already on screen. Coordinates are logical pixels in the window, the same
// space touch events report.
import { hasNativeHost, invokeHost } from '../host';

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
  const r = hostNumbers('fjs.ui.rect', id);
  return r && r.length === 4 ? makeRect(r[0], r[1], r[2], r[3]) : makeRect(0, 0, 0, 0);
}

/** Where the last pointer went down or up — a tap's position, for the
 * click event's clientX/clientY. Null before the first touch. */
export function lastPointer(): { x: number; y: number } | null {
  const p = hostNumbers('fjs.ui.pointer');
  return p && p.length === 2 ? { x: p[0], y: p[1] } : null;
}
