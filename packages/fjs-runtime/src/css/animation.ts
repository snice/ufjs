// CSS animations: the `animation` shorthand and `@keyframes` blocks.
//
// The engine only resolves them; the peer runs them. A computed style that
// names an animation carries its longhands plus an `animationKeyframes` map
// (name → frames) and the native side ticks it without a JS round trip per
// frame — vant's loading spinner (`van-rotate` on the box, `van-circular`
// on the svg circle's stroke dashes) runs for as long as it is on screen.
//
// Expansion happens at parse time, like `font` (font-shorthand.ts), so the
// cascade keeps its order: vant writes `animation: van-rotate .8s linear
// infinite` on `.van-loading__spinner` and overrides only
// `animation-duration: 2s` on the `--circular` modifier.

/** The longhands the shorthand resets, every one of them, every time. */
export const ANIMATION_LONGHANDS = [
  'animationName',
  'animationDuration',
  'animationTimingFunction',
  'animationDelay',
  'animationIterationCount',
  'animationDirection',
  'animationFillMode',
  'animationPlayState',
] as const;
export type AnimationLonghand = (typeof ANIMATION_LONGHANDS)[number];

/** Prefix of a longhand value still waiting for var() substitution. */
export const ANIMATION_PENDING = ' animation ';

const INITIAL: Record<AnimationLonghand, string> = {
  animationName: 'none',
  animationDuration: '0s',
  animationTimingFunction: 'ease',
  animationDelay: '0s',
  animationIterationCount: '1',
  animationDirection: 'normal',
  animationFillMode: 'none',
  animationPlayState: 'running',
};

const TIMING_WORDS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end']);
const DIRECTION_WORDS = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse']);
const FILL_WORDS = new Set(['none', 'forwards', 'backwards', 'both']);
const PLAY_WORDS = new Set(['running', 'paused']);
const TIME = /^-?(\d+\.?\d*|\.\d+)m?s$/i;
const NUMBER = /^(\d+\.?\d*|\.\d+)$/;

/** Splits on top-level commas / whitespace (never inside parentheses). */
function split(text: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && sep.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Expands `animation: <one>[, <two>…]` into comma-joined longhands.
 * Keyword ambiguity follows the spec's reading order: the first time is the
 * duration, the second the delay, and an identifier that is none of the
 * keywords is the name. */
export function parseAnimationShorthand(value: string): Record<AnimationLonghand, string> {
  const lists: Record<AnimationLonghand, string[]> = {
    animationName: [],
    animationDuration: [],
    animationTimingFunction: [],
    animationDelay: [],
    animationIterationCount: [],
    animationDirection: [],
    animationFillMode: [],
    animationPlayState: [],
  };
  for (const layer of split(value, /,/)) {
    const one: Partial<Record<AnimationLonghand, string>> = {};
    for (const token of split(layer, /\s/)) {
      const t = token.toLowerCase();
      if (TIME.test(t)) {
        if (one.animationDuration === undefined) one.animationDuration = token;
        else one.animationDelay ??= token;
      } else if (
        one.animationTimingFunction === undefined &&
        (TIMING_WORDS.has(t) || /^(cubic-bezier|steps)\(/.test(t))
      ) {
        one.animationTimingFunction = token;
      } else if (one.animationIterationCount === undefined && (t === 'infinite' || NUMBER.test(t))) {
        one.animationIterationCount = token;
      } else if (one.animationDirection === undefined && DIRECTION_WORDS.has(t)) {
        one.animationDirection = token;
      } else if (one.animationFillMode === undefined && FILL_WORDS.has(t) && t !== 'none') {
        one.animationFillMode = token;
      } else if (one.animationPlayState === undefined && PLAY_WORDS.has(t)) {
        one.animationPlayState = token;
      } else if (one.animationName === undefined) {
        one.animationName = token;
      }
    }
    for (const k of ANIMATION_LONGHANDS) lists[k].push(one[k] ?? INITIAL[k]);
  }
  const out = {} as Record<AnimationLonghand, string>;
  for (const k of ANIMATION_LONGHANDS) out[k] = lists[k].length ? lists[k].join(', ') : INITIAL[k];
  return out;
}

/** One `@keyframes` block: frames sorted by offset (0..1), each with its
 * declarations as parsed (var() still unresolved). */
export interface KeyframesDecl {
  name: string;
  frames: { offset: number; decls: Record<string, unknown> }[];
}

/** Parses the content of `@keyframes <name> { … }`. [parseDecls] is the
 * stylesheet's own declaration parser, so values come out normalized the
 * same way rule declarations do. */
export function parseKeyframes(
  name: string,
  block: string,
  parseDecls: (text: string) => Record<string, unknown>,
): KeyframesDecl {
  const byOffset = new Map<number, Record<string, unknown>>();
  let i = 0;
  while (i < block.length) {
    const open = block.indexOf('{', i);
    if (open < 0) break;
    const close = block.indexOf('}', open);
    const selector = block.slice(i, open).trim();
    const decls = parseDecls(block.slice(open + 1, close < 0 ? block.length : close));
    i = close < 0 ? block.length : close + 1;
    for (const part of selector.split(',')) {
      const p = part.trim().toLowerCase();
      const offset = p === 'from' ? 0 : p === 'to' ? 1 : p.endsWith('%') ? parseFloat(p) / 100 : NaN;
      if (!Number.isFinite(offset) || offset < 0 || offset > 1) continue;
      // repeated selectors cascade: the later block wins per property
      byOffset.set(offset, { ...(byOffset.get(offset) ?? {}), ...decls });
    }
  }
  const frames = [...byOffset.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([offset, decls]) => ({ offset, decls }));
  return { name: name.trim().replace(/^["']|["']$/g, ''), frames };
}
