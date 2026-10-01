// The CSS half of the style engine (specs/172): the registered sheets, the
// cascade and the compute pipeline — everything that turns "these rules hit
// this element" into a style object. Two engines sit on it:
//   - StyleEngine (style.ts): the TS per-element engine — element state,
//     signatures, match / compute caches, dirty tracking, the flush. Tests,
//     hosts without libfjs-style and `fjs build --ts-style` harnesses.
//   - NativeStyleEngine (style-native.ts): libfjs-style keeps the per-element
//     half and calls back into buildMatch / computeResult. What a Flutter
//     build ships by default, so the TS per-element code stays out of it.
// What differs between them reaches this class through the hooks at the
// bottom; nothing here may assume per-element state exists.
import { camelize, normalizeValue, parseInlineCss, parseStylesheet, warnOnce, type CssRule } from './parser';
import { registerFontFace, type FontFaceDecl } from './font-face';
import type { KeyframesDecl } from './animation';
import { NativeStyleBackend } from './native-style';
import { getWriter } from '../host';

/** The viewport assumed before the host reports one. `fjsrun` never gets a
 * viewport event and web never feeds this engine (real CSS there), so the
 * value only matters to raw element-API users off-device; it matches the
 * most common phone portrait so `min-width: 600px` and friends judge the
 * way a page author expects. */
export const FALLBACK_VIEWPORT = { width: 390, height: 844 };

/** One resolved `@keyframes` frame as the peer receives it. */
interface AnimationFrame {
  offset: number;
  style: Record<string, unknown>;
}

/** Properties that inherit from parent to child, as in CSS.
 *
 * The Set is for `has`. The hot path in compute() walks the frozen array
 * by index — QuickJS allocates an iterator for `for-of` on a Set
 * (specs/084). Order is the declaration order below and must stay stable
 * so inherit copies stay comparable. */
export const INHERITABLE_KEYS = Object.freeze([
  'color',
  'fontSize',
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'whiteSpace',
]);
export const INHERITABLE = new Set<string>(INHERITABLE_KEYS);

/** Displays that make an element a flex container (the -webkit- prefix on
 * the VALUE, unlike property names, is not stripped by camelize). */
const FLEX_DISPLAYS = new Set(['flex', 'inline-flex', '-webkit-flex']);
/** text-align → justify-content for an inline-level box mapped to a
 * wrapping row (see compute): left/start is the row's default already. */
const INLINE_TEXT_ALIGN_JUSTIFY: Record<string, string> = {
  center: 'center',
  right: 'flex-end',
  end: 'flex-end',
};
/** CSS initial font-size; em lengths chain up to this through inheritance. */
const INITIAL_FONT_PX = 16;

// CSS allows a leading-dot decimal without an integer part (`.8em`) —
// vant uses it for every icon glyph size.
const EM_LENGTH = /^(-?\d*\.?\d+)em$/;
const EM_TOKEN = /(-?\d*\.?\d+)em\b/g;


/**
 * The CSS-wide `inherit` keyword: the property takes the parent's computed
 * value, for ANY property — not just the inheritable ones. The peer has no
 * notion of it (it would read "inherit" as an unparseable value and drop
 * the declaration), so it is resolved here; with nothing to inherit the
 * declaration goes, leaving the property at its initial value, as in CSS.
 *
 * `color: currentColor` is the same resolution for one property: the keyword
 * names the color itself, i.e. the inherited value. Left in place it would
 * ship the literal string and the peer's parser would fall back to black —
 * van-button's loading spinner paints in it (`.van-loading__spinner {
 * color: currentColor }`). `fill`/`stroke: currentColor` stay verbatim: the
 * svg painter resolves those against the node's color on purpose.
 */
function resolveInheritKeyword(
  target: Record<string, unknown>,
  parent: Record<string, unknown> | undefined,
): void {
  for (const k in target) {
    const v = target[k];
    const isInherit =
      v === 'inherit' || (k === 'color' && typeof v === 'string' && v.toLowerCase() === 'currentcolor');
    if (!isInherit) continue;
    const p = parent?.[k];
    if (p === undefined) delete target[k];
    else target[k] = p;
  }
}

/** `currentColor` in any other property — a border, a background, a
 * shadow — is the element's own resolved text color; the peer has no
 * currentColor, so it is substituted here. `color` itself went through
 * resolveInheritKeyword; `fill` / `stroke` stay verbatim on purpose (the
 * svg painter resolves them against the node's color, see above). */
function resolveCurrentColor(style: Record<string, unknown>): void {
  const color = style.color;
  if (typeof color !== 'string') return;
  for (const k in style) {
    if (k === 'color' || k === 'fill' || k === 'stroke') continue;
    const v = style[k];
    if (typeof v === 'string' && /currentcolor/i.test(v)) style[k] = v.replace(/currentcolor/gi, color);
  }
}

/** A computed font-size declaration resolved to px. Numbers are already px
 * (the parser normalized them); strings may still carry a unit because they
 * arrived inline or through a var(). */
function fontSizePx(value: unknown, parentPx: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const v = value.trim();
    if (/^-?\d*\.?\d+(px)?$/.test(v)) return parseFloat(v);
    if (/^-?\d*\.?\d+rem$/.test(v)) return parseFloat(v) * 16;
    if (/^-?\d*\.?\d+%$/.test(v)) return (parentPx * parseFloat(v)) / 100;
    if (EM_LENGTH.test(v)) return parentPx * parseFloat(v);
  }
  return parentPx;
}

/** Folds a calc() whose terms are all px into the resulting length.
 * Percent terms abort the fold — the peer's length parser resolves those at
 * layout time. The point of folding: contexts that parse plain lengths but
 * not calc() (a `translate(calc(…))` inside transform, for one). */
function foldAbsoluteCalc(value: string): string {
  // nested calc() unwraps innermost-first; a few passes cover any realistic
  // var()-substituted expression
  for (let pass = 0; pass < 4; pass++) {
    if (!value.includes('calc(')) return value;
    const next = foldAbsoluteCalcOnce(value);
    if (next === value) break;
    value = next;
  }
  return value;
}

/** `6px * -1`, `-1 * 6px`, `12px / 2` → one signed term. CSS only lets a
 * length be scaled by a plain number, so every product is length × number
 * (vant: `calc(var(--van-popover-arrow-size) * -1)`, specs/129). */
function foldProducts(expr: string): string {
  const N = '(-?\\d*\\.?\\d+)';
  const signed = (n: number, unit: string) => `${Math.round(n * 1000) / 1000}${unit}`;
  return expr
    .replace(new RegExp(`${N}(px|%)\\s*([*/])\\s*${N}(?![\\w%.])`, 'g'), (_, a: string, u: string, op: string, b: string) =>
      signed(op === '*' ? parseFloat(a) * parseFloat(b) : parseFloat(a) / parseFloat(b), u),
    )
    .replace(new RegExp(`(^|[^\\w.])${N}\\s*\\*\\s*${N}(px|%)`, 'g'), (_, pre: string, a: string, b: string, u: string) =>
      `${pre}${signed(parseFloat(a) * parseFloat(b), u)}`,
    );
}

function foldAbsoluteCalcOnce(value: string): string {
  return value.replace(/calc\(([^()]*)\)/g, (whole: string, rawExpr: string) => {
    const expr = rawExpr.includes('*') || rawExpr.includes('/') ? foldProducts(rawExpr).trim() : rawExpr;
    const re = /([+-]?)\s*(\d*\.?\d+)\s*(px|%)/g;
    let px = 0;
    let percent = 0;
    let consumed = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) {
      // the operator lands either between matches (`a - b`, the gap) or in
      // the optional sign group when it abuts the space before the number
      // (the regex eats `- ` into m[1]) — read both, or `50.8px - 26px`
      // silently turns into an addition (van-switch's knob flew off)
      const op = (expr.slice(consumed, m.index) + m[1]).replace(/\s+/g, '');
      consumed = m.index + m[0].length;
      // a folded product brings its own sign (`50% - -6px`): the run of
      // +/- signs multiplies out; anything else is not a sum we fold
      if (!/^[+-]*$/.test(op)) return whole;
      const sign = (op.split('-').length - 1) % 2 === 1 ? -1 : 1;
      const n = parseFloat(m[2]) * sign;
      if (m[3] === '%') percent += n;
      else px += n;
    }
    if (consumed !== expr.trim().length) return whole;
    if (percent !== 0) {
      // a percent term stays in the expression for the peer's resolver, but
      // the px terms can still collapse into one
      return `calc(${Math.round(percent * 1000) / 1000}% ${px < 0 ? '-' : '+'} ${Math.round(Math.abs(px) * 100) / 100}px)`;
    }
    return `${Math.round(px * 100) / 100}px`;
  });
}

/** The em unit resolves against the element's own computed font-size, so it
 * cannot be folded at parse time the way px/rem are: the font-size may come
 * from a var() or an inline declaration the parser never sees. vant sizes
 * whole components in em (van-switch is 2em × 1em), and a bare "2em" string
 * reaching the peer parses as an invalid length — the property is dropped
 * and the switch collapses to nothing. Runs after var() resolution, on the
 * object resolveVars returned (fresh whenever anything upstream changed).
 * lineHeight is left a string: the peer tells multipliers (a bare number)
 * from absolute heights ("Npx") apart. */
function resolveEm(style: Record<string, unknown>, parentPx: number): void {
  // `font-size: 50%` resolves against the parent's computed size, the same
  // job the em branch below does for em — but no EM_LENGTH match reaches a
  // bare percent, and one reaching the peer parses as an invalid length:
  // the property drops and the text falls to the peer's 14px default while
  // web's real CSS resolves it. Rewrite to px alongside the em case; a
  // child reads the same px either way (fontSizePx handled % already).
  const declared = style.fontSize;
  if (typeof declared === 'string' && /^-?\d*\.?\d+%$/.test(declared.trim())) {
    style.fontSize = Math.round(fontSizePx(declared, parentPx) * 100) / 100;
  }
  let own: number | undefined;
  for (const k in style) {
    const v = style[k];
    if (typeof v !== 'string') continue;
    let m = EM_LENGTH.exec(v);
    if (m !== null) {
      if (k === 'fontSize') {
        // fontSizePx already scaled the em against the parent; the same
        // resolved value feeds every other em declaration on this element
        own = fontSizePx(v, parentPx);
        style[k] = Math.round(own * 100) / 100;
        continue;
      }
      own ??= fontSizePx(style.fontSize, parentPx);
      const px = parseFloat(m[1]) * own;
      style[k] = k === 'lineHeight' ? `${Math.round(px * 100) / 100}px` : Math.round(px * 100) / 100;
      continue;
    }
    EM_TOKEN.lastIndex = 0;
    if (v.length < 6 || !EM_TOKEN.test(v)) continue;
    EM_TOKEN.lastIndex = 0;
    own ??= fontSizePx(style.fontSize, parentPx);
    style[k] = v.replace(EM_TOKEN, (_, n: string) => {
      const px = parseFloat(n) * own!;
      return `${Math.round(px * 100) / 100}px`;
    });
    // em folding can turn a calc into pure-absolute terms; collapsing those
    // keeps calc-averse contexts (transform function args) parseable
    if ((style[k] as string).includes('calc(')) style[k] = foldAbsoluteCalc(style[k] as string);
  }
}


/** One rule's DevTools matched-rules report (spec 092): selector source
 * texts, the indices that matched, and the rule's own declarations. */
export interface MatchedRuleReport {
  selectors: string[];
  matched: number[];
  decls: Record<string, unknown>;
}

/** Computed pseudo-element styles for one element, each already
 * var()-resolved and em-folded. `before`/`after` carry the element's
 * inheritable properties as the base (a pseudo-element inherits from its
 * originating element); `placeholder` holds ONLY its matched declarations —
 * CSS's UA default for the hint is grey rather than the inherited text
 * color, so a rule without `color` must leave the peer's pinned grey
 * placeholder alone (specs/100). */
export interface PseudoStyles {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  placeholder?: Record<string, unknown>;
  /** The box's whole style while its originating element is pressed
   * (`.x:active::before`), present only when such a rule matched. */
  activeBefore?: Record<string, unknown>;
  activeAfter?: Record<string, unknown>;
}

/** The element-side inputs of the compute pipeline (computeResult). */

/** One rule a match drew on, weighted by its best matching selector under
 * the cascade it joins (scope bump included). `state`: a pressed pseudo
 * variant reached through an :active selector (see scanPseudoBucket). */
export interface RuleHit {
  rule: CssRule;
  spec: number;
  state?: boolean;
}

/** The pseudo-element hit lists of one match, one per pseudo cascade. */
export type PseudoHits = Record<'before' | 'after' | 'placeholder' | 'activeBefore' | 'activeAfter', RuleHit[]>;

export interface MatchResult {
  decls: Record<string, unknown>;
  custom: Record<string, string>;
  /** The same cascade with the `:active` rules folded in, present only when
   * a selector actually matched with one. */
  activeDecls?: Record<string, unknown>;
  /** Same shape for `:hover` rules. */
  hoverDecls?: Record<string, unknown>;
  /** Cascaded `::before` / `::after` / `::placeholder` declarations, present
   * only when the stylesheet set contains pseudo-element rules at all (the
   * common page pays nothing). Matched by the same selectors; the
   * declarations style that pseudo, never the element itself. */
  beforeDecls?: Record<string, unknown>;
  afterDecls?: Record<string, unknown>;
  /** The pseudo cascade with `:active::before` / `:active::after` rules
   * folded in, present only when one actually matched. :hover variants of
   * a box are not supported (parser skips them). */
  activeBeforeDecls?: Record<string, unknown>;
  activeAfterDecls?: Record<string, unknown>;
  placeholderDecls?: Record<string, unknown>;
  id: number; // identity token for the compute cache key
  /** Computed styles for this rule set, keyed by the PARENT's computed-style
   * id. That one number is a complete key: a parent's computed style and its
   * custom properties are minted together, and the tag (hence its default
   * style) is already part of the chain key this result is cached under. It
   * replaces a per-element template string plus a global map lookup. */
  byParent: Map<number, ComputeResult>;
  /** The same for elements carrying an inline style (specs/144), keyed by
   * `${parentStyleId}\u0003${inlineKey}`. See compute() for why those two
   * complete the key. */
  byInline: Map<string, ComputeResult>;
}

export interface ComputeResult {
  style: Record<string, unknown>;
  /** `style`'s own keys, taken once here so the per-element comparison in
   * recompute() never has to enumerate an object. Computed styles are shared
   * and immutable, so this costs one array per distinct style rather than
   * one per element. */
  keys: string[];
  activeStyle?: Record<string, unknown>;
  activeKeys?: string[];
  hoverStyle?: Record<string, unknown>;
  hoverKeys?: string[];
  custom?: Record<string, string>;
  pseudo?: PseudoStyles;
  styleId: number;
  customId: number;
  defaultsId: number;
  /** The computed style depends on rawText (text-decoration / text-overflow
   * reach a synthesized text run, see compute) but the chain key does not
   * carry it, so a hit is checked against it like defaultsId. Before
   * specs/119 whichever of the two computed first won the cache entry; a
   * prewarmed cache changes which one is first, so the check makes the
   * result independent of that order. */
  rawText: boolean;
}

/** What one flush did. Cache hit rates are the thing to look at: the engine
 * is built so that N similar elements collapse onto one computed style, and
 * when that stops happening the per-node cost jumps by an order of magnitude
 * with nothing else looking different. */
export interface StyleEngineStats {
  /** Elements visited by a recompute pass. */
  recompute: number;
  computeHit: number;
  computeMiss: number;
  matchHit: number;
  matchMiss: number;
  /** Elements whose style actually crossed the bridge. */
  applied: number;
  /** Elements the engine is tracking, and rules it is matching against. */
  elements: number;
  rules: number;
  /** Wall time inside recompute passes, and how many passes ran. One clock
   * pair per pass, so this is free to leave on — and it answers the first
   * question anyone has about a slow restyle: was it even the engine? */
  flushMs: number;
  flushes: number;
  /** Wall time in markDirty's subtree walks, how many walks ran, and how
   * many nodes they visited. This happens during the framework's patch, not
   * during the recompute pass, so it is invisible to [flushMs]. */
  markMs: number;
  markCalls: number;
  markVisited: number;
}


/** The inline layers an element carries: the TS engine's element state, or
 * the native backend's sparse per-element record. */
export interface InlineLayers {
  inline?: Record<string, unknown>;
  inlineCustom?: Record<string, string>; // inline `--x` props
  /** `inlineKey` of the inline pair it was built from (see inlineKeyOf). */
  inlineKeyCache?: { inline?: Record<string, unknown>; custom?: Record<string, string>; key: string };
}

/** What computeResult reads off the element besides its match and parent. */
export interface ComputeSubject {
  tag: string;
  /** Renderer-synthesized bare-text element (`createText`). */
  rawText?: boolean;
  defaults?: Record<string, unknown>; // HTML tag default style (h1, tr, ...)
  defaultsId?: number;
  inline?: Record<string, unknown>;
  inlineCustom?: Record<string, string>;
}

/** The renderer's apply callback (see StyleCore's constructor). */
export type ApplyStyle = (
  id: number,
  style: Record<string, unknown>,
  activeStyle: Record<string, unknown> | null,
  // undefined = the element never had a hover variant (send nothing);
  // null = clear the variant the host is holding
  hoverStyle?: Record<string, unknown> | null,
  // same convention as hoverStyle: undefined = unchanged since the last
  // push, null = the element stopped matching any pseudo-element rule,
  // an object = the current pseudo-element styles (before / after /
  // placeholder — any kind may be absent)
  pseudo?: PseudoStyles | null,
  // true: the native style engine has written the element's styles to
  // the frame already; only the side effects of the style are wanted
  sent?: boolean,
) => void;

/** True when the map has at least one entry. The custom-property map is
 * always an object (MatchResult mints one per match), sometimes an empty
 * one, and "empty" counts as absent for the source-counting in compute(). */
export function hasKeys(map: Record<string, unknown> | undefined): boolean {
  if (map === undefined) return false;
  for (const k in map) {
    return true;
  }
  return false;
}


/** Parsed class strings. Element class sets are never mutated in place
 * (replaceClasses swaps the whole set; setClasses/setDisabled copy before
 * editing), so one set per distinct string can be shared by every element
 * that carries it — vant repeats the same few dozen class strings across a
 * page, and the regex split plus a fresh Set per patch was measurable under
 * the interpreter (specs/118). Cleared wholesale past the cap: the key space
 * is bounded by the source, the cap only guards against generated names. */
const classSetCache = new Map<string, Set<string>>();
const CLASS_SET_CACHE_MAX = 4096;

export function parseClassValue(value: unknown): Set<string> {
  if (typeof value === 'string') {
    let cached = classSetCache.get(value);
    if (cached === undefined) {
      if (classSetCache.size >= CLASS_SET_CACHE_MAX) classSetCache.clear();
      cached = new Set(value.split(/\s+/).filter(Boolean));
      classSetCache.set(value, cached);
    }
    return cached;
  }
  let text = '';
  if (typeof value === 'string') text = value;
  else if (Array.isArray(value)) text = value.filter((v) => typeof v === 'string').join(' ');
  else if (value && typeof value === 'object') {
    text = Object.entries(value as Record<string, unknown>)
      .filter(([, on]) => on)
      .map(([k]) => k)
      .join(' ');
  }
  return new Set(text.split(/\s+/).filter(Boolean));
}


// ---- var() resolution --------------------------------------------------------

/** Normalizes a custom property name by resolving CSS escape sequences
 * (`theme\.color` -> `theme.color`) so escaped stylesheet references and
 * raw generated keys land on the same entry. */
export function normalizeVarKey(name: string): string {
  return name.includes('\\') ? name.replace(/\\(.)/g, '$1') : name;
}

/** Replaces every var() reference in `text` using `custom` (custom prop
 * values may themselves reference vars). Returns null when a reference has
 * no value and no usable fallback — the whole declaration becomes invalid,
 * as in CSS. */
function resolveVarsInString(
  text: string,
  custom: Record<string, string>,
  depth: number,
): string | null {
  if (depth > 32) return null; // cyclic --a: var(--b) chain
  let out = '';
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf('var(', i);
    if (idx < 0) {
      out += text.slice(i);
      return out;
    }
    out += text.slice(i, idx);
    let paren = 1;
    let j = idx + 4;
    const argsStart = j;
    while (j < text.length && paren > 0) {
      const ch = text[j];
      if (ch === '(') paren++;
      else if (ch === ')') {
        paren--;
        if (paren === 0) break;
      }
      j++;
    }
    if (paren > 0) return null; // unbalanced
    const args = text.slice(argsStart, j);
    // split "name, fallback" at the first top-level comma (fallback may
    // contain commas of its own, e.g. rgba(...))
    let d = 0;
    let comma = -1;
    for (let k = 0; k < args.length; k++) {
      const ch = args[k];
      if (ch === '(') d++;
      else if (ch === ')') d--;
      else if (ch === ',' && d === 0) {
        comma = k;
        break;
      }
    }
    const name = (comma >= 0 ? args.slice(0, comma) : args).trim();
    // CSS escape sequences in the reference (\. etc.) denote the literal
    // character, so normalize before lookup — generated v-bind() getter
    // keys may be either escaped or raw depending on the compile path
    const fallback = comma >= 0 ? args.slice(comma + 1).trim() : undefined;
    let val: string | null = Object.prototype.hasOwnProperty.call(custom, normalizeVarKey(name))
      ? custom[normalizeVarKey(name)]
      : null;
    if (val != null) {
      val = resolveVarsInString(val, custom, depth + 1);
    } else if (fallback != null) {
      val = resolveVarsInString(fallback, custom, depth + 1);
    }
    if (val == null) return null;
    out += val;
    i = j + 1;
  }
  return out;
}

/** Resolves var() references in a merged style map against the element's
 * computed custom properties; unresolved declarations are dropped and
 * resolved values get the usual normalization (px -> number, ...). */
export function resolveVars(style: Record<string, unknown>, custom?: Record<string, string>): Record<string, unknown> {
  // Allocation-free fast path: the previous spelling paid Object.entries
  // plus a full copy into `out` before discovering there was nothing to
  // substitute — the common case once the custom tokens are resolved at
  // parse time. Scan bare-handed first; only a live var() builds the copy
  // (specs/076).
  let needed = false;
  for (const k in style) {
    const v = style[k];
    if (typeof v === 'string' && v.includes('var(')) {
      needed = true;
      break;
    }
  }
  if (!needed) return style;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    if (typeof v === 'string' && v.includes('var(')) {
      const resolved = resolveVarsInString(v, custom ?? {}, 0);
      if (resolved == null) {
        changed = true; // declaration becomes invalid — drop it
        continue;
      }
      // no trim: normalizeValue matches the `font`/`animation` pending-
      // substitution markers (" font …"), which start with a space; it
      // trims before its own checks anyway
      const value = normalizeValue(k, resolved);
      changed = true;
      // a `font` shorthand that turned out invalid after substitution
      // drops its longhands (normalizeValue warned)
      if (value !== undefined) out[k] = value;
    } else {
      out[k] = v;
    }
  }
  return changed ? out : style;
}


/** Value equality for two style maps, given each one's own keys.
 *
 * The keys are passed in rather than taken here because they are already
 * known: a computed style is shared and immutable, so its key list is built
 * once per distinct style instead of once per element that wears it. The
 * previous spelling took `Object.keys` of both maps on every comparison —
 * a few thousand throwaway arrays per restyle, which is the kind of thing
 * that costs nothing on a laptop and dominates on a phone. */
export function sameStyle(
  a: Record<string, unknown>,
  aKeys: string[],
  b: Record<string, unknown>,
  bKeys: string[],
): boolean {
  if (a === b) return true;
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i];
    const va = a[k];
    const vb = b[k];
    if (va === vb) continue;
    if (va !== null && vb !== null && typeof va === 'object' && typeof vb === 'object') {
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
      continue;
    }
    return false;
  }
  return true;
}

/** Shallow map equality for the "did this prop actually change" checks, which
 * run once per patched prop rather than once per element in a restyle — so
 * enumerating here is fine. Absent and empty count as the same thing. */
/** Splits an inline style value (a `:style` object or a css string) into the
 * two records the element state keeps. Absent input yields absent records. */
function normalizeInline(value: unknown): {
  style: Record<string, unknown> | undefined;
  custom: Record<string, string> | undefined;
} {
  let style: Record<string, unknown> | undefined;
  let custom: Record<string, string> | undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = parseInlineCss(value);
    style = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith('--')) (custom ??= {})[normalizeVarKey(k)] = String(v);
      else style[k] = v;
    }
  } else if (value && typeof value === 'object') {
    style = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // DOM patchStyle semantics: a null/undefined/'' entry sets nothing.
      // Kept as a key it would spread over the matched CSS in compute() and
      // erase it — vant's stepper binds `{ width: undefined }` when no
      // input-width is given, which wiped `.van-stepper__input { width }`.
      if (v == null || v === '') continue;
      if (k.startsWith('--')) (custom ??= {})[normalizeVarKey(k)] = String(v);
      // Vue compiles a static `style="align-items: stretch"` into an object
      // with the CSS (kebab) names as written; the native side reads only
      // camelCase, so `align-items` was silently ignored there
      else style[k.includes('-') ? camelize(k) : k] = v;
    }
  }
  return { style, custom };
}

export function sameMap(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  const ak = a ? Object.keys(a) : [];
  const bk = b ? Object.keys(b) : [];
  if (ak.length !== bk.length) return false;
  return sameStyle(a ?? {}, ak, b ?? {}, bk);
}


export abstract class StyleCore {
  protected rules: CssRule[] = [];
  protected nextOrder = 0;
  /** `::before` / `::after` rules, kept out of `rules` so their declarations
   * can never style the element itself. */
  protected pseudoRules: CssRule[] | undefined;
  protected hasPseudo = false;
  /** True once a registered stylesheet contains `@media` rules. Viewport
   * changes then invalidate the whole match cache; with the flag off
   * `setViewport` is an equality check and nothing else. */
  protected hasMedia = false;
  protected viewport = { width: FALLBACK_VIEWPORT.width, height: FALLBACK_VIEWPORT.height };
  /** True once a registered stylesheet contains `:first-child`/`:last-child`.
   * Sibling position is then part of the match key and every tree mutation
   * re-marks siblings; with the flag off both costs stay at zero. */
  protected hasStructural = false;
  /** Some registered selector uses `A + B`: matching then depends on the
   * previous sibling too, which the chain key and the dirty marks must
   * reflect. Off until the first such rule shows up, so pages without one
   * pay nothing. */
  protected hasSiblingRules = false;
  /** Attribute names some registered selector tests (`[data-x=…]`), besides
   * `class`. Only these join the chain key and restyle on change: vant
   * writes aria-/data- attributes on nearly every element, and matching
   * never needs the rest. */
  protected attrNames = new Set<string>();
  /** Custom properties declared on `:root` / `:host`, in source order. They
   * seed the inheritance chain wherever a parent has nothing to pass down
   * (the top of each page tree), which is how a browser sees them: every
   * element inherits from the document root. */
  protected rootCustom: Record<string, string> | undefined;
  /** `@keyframes` by name; a later block of the same name replaces it. */
  protected keyframes = new Map<string, KeyframesDecl>();
  /** Resolved frames per name, for blocks with no var() in them — shared,
   * so every element running the animation compares equal by identity. */
  protected keyframesStatic = new Map<string, AnimationFrame[]>();
  /** Identity tokens for the objects the compute cache keys on. Numbers
   * (assigned where each object is created) keep the key a short string and
   * the lookup allocation-free. */
  protected nextObjId = 1;
  private defaultsIds = new WeakMap<object, number>();
  /** Defaults ids by CONTENT: equal tag defaults share one id, so their
   * elements share compute results. */
  private defaultsIdByJson = new Map<string, number>();
  protected counters = { recompute: 0, computeHit: 0, computeMiss: 0, matchHit: 0, matchMiss: 0, applied: 0, flushMs: 0, flushes: 0, markMs: 0, markCalls: 0, markVisited: 0 };

  constructor(protected readonly applyStyle: ApplyStyle) {}

  /** Registers a <style> block. scope=null means global (non-scoped). */
  abstract register(scope: string | null, cssText: string): void;

  /** Registers one sheet. Returns null when it added no rules, the rules it
   * added when the fast path below applied (no cached answer can change),
   * 'full' when every cache was invalidated. */
  protected registerSheet(scope: string | null, cssText: string): CssRule[] | 'full' | null {
    const flagsBefore = this.shapeFlags();
    let touchesRoot = false;
    const fontFaces: FontFaceDecl[] = [];
    const keyframes: KeyframesDecl[] = [];
    const all = parseStylesheet(cssText, scope, this.nextOrder, fontFaces, keyframes);
    for (const face of fontFaces) registerFontFace(face);
    for (const k of keyframes) {
      this.keyframes.set(k.name, k);
      this.keyframesStatic.delete(k.name);
    }
    if (all.length === 0) return null;
    this.nextOrder = all[all.length - 1].order + 1;
    const parsed: CssRule[] = [];
    for (const r of all) {
      if (r.root !== true) {
        // pseudo-element rules cascade in their own bucket: their selectors
        // match the element, but the declarations must never style it
        if (r.pseudo !== undefined) {
          (this.pseudoRules ??= []).push(r);
          this.hasPseudo = true;
          this.ruleAdded(r, true);
        } else {
          parsed.push(r);
        }
        continue;
      }
      touchesRoot = true;
      for (const [k, v] of Object.entries(r.decls)) {
        if (k.startsWith('--')) (this.rootCustom ??= {})[normalizeVarKey(k)] = String(v);
        else warnOnce(`":root" declaration "${k}" is not supported (only custom properties), skipped`);
      }
    }
    this.rules.push(...parsed);
    for (const r of parsed) this.ruleAdded(r, false);
    if (!this.hasMedia) {
      for (const r of parsed) {
        if (r.media !== undefined) {
          this.hasMedia = true;
          break;
        }
      }
    }
    if (!this.hasStructural) {
      for (const r of parsed) {
        if (r.selectors.some((s) => s.compounds.some((c) => c.first || c.last || c.notFirst || c.notLast))) {
          this.hasStructural = true;
          break;
        }
      }
    }
    for (const r of parsed) {
      for (const sel of r.selectors) {
        for (const c of sel.compounds) {
          if (!c.attrs) continue;
          for (const t of c.attrs) {
            if (this.attrNames.has(t.name)) continue;
            this.attrNames.add(t.name);
            this.attrNameAdded(t.name);
          }
        }
      }
    }
    if (!this.hasSiblingRules) {
      for (const r of parsed) {
        if (r.selectors.some((s) => s.combinators.includes('nextSibling'))) {
          this.hasSiblingRules = true;
          break;
        }
      }
    }
    // A split build (specs/120) evaluates each page's chunk when the page is
    // first opened, and the chunk registers the page's scoped sheet. Clearing
    // every cache for it made every page open fully cold and restyled the
    // pages stacked below — which is why a --profile build mounted slower
    // than the dev server's single bundle. A scoped rule only matches an
    // element carrying its scope (or, for :deep, an ancestor that does), and
    // chain keys carry every scope of the element and its ancestors: while no
    // element — and no cached chain — has ever carried this scope, no answer
    // in the caches and no live element can change. The other conditions
    // cover what reaches beyond the scope: :root tokens and @keyframes are
    // global, and the shape flags decide the key format and match layout.
    // Anything else (a global sheet, a dev re-registration) still clears it
    // all: narrower invalidation was judged not worth its risk (plan §3).
    if (
      scope !== null &&
      !this.scopeSeen(scope) &&
      !touchesRoot &&
      keyframes.length === 0 &&
      this.shapeFlags() === flagsBefore
    ) {
      return all.filter((r) => r.root !== true);
    }
    this.invalidateAll();
    this.lastAdded = all.filter((r) => r.root !== true);
    return 'full';
  }

  /** The rules the last 'full' registerSheet added (see register). */
  protected lastAdded: CssRule[] = [];

  /** The identity token of a tag-defaults object (see defaultsIdForJson). */
  protected defaultsIdOf(defaults: Record<string, unknown>): number {
    let id = this.defaultsIds.get(defaults) ?? 0;
    if (id === 0) {
      id = this.defaultsIdForJson(JSON.stringify(defaults));
      this.defaultsIds.set(defaults, id);
    }
    return id;
  }

  /** The id of the tag defaults with this JSON content — one stringify per
   * distinct defaults object, the WeakMap above caches the object. */
  private defaultsIdForJson(json: string): number {
    let id = this.defaultsIdByJson.get(json);
    if (id === undefined) {
      id = this.nextObjId++;
      this.defaultsIdByJson.set(json, id);
    }
    return id;
  }

  /** The flags that decide signature format and match-result shape, as one
   * comparable value (register's fast path compares before / after). */
  protected shapeFlags(): number {
    return (this.hasMedia ? 1 : 0) | (this.hasStructural ? 2 : 0) | (this.hasSiblingRules ? 4 : 0) | (this.hasPseudo ? 8 : 0);
  }

  /** The host's window (logical pixels) changed — width, height, or both.
   * Media conditions are not part of any element's chain key, so no
   * per-element cache can see the change; the invalidation has to be the
   * same whole-store sweep a stylesheet change does (bump the match epoch,
   * drop the cache, re-mark everything). A finer-grained pass — recompute
   * only elements whose matched set actually changed — was considered and
   * rejected (plan §3): finding that set is itself a scan over every rule
   * against the new viewport, so the saving would be the cache rebuild
   * only, at the cost of a second code path to keep correct. Desktop
   * window-dragging fires this per frame; the flush coalesces per
   * microtask, so it is one full recompute per frame — measured on the
   * responsive example before optimizing further. */
  setViewport(width: number, height: number): void {
    if (width === this.viewport.width && height === this.viewport.height) return;
    this.viewport.width = width;
    this.viewport.height = height;
    if (!this.hasMedia) return;
    this.viewportChanged();
  }

  /** Folds one match's hits into its cascades: the matchRules miss path
   * after the candidate walk. Public for the native style engine (specs/150),
   * which does the walk in C++ and calls back with the same hit lists, so the
   * cascade semantics exist once. Sorts the lists in place. */
  buildMatch(
    plain: RuleHit[],
    active: RuleHit[],
    hover: RuleHit[],
    anyActive: boolean,
    anyHover: boolean,
    pseudoLists: PseudoHits | undefined,
  ): MatchResult {
    const byCascade = (a: RuleHit, b: RuleHit) => a.spec - b.spec || a.rule.order - b.rule.order;
    plain.sort(byCascade);
    const decls: Record<string, unknown> = {};
    const custom: Record<string, string> = {};
    for (const m of plain) {
      // for-in, not Object.entries: this runs per match-cache miss and the
      // entries API allocates a key array plus a tuple per rule for nothing
      const d = m.rule.decls;
      for (const k in d) {
        const v = d[k];
        if (k.startsWith('--')) custom[normalizeVarKey(k)] = String(v);
        else decls[k] = v;
      }
    }
    // custom properties stay out of the state variants: they inherit, and a
    // state only restyles the node itself
    let activeDecls: Record<string, unknown> | undefined;
    if (anyActive) {
      active.sort(byCascade);
      activeDecls = {};
      for (const m of active) {
        const d = m.rule.decls;
        for (const k in d) {
          const v = d[k];
          if (!k.startsWith('--')) activeDecls[k] = v;
        }
      }
    }
    // While hovered (not pressed) a :active rule must NOT apply, so the
    // hover cascade tops out at bestPlain rather than best — a rule matched
    // only through :active selectors stays out entirely (bestPlain < 0).
    let hoverDecls: Record<string, unknown> | undefined;
    if (anyHover) {
      hover.sort(byCascade);
      hoverDecls = {};
      for (const m of hover) {
        const d = m.rule.decls;
        for (const k in d) {
          const v = d[k];
          if (!k.startsWith('--')) hoverDecls[k] = v;
        }
      }
    }
    // Pseudo-element cascade: pseudo rules matched by the same selectors,
    // cascaded per pseudo kind in source order. `:active::before` rules
    // cascade into a separate pressed variant, like activeDecls.
    let beforeDecls: Record<string, unknown> | undefined;
    let afterDecls: Record<string, unknown> | undefined;
    let placeholderDecls: Record<string, unknown> | undefined;
    let activeBeforeDecls: Record<string, unknown> | undefined;
    let activeAfterDecls: Record<string, unknown> | undefined;
    if (pseudoLists !== undefined) {
      const { before, after, placeholder, activeBefore, activeAfter } = pseudoLists;
      const fold = (bucket: RuleHit[]) => {
        if (bucket.length === 0) return undefined;
        bucket.sort(byCascade);
        const out: Record<string, unknown> = {};
        for (const m of bucket) {
          const d = m.rule.decls;
          for (const k in d) {
            const v = d[k];
            if (!k.startsWith('--')) out[k] = v;
          }
        }
        return out;
      };
      beforeDecls = fold(before);
      afterDecls = fold(after);
      placeholderDecls = fold(placeholder);
      // only a variant that some :active selector reached is worth a slot:
      // the lists also carry every plain rule (the full pressed cascade)
      const hasState = (list: Array<{ state?: boolean }>) => list.some((m) => m.state === true);
      if (hasState(activeBefore)) activeBeforeDecls = fold(activeBefore);
      if (hasState(activeAfter)) activeAfterDecls = fold(activeAfter);
    }
    return {
      decls,
      custom,
      activeDecls,
      hoverDecls,
      beforeDecls,
      afterDecls,
      placeholderDecls,
      activeBeforeDecls,
      activeAfterDecls,
      id: this.nextObjId++,
      byParent: new Map(),
      byInline: new Map(),
    };
  }

  /** The compute pipeline for one set of inputs — everything a computed style
   * depends on is a parameter (see the input list in compute()), so the
   * native engine (specs/150) calls it for its cache misses as well. Mints a
   * fresh style id; caching is the caller's business. */
  computeResult(
    matched: MatchResult,
    parentComputed: Record<string, unknown> | undefined,
    parentCustom: Record<string, string> | undefined,
    s: ComputeSubject,
  ): ComputeResult {
    this.counters.computeMiss++;
    // 076 skipped merging inherit into `merged` because the custom-map copy
    // was 30ms and this merge was <1ms under it. After that copy went away,
    // the leftover is an empty `inherited` object + a four-layer spread per
    // miss (vant-form ~286). One object, index walk, for-in cover (specs/084).
    const copyInherited = (out: Record<string, unknown>) => {
      if (!parentComputed) return;
      for (let i = 0; i < INHERITABLE_KEYS.length; i++) {
        const k = INHERITABLE_KEYS[i];
        const v = parentComputed[k];
        if (v !== undefined) out[k] = v;
      }
      // text-decoration does not inherit, but it PROPAGATES: the box's
      // line is drawn through its inline text (van-card's origin price is
      // `<div style="text-decoration: line-through">¥ 10.00</div>`). The
      // native text run is a node of its own, so it takes the line here —
      // text nodes and plain spans only; inline-blocks stop propagation
      const deco = parentComputed.textDecoration;
      if (deco !== undefined && (s.rawText || s.tag === 'span')) out.textDecoration = deco;
      // text-overflow belongs to the block container but clips ITS inline
      // text; the text run is the native node that can draw the ellipsis
      // (van-ellipsis: nowrap + overflow hidden + text-overflow: ellipsis)
      const clip = parentComputed.textOverflow;
      if (clip !== undefined && s.rawText) out.textOverflow = clip;
    };
    const overlayCascade = (decls: Record<string, unknown>) => {
      // Own object — must not write through `merged` (the element's computed).
      const out: Record<string, unknown> = {};
      copyInherited(out);
      if (s.defaults) for (const k in s.defaults) out[k] = s.defaults[k];
      for (const k in decls) out[k] = decls[k];
      if (s.inline) for (const k in s.inline) out[k] = s.inline[k];
      return out;
    };
    const merged: Record<string, unknown> = {};
    copyInherited(merged);
    // CSS custom properties: cascade like normal declarations and inherit
    // down the tree, then var() references resolve against them
    // The custom-property map is SHARED, not copied, whenever a single
    // source contributes: every consumer only reads it (var() resolution
    // here, keyframe frames, and children merge from it copy-on-write at
    // this same code), so referencing the parent's table verbatim is safe.
    // Copying it per element was the largest allocation of a component-
    // library mount — vant's --van-* token table is ~500 keys and every
    // compute miss paid the full copy (specs/076).
    const hasParentCustom = hasKeys(parentCustom);
    const hasMatchedCustom = hasKeys(matched.custom);
    const hasInlineCustom = hasKeys(s.inlineCustom);
    const customSources
      = (hasParentCustom ? 1 : 0) + (hasMatchedCustom ? 1 : 0) + (hasInlineCustom ? 1 : 0);
    let custom: Record<string, string> | undefined;
    if (customSources === 1) {
      custom = hasParentCustom
        ? parentCustom
        : hasMatchedCustom
          ? (matched.custom as Record<string, string>)
          : s.inlineCustom;
    } else if (customSources > 1) {
      custom = {};
      if (hasParentCustom) for (const k in parentCustom!) custom[k] = parentCustom![k];
      if (hasMatchedCustom) for (const k in matched.custom) custom[k] = matched.custom[k];
      if (hasInlineCustom) for (const k in s.inlineCustom!) custom[k] = s.inlineCustom![k];
    }
    if (s.defaults) for (const k in s.defaults) merged[k] = s.defaults[k];
    for (const k in matched.decls) merged[k] = matched.decls[k];
    if (s.inline) for (const k in s.inline) merged[k] = s.inline[k];
    // CSS initial flex-direction is row; the peer's unstyled default is
    // column (fjs's mobile-view convention), so the engine pins the CSS
    // value wherever a rule asked for a flex container without saying which
    // way — van-cell/van-grid/van-divider declare display:flex and rely on
    // the default, and every real browser gives them a row.
    // The cross axis is the same story: the peer centers a row's children,
    // CSS's initial align-items is stretch. van-cell leaves it unset, and a
    // centered row dropped the value/arrow below the title whenever the
    // title carried a label.
    if (merged.flexDirection === undefined && FLEX_DISPLAYS.has(merged.display as string)) {
      merged.flexDirection = 'row';
      if (merged.alignItems === undefined) merged.alignItems = 'stretch';
      // inline-flex is an inline-LEVEL box: runs of them wrap like the
      // inline flow would (rows of van-tags), where a block-level flex
      // would push past the container edge
      if (merged.display === 'inline-flex' && merged.flexWrap === undefined) {
        merged.flexWrap = 'wrap';
      }
    }
    // Inline-level boxes have no inline formatting context on the native
    // side; unmapped they collapse to stacked blocks, the one shape web
    // never shows for them. Map to the closest thing that exists — a
    // wrapping row (van-stepper's minus/input/plus, rows of tags). The
    // display VALUE stays `inline-block`/`inline` on purpose: the peer reads
    // it to skip cross-axis stretch for the box (shrink-to-fit), which is
    // the other half of the inline behavior.
    if (
      (merged.display === 'inline-block' || merged.display === 'inline') &&
      merged.flexDirection === undefined &&
      merged.flexWrap === undefined
    ) {
      merged.flexDirection = 'row';
      merged.flexWrap = 'wrap';
      // In that inline flow, text-align is what places the runs along the
      // line — NutUI's cell value is `inline-block; text-align: right;
      // flex: 1` and its text sat at the start of the stretched box.
      if (merged.justifyContent === undefined) {
        const j = INLINE_TEXT_ALIGN_JUSTIFY[merged.textAlign as string];
        if (j) merged.justifyContent = j;
      }
    }
    resolveInheritKeyword(merged, parentComputed);
    const parentFontPx = fontSizePx(parentComputed?.fontSize, INITIAL_FONT_PX);
    const style = resolveVars(merged, custom);
    resolveEm(style, parentFontPx);
    // vant's Popover arrow is a CSS triangle: `border-top-color:
    // currentColor` on the element itself (specs/129)
    resolveCurrentColor(style);
    // var() substitution leaves calc()s the em pass never saw
    // (`calc(6px * -1)` from vant's arrow margin): fold the absolute ones
    for (const k in style) {
      const v = style[k];
      if (typeof v === 'string' && v.includes('calc(')) style[k] = foldAbsoluteCalc(v);
    }
    this.attachKeyframes(style, custom);
    // the pressed variant is the same pipeline over the pressed cascade, so
    // inline styles and inherited values keep winning where they should.
    // :hover computes the same way; both state variants keep custom
    // properties out (they inherit, and a state only restyles the node).
    const activeComputed = matched.activeDecls
      ? resolveVars(overlayCascade(matched.activeDecls), custom)
      : undefined;
    if (activeComputed) resolveEm(activeComputed, parentFontPx);
    const hoverComputed = matched.hoverDecls
      ? resolveVars(overlayCascade(matched.hoverDecls), custom)
      : undefined;
    if (hoverComputed) resolveEm(hoverComputed, parentFontPx);
    // Pseudo-element styles: the element's inheritable computed properties
    // are the base (a pseudo-element inherits from its originating element —
    // its own width/background must NOT leak into the decoration box), the
    // matched pseudo declarations layer on top, and both var() and em go
    // through the same resolution as the element's own style.
    let pseudo: PseudoStyles | undefined;
    if (matched.beforeDecls !== undefined || matched.afterDecls !== undefined) {
      const inheritable: Record<string, unknown> = {};
      for (let i = 0; i < INHERITABLE_KEYS.length; i++) {
        const k = INHERITABLE_KEYS[i];
        const v = style[k];
        if (v !== undefined) inheritable[k] = v;
      }
      const build = (decls: Record<string, unknown>) => {
        const merged0 = resolveVars({ ...inheritable, ...decls }, custom);
        resolveEm(merged0, parentFontPx);
        // a pseudo-element's parent is its originating element (vant's
        // divider lines: `border-style: inherit` picks up --dashed)
        resolveInheritKeyword(merged0, style);
        // vant paints the stepper +/- lines with it
        resolveCurrentColor(merged0);
        return merged0;
      };
      pseudo = {};
      if (matched.beforeDecls !== undefined) pseudo.before = build(matched.beforeDecls);
      if (matched.afterDecls !== undefined) pseudo.after = build(matched.afterDecls);
      // a pressed variant only restyles a box the plain cascade created
      if (pseudo.before && matched.activeBeforeDecls !== undefined) {
        pseudo.activeBefore = build(matched.activeBeforeDecls);
      }
      if (pseudo.after && matched.activeAfterDecls !== undefined) {
        pseudo.activeAfter = build(matched.activeAfterDecls);
      }
    }
    if (matched.placeholderDecls !== undefined) {
      // `::placeholder` starts from its matched declarations ALONE (see
      // PseudoStyles): the hint's UA default grey must survive a rule that
      // says nothing about color, so the element's inherited color is not
      // layered in here — only an explicit `color` (or `currentColor`,
      // which resolveInheritKeyword maps to the element's) reaches it.
      // em chains from the element's own font-size: the placeholder
      // inherits from its originating element, not from its parent.
      const ph = resolveVars({ ...matched.placeholderDecls }, custom);
      resolveEm(ph, fontSizePx(style.fontSize, parentFontPx));
      resolveInheritKeyword(ph, style);
      (pseudo ??= {}).placeholder = ph;
    }
    const styleId = this.nextObjId++;
    const customId = custom ? this.nextObjId++ : 0;
    return {
      style,
      keys: Object.keys(style),
      activeStyle: activeComputed,
      activeKeys: activeComputed ? Object.keys(activeComputed) : undefined,
      hoverStyle: hoverComputed,
      hoverKeys: hoverComputed ? Object.keys(hoverComputed) : undefined,
      custom,
      pseudo,
      styleId,
      rawText: s.rawText === true,
      customId,
      defaultsId: s.defaultsId ?? 0,
    };
  }

  /** Hands the peer the frames of every animation the style names, as
   * `animationKeyframes: {name: [{offset, style}]}` — it runs them natively
   * (css/animation.ts). A name with no `@keyframes` block is left out, which
   * the peer reads as "no animation", as CSS does. */
  private attachKeyframes(style: Record<string, unknown>, custom: Record<string, string> | undefined): void {
    const names = style.animationName;
    if (typeof names !== 'string' || this.keyframes.size === 0) return;
    let out: Record<string, AnimationFrame[]> | undefined;
    for (const raw of names.split(',')) {
      const name = raw.trim();
      if (!name || name === 'none') continue;
      const block = this.keyframes.get(name);
      if (!block) continue;
      let frames = this.keyframesStatic.get(name);
      if (!frames) {
        let dynamic = false;
        frames = block.frames.map(({ offset, decls }) => {
          const resolved = resolveVars(decls, custom);
          if (resolved !== decls) dynamic = true;
          return { offset, style: resolved };
        });
        if (!dynamic) this.keyframesStatic.set(name, frames);
      }
      (out ??= {})[name] = frames;
    }
    if (out) style.animationKeyframes = out;
  }

  /** The element's inline style + inline custom props as one string. Cached
   * against the two objects it was built from: every inline write replaces
   * them rather than mutating (setInlineStyle, patchInlineStyle,
   * mutateInline, setInlineCustomProps), so identity says when to rebuild
   * without each writer having to remember to clear it. */
  protected inlineKeyOf(s: InlineLayers): string {
    const c = s.inlineKeyCache;
    if (c !== undefined && c.inline === s.inline && c.custom === s.inlineCustom) return c.key;
    const key = `${JSON.stringify(s.inline ?? null)}\u0003${JSON.stringify(s.inlineCustom ?? null)}`;
    s.inlineKeyCache = { inline: s.inline, custom: s.inlineCustom, key };
    return key;
  }

  setInlineStyle(id: number, value: unknown): void {
    const s = this.inlineState(id);
    if (!s) return;
    const { style, custom } = normalizeInline(value);
    if (sameMap(style, s.inline) && sameMap(custom, s.inlineCustom)) return;
    s.inline = style;
    s.inlineCustom = custom;
    this.inlineChanged(id, s);
  }
  /** The DOM's patchStyle semantics for a `:style` re-patch: an object
   * binding DIFFS against its previous value (set the next keys, drop the
   * keys that disappeared), so a key the binding did not change keeps
   * whatever wrote it in between — on a real DOM that is what makes
   * `el.style` writes from a library like @vueuse/motion survive a parent
   * re-render, and the shim needs the same here. A css string or a clear
   * replaces wholesale, like cssText. */
  patchInlineStyle(id: number, prev: unknown, next: unknown): void {
    const s = this.inlineState(id);
    if (!s) return;
    if (typeof next !== 'object' || next === null) {
      if (next == null) {
        // a cleared binding removes exactly the keys it had before — other
        // consumers' writes stay
        const { style, custom } = normalizeInline(prev);
        if (!style && !custom) return;
        const inline = { ...(s.inline ?? {}) };
        const inlineCustom = { ...(s.inlineCustom ?? {}) };
        for (const key of Object.keys(style ?? {})) delete inline[key];
        for (const key of Object.keys(custom ?? {})) delete inlineCustom[normalizeVarKey(key)];
        if (sameMap(inline, s.inline) && sameMap(inlineCustom, s.inlineCustom)) return;
        s.inline = inline;
        s.inlineCustom = inlineCustom;
        this.inlineChanged(id, s);
      } else {
        // a css string replaces wholesale, like cssText
        this.setInlineStyle(id, next);
      }
      return;
    }
    const { style: prevStyle, custom: prevCustom } = normalizeInline(prev);
    const { style: nextStyle, custom: nextCustom } = normalizeInline(next);
    const inline: Record<string, unknown> = { ...(s.inline ?? {}), ...nextStyle };
    const custom: Record<string, string> = { ...(s.inlineCustom ?? {}), ...nextCustom };
    for (const key of Object.keys(prevStyle ?? {})) {
      if (!(key in (nextStyle ?? {}))) delete inline[key];
    }
    for (const key of Object.keys(prevCustom ?? {})) {
      if (!(key in (nextCustom ?? {}))) delete custom[key];
    }
    if (sameMap(inline, s.inline) && sameMap(custom, s.inlineCustom)) return;
    s.inline = inline;
    s.inlineCustom = custom;
    this.inlineChanged(id, s);
  }
  /** The element's current inline layer, for the DOM-shaped `el.style` shim
   * to read back (ui/element.ts). Inline properties plus the `--`-prefixed
   * custom ones; this is the WRITE record, not the resolved cascade — the
   * DOM's getComputedStyle semantics are out of scope for the shim. */
  inlineRecord(id: number): Record<string, unknown> | undefined {
    const s = this.inlineRead(id);
    if (!s) return undefined;
    if (!s.inline && !s.inlineCustom) return undefined;
    return { ...s.inline, ...s.inlineCustom };
  }
  /** One-property write on the inline layer, same contract as a `:style`
   * object key (camelCase or kebab, custom props with `--`). `null`/`''`
   * removes. This is what `el.style[key] = v` funnels into, so a DOM
   * library, a `:style` binding and useCssVars all merge into one record
   * and re-resolve together instead of clobbering each other. */
  mutateInline(id: number, key: string, value: unknown): void {
    const s = this.inlineState(id);
    if (!s) {
      // Every renderer-created element is ensure()d at createElement; an
      // unregistered id means a raw element API user the style engine was
      // never told about. Dropping the write silently would be a
      // constitution V bug.
      warnOnce(
        `el.style write for element #${id} ignored: the element was never registered with the style engine (raw element API?)`,
      );
      return;
    }
    const inline: Record<string, unknown> = { ...(s.inline ?? {}) };
    const custom: Record<string, string> = { ...(s.inlineCustom ?? {}) };
    if (key.startsWith('--')) {
      const name = normalizeVarKey(key);
      if (value == null || value === '') delete custom[name];
      else custom[name] = String(value);
    } else if (value == null || value === '') {
      delete inline[key];
    } else {
      inline[key] = value;
    }
    if (sameMap(inline, s.inline) && sameMap(custom, s.inlineCustom)) return;
    s.inline = inline;
    s.inlineCustom = custom;
    this.inlineChanged(id, s);
  }
  /** Merges a useCssVars() batch into the element's inline custom props
   * (keys without the leading `--` are normalized; null/'' removes). */
  setInlineCustomProps(id: number, vars: Record<string, unknown>): void {
    const s = this.inlineState(id);
    if (!s) return;
    const next: Record<string, string> = { ...(s.inlineCustom ?? {}) };
    let changed = false;
    for (const [k, v] of Object.entries(vars)) {
      const name = normalizeVarKey(k.startsWith('--') ? k : `--${k}`);
      if (v == null || v === '') {
        if (name in next) {
          delete next[name];
          changed = true;
        }
        continue;
      }
      const val = String(v);
      if (next[name] !== val) {
        next[name] = val;
        changed = true;
      }
    }
    if (!changed && sameMap(next, s.inlineCustom)) return;
    s.inlineCustom = next;
    this.inlineChanged(id, s);
  }

  /** The libfjs-style backend over this engine's CSS state (specs/150).
   * Texts ride frames as they are once it is attached (specs/155);
   * `globalThis.__fjsTextRefs = false` keeps the byte encoding (A/B runs). */
  protected newNativeBackend(fns: FjsNativeFns): NativeStyleBackend {
    const native = new NativeStyleBackend(
      {
        engine: this,
        sources: () => ({
          rules: this.rules,
          pseudoRules: this.pseudoRules ?? [],
          rootCustom: this.rootCustom,
          viewport: this.viewport,
          hasPseudo: this.hasPseudo,
        }),
        parseClasses: parseClassValue,
        apply: (id, style, active, pseudo) => this.applyStyle(id, style, active, undefined, pseudo, true),
      },
      fns,
    );
    if (this.rules.length > 0 || this.pseudoRules !== undefined) native.sendRules();
    if (fns.styleTextRefs === true && (globalThis as { __fjsTextRefs?: boolean }).__fjsTextRefs !== false) {
      getWriter().textRefs = true;
    }
    return native;
  }

  // ---- hooks -----------------------------------------------------------------

  /** A rule joined `rules` (pseudo=false) or `pseudoRules`. */
  protected ruleAdded(rule: CssRule, pseudo: boolean): void {
    void rule;
    void pseudo;
  }

  /** A selector started testing this attribute name. */
  protected attrNameAdded(name: string): void {
    void name;
  }

  /** Whether any element (or cached answer) has carried `scope` — see the
   * fast path in registerSheet. */
  protected abstract scopeSeen(scope: string): boolean;

  /** A sheet changed what every cached answer may be: drop them all. */
  protected abstract invalidateAll(): void;

  /** The viewport moved while @media rules exist. */
  protected abstract viewportChanged(): void;

  /** The inline record an edit writes to (created on demand where the
   * engine cannot tell an unregistered id from one never styled). */
  protected abstract inlineState(id: number): InlineLayers | undefined;

  /** The inline record to read back, never created. */
  protected abstract inlineRead(id: number): InlineLayers | undefined;

  /** An inline record changed: restyle the element and its subtree. */
  protected abstract inlineChanged(id: number, s: InlineLayers): void;
}

