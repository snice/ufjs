// Style engine: stores rules parsed from <style> blocks, matches them
// against elements, and computes each element's final style object
// (cascade by specificity + source order, then CSS inheritance along the
// element tree). The Vue renderer feeds element state (tag/class/scopes/
// inline style) and applies computed styles back through setProps, so the
// native bridge keeps receiving exactly one merged `style` map per element.
import { DISABLED_CLASS, camelize, normalizeValue, parseInlineCss, parseStylesheet, warnOnce, type AttrTest, type ClassAttrTest, type CssRule, type Selector, mediaMatches } from './parser';
import { registerFontFace, type FontFaceDecl } from './font-face';
import type { KeyframesDecl } from './animation';
import { NativeStyleBackend } from './native-style';
import { setOpSink } from '../host';

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
/** Pseudo-style comparison for the notification decision: all kinds
 * compared shallowly — values are normalized scalars by the time they get
 * here (numbers, strings, resolved var()/em output). */
function pseudoChanged(next: PseudoStyles, prev: PseudoStyles | null | undefined): boolean {
  const kind = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined) => {
    if (a === undefined || b === undefined) return a !== b;
    for (const k in a) if (a[k] !== b[k]) return true;
    for (const k in b) if (!(k in a)) return true;
    return false;
  };
  return (
    kind(next.before, prev?.before) ||
    kind(next.after, prev?.after) ||
    kind(next.placeholder, prev?.placeholder) ||
    kind(next.activeBefore, prev?.activeBefore) ||
    kind(next.activeAfter, prev?.activeAfter)
  );
}

// CSS allows a leading-dot decimal without an integer part (`.8em`) —
// vant uses it for every icon glyph size.
const EM_LENGTH = /^(-?\d*\.?\d+)em$/;
const EM_TOKEN = /(-?\d*\.?\d+)em\b/g;

/**
 * One `[class<op>value]` test against an element's class list. The class
 * ATTRIBUTE string is rebuilt from the list in source order (the set keeps
 * insertion order), so `^=`/`$=`/`=` see what the markup said, modulo
 * whitespace and duplicate classes.
 */
const DISABLEABLE_TAGS = new Set(['input', 'textarea', 'button', 'select', 'option', 'fieldset']);

function matchClassAttr(t: ClassAttrTest, all: Set<string>): boolean {
  const v = t.value;
  // the `:disabled` state token is not part of the class attribute
  const classes = all.has(DISABLED_CLASS) ? new Set([...all].filter((c) => c !== DISABLED_CLASS)) : all;
  switch (t.op) {
    case '~=':
      return classes.has(v);
    case '|=':
      for (const c of classes) if (c === v || c.startsWith(`${v}-`)) return true;
      return false;
  }
  const attr = [...classes].join(' ');
  switch (t.op) {
    case '=':
      return attr === v;
    case '^=':
      return v !== '' && attr.startsWith(v);
    case '$=':
      return v !== '' && attr.endsWith(v);
    default: // '*='
      return v !== '' && attr.includes(v);
  }
}

/** One `[name]` / `[name<op>value]` test against the reported attributes.
 * `[class]` alone asks whether the element has any class. */
function matchAttr(t: AttrTest, s: ElementState): boolean {
  const attr = t.name === 'class' ? (s.classes.size > 0 ? '' : undefined) : s.attrs?.get(t.name);
  if (attr === undefined) return false;
  if (t.op === undefined) return true;
  const v = t.value ?? '';
  switch (t.op) {
    case '=':
      return attr === v;
    case '~=':
      return v !== '' && attr.split(/\s+/).includes(v);
    case '|=':
      return attr === v || attr.startsWith(`${v}-`);
    case '^=':
      return v !== '' && attr.startsWith(v);
    case '$=':
      return v !== '' && attr.endsWith(v);
    default: // '*='
      return v !== '' && attr.includes(v);
  }
}

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

/** A flush pass's walk of one parent's child list (StyleEngine.locate):
 * the last child placed, where, and the participating sibling at or before
 * it — the next one's `+` neighbour. */
interface SiblingCursor {
  kids: number[];
  at: number;
  id: number;
  prev: number | null;
  /** `prev` is the first participating child. */
  prevFirst: boolean;
}

/** How far locate() walks past the last child placed before giving up on
 * the walk: v-if anchors and clean siblings between two dirty ones. */
const LOCATE_MAX_STEP = 8;

interface ElementState {
  tag: string;
  classes: Set<string>;
  scopes: Set<string>;
  /** Renderer-synthesized bare-text element (`createText`); excluded from
   * sibling position for structural pseudos. Explicit `<text>` is not. */
  rawText?: boolean;
  defaults?: Record<string, unknown>; // HTML tag default style (h1, tr, ...)
  inline?: Record<string, unknown>;
  inlineCustom?: Record<string, string>; // inline `--x` props
  /** `inlineKey` of the inline pair it was built from (see inlineKeyOf). */
  inlineKeyCache?: { inline?: Record<string, unknown>; custom?: Record<string, string>; key: string };
  custom?: Record<string, string>; // computed custom props (cascade + inherited)
  computed?: Record<string, unknown>; // last computed merged style (inheritance source for children)
  computedKeys?: string[]; // `computed`'s own keys (see ComputeResult.keys)
  appliedKeys?: string[]; // `applied`'s own keys
  activeKeys?: string[]; // `activeComputed`'s own keys
  appliedActiveKeys?: string[];
  activeComputed?: Record<string, unknown>; // the same style while pressed (:active), if any
  hoverKeys?: string[]; // `hoverComputed`'s own keys
  appliedHoverKeys?: string[];
  hoverComputed?: Record<string, unknown>; // the same style while hovered (:hover), if any
  /** True once the element has matched a `:hover` rule. Unlike `:active`
   * (a fixed-width slot in op 8), hover crosses as its own op, so the
   * engine only sends it for elements that actually have one — `undefined`
   * in applyStyle means "never had a hover variant, say nothing". */
  hadHover?: boolean;
  chainKey?: string; // matching-relevant signature of self + ancestor chain
  chainId?: number; // interned id of chainKey (keeps ancestor keys O(1))
  matched?: MatchResult; // last match, reusable while the inputs below hold
  matchedParentChainId?: number;
  matchedEpoch?: number;
  defaultsId?: number; // identity token of `defaults`
  computedId?: number; // identity token of `computed`
  customId?: number; // identity token of `custom`
  /** Attributes the renderer reported (data-* / aria-* / role / tabindex).
   * Only names some selector tests reach the chain key (attrNames). */
  attrs?: Map<string, string>;
  selfSig?: string; // cached `tag|classes|scopes` part of the chain key
  structBits?: number; // last seen first/last bits (selfSig embeds them)
  /** Last seen signature of the previous participating sibling — only
   * tracked while some `A + B` rule exists, and part of the chain key. */
  prevSig?: string;
  /** The dirtyEpoch of the flush pass that last recomputed this element —
   * a sibling later in the same pass may reuse its match (specs/146→147). */
  pass?: number;
  /** `tag|classes|scopes` as the NEXT sibling's `+` signature spells it,
   * with the class / scope sets it was built from (validated by identity:
   * both sets are replaced, never mutated). */
  sibBase?: { classes: Set<string>; scopes: Set<string>; str: string; withBits?: string[] };
  dirtyEpoch?: number; // which pending set this element is already in
  /** The pending set in which this element's WHOLE subtree was walked by
   * markDirty(id, true). A later subtree walk in the same set stops here:
   * everything below is already queued (see markDirty). */
  subtreeEpoch?: number;
  applied?: Record<string, unknown>; // last style actually pushed to native
  appliedActive?: Record<string, unknown>; // last :active style pushed to native
  appliedHover?: Record<string, unknown>; // last :hover style pushed to native
  pseudo?: PseudoStyles; // current computed pseudo-element styles
  pseudoApplied?: PseudoStyles | null; // last pseudo styles pushed to the renderer
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
type ComputeSubject = Pick<ElementState, 'tag' | 'rawText' | 'defaults' | 'defaultsId' | 'inline' | 'inlineCustom'>;

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
  /** Hashes of the sheets whose rules this match drew on — recorded only
   * during a build-time capture (StyleEngine.trackSheets, specs/119). */
  sheets?: string[];
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

/** How many dead chains to keep around before evicting the oldest. A chain
 * holds its key string, its id and a MatchResult (declarations plus the
 * per-parent compute cache) — low hundreds of bytes each, so the cap bounds
 * retention at roughly a page's worth of signatures (~0.2 MB). The point of
 * keeping them: navigating BACK to a page hits the retained matches instead
 * of re-paying the full mount (specs/076). */
const RETIRED_CHAIN_LIMIT = 512;

/** Bump when the snapshot layout or the meaning of any cached field changes:
 * an older snapshot is then refused instead of misread. */
export const STYLE_SNAPSHOT_VERSION = 3;

/** A compute entry's custom slot meaning "the table inherited from the
 * parent entry (the :root table for a root)" — see exportSnapshot. */
const CUSTOM_INHERITED = -2;

/** A page's style caches, built by `fjs build` in Node (specs/119). Object
 * slots are indices into `objs` (-1 = none); chains and computes are trees
 * (a parent entry index, -1 for none) because the runtime keys embed ids
 * that only exist once the parent is replayed — see importSnapshot. */
export interface StyleSnapshot {
  v: number;
  /** hasStructural, hasSiblingRules, hasPseudo at capture. */
  flags: [boolean, boolean, boolean];
  /** Each distinct @media condition (as JSON) and whether it held. */
  media: Array<[string, boolean]>;
  /** Hashes of the sheets the cached answers depend on, registration order. */
  sheets: string[];
  /** Every global (unscoped) sheet registered at capture. */
  globals: string[];
  objs: unknown[];
  /** [parent chain, key after the parent id, match]. */
  chains: Array<[number, string, number]>;
  /** [decls, custom, active, hover, before, after, placeholder,
   *  activeBefore, activeAfter]. */
  matches: Array<[number, number, number, number, number, number, number, number, number]>;
  /** [chain, parent compute, style, active, hover, custom, pseudo,
   *  defaults JSON ('' = none), rawText 0/1, inline key ('' = no inline
   *  style; v3, specs/144)]. */
  computes: Array<[number, number, number, number, number, number, number, string, number, string]>;
}

/**
 * Candidate buckets for one rule set (plain rules and `::before`/`::after`
 * rules each get their own): rules grouped by a property of the selector's
 * SUBJECT (rightmost compound) that the element itself must satisfy for the
 * selector to have any chance of matching. `matchRules` walks the element's
 * class buckets, its tag bucket and the catch-all instead of scanning every
 * registered rule — a component library registering its whole stylesheet
 * (vant: 639 rules) made that scan the dominant cost of a page mount
 * (specs/075, docs/vant-mount-perf.md).
 */
interface RuleBuckets {
  byClass: Map<string, CssRule[]>;
  byTag: Map<string, CssRule[]>;
  /** Subjects that carry neither a class nor a tag (`*`, `[class*=…]`,
   * bare `:first-child`) — nothing to key on, so they are always walked.
   * The index may over-approximate the candidate set; it must never
   * under-approximate one (constitution V), and this bucket is the safety
   * net that keeps that promise for the selectors it cannot classify. */
  catchAll: CssRule[];
}

/** CssRule plus the per-walk dedupe stamp the candidate walk leaves on
 * rules. A rule with several selectors is indexed once per subject key, so
 * one element can reach it from several buckets; style-local type, the
 * parser stays unaware of the index. */
type IndexedRule = CssRule & { bucketStamp?: number };

function newBuckets(): RuleBuckets {
  return { byClass: new Map(), byTag: new Map(), catchAll: [] };
}

/** True when the map has at least one entry. The custom-property map is
 * always an object (MatchResult mints one per match), sometimes an empty
 * one, and "empty" counts as absent for the source-counting in compute(). */
function hasKeys(map: Record<string, unknown> | undefined): boolean {
  if (map === undefined) return false;
  for (const k in map) {
    return true;
  }
  return false;
}

/**
 * Files `rule` under every subject key of its selectors. Key choice: the
 * subject's first class, else its tag, else the catch-all. The first class
 * is safe because subject matching requires the element to hold ALL of the
 * subject's classes (`matchCompoundFrom`), so "has the first class" is a
 * necessary condition — a selector whose subject is `.a.b` lives only in
 * the `a` bucket and is still found by every element that could match it.
 */
function indexRule(buckets: RuleBuckets, rule: CssRule): void {
  for (const sel of rule.selectors) {
    const subject = sel.compounds[sel.compounds.length - 1];
    const cls = subject.classes.length > 0 ? subject.classes[0] : null;
    if (cls !== null) {
      const bucket = buckets.byClass.get(cls);
      if (bucket === undefined) buckets.byClass.set(cls, [rule]);
      else bucket.push(rule);
    } else if (subject.tag != null) {
      const bucket = buckets.byTag.get(subject.tag);
      if (bucket === undefined) buckets.byTag.set(subject.tag, [rule]);
      else bucket.push(rule);
    } else {
      buckets.catchAll.push(rule);
    }
  }
}

export class StyleEngine {
  private rules: CssRule[] = [];
  private nextOrder = 0;
  /** Subject-keyed candidates over `rules` / `pseudoRules`, maintained
   * incrementally by [register] (rules are append-only here). Replaces the
   * per-miss full scan; see [indexRule]. */
  private plainBuckets = newBuckets();
  private pseudoBuckets = newBuckets();
  /** Dedupe stamp for one candidate walk — plain and pseudo walks share the
   * counter safely because a rule lives in exactly one of the two sets. */
  private bucketEpoch = 0;
  /** Per-match scratch (the [walkStack] precedent): cascade collections for
   * the current matchRules miss, so a miss allocates only its result. */
  private matchPlain: Array<{ rule: CssRule; spec: number }> = [];
  private matchActive: Array<{ rule: CssRule; spec: number }> = [];
  private matchHover: Array<{ rule: CssRule; spec: number }> = [];
  private matchAnyActive = false;
  private matchAnyHover = false;
  /** Dead chains kept for re-use, oldest first — see RETIRED_CHAIN_LIMIT.
   * `retiredHead` indexes into the queue so trimming never shifts the
   * array; the set dedupes re-releases of an already-retired key. */
  private retiredChains: string[] = [];
  private retiredSet = new Set<string>();
  private retiredHead = 0;
  private states = new Map<number, ElementState>();
  /** `::before` / `::after` rules, kept out of `rules` so their declarations
   * can never style the element itself. */
  private pseudoRules: CssRule[] | undefined;
  private hasPseudo = false;
  /** True once a registered stylesheet contains `@media` rules. Viewport
   * changes then invalidate the whole match cache; with the flag off
   * `setViewport` is an equality check and nothing else. */
  private hasMedia = false;
  private viewport = { width: FALLBACK_VIEWPORT.width, height: FALLBACK_VIEWPORT.height };
  /** True once a registered stylesheet contains `:first-child`/`:last-child`.
   * Sibling position is then part of the match key and every tree mutation
   * re-marks siblings; with the flag off both costs stay at zero. */
  private hasStructural = false;
  /** Some registered selector uses `A + B`: matching then depends on the
   * previous sibling too, which the chain key and the dirty marks must
   * reflect. Off until the first such rule shows up, so pages without one
   * pay nothing. */
  private hasSiblingRules = false;
  /** Attribute names some registered selector tests (`[data-x=…]`), besides
   * `class`. Only these join the chain key and restyle on change: vant
   * writes aria-/data- attributes on nearly every element, and matching
   * never needs the rest. */
  private attrNames = new Set<string>();
  /** Custom properties declared on `:root` / `:host`, in source order. They
   * seed the inheritance chain wherever a parent has nothing to pass down
   * (the top of each page tree), which is how a browser sees them: every
   * element inherits from the document root. */
  private rootCustom: Record<string, string> | undefined;
  /** `@keyframes` by name; a later block of the same name replaces it. */
  private keyframes = new Map<string, KeyframesDecl>();
  /** Resolved frames per name, for blocks with no var() in them — shared,
   * so every element running the animation compares equal by identity. */
  private keyframesStatic = new Map<string, AnimationFrame[]>();
  /** Dirty elements as a plain array, deduplicated by stamping the element
   * rather than hashing it. A Set here grew to the size of the tree on every
   * restyle and was then copied out again to be sorted; on a device the
   * allocation that costs more than the work. */
  private dirtyList: number[] = [];
  private dirtyEpoch = 1;
  /** The mount fast paths of specs/149 (queuedAlone, the sibling cursor,
   * whole-result reuse). Always on; the parity test turns it off to get
   * the element-by-element reference. */
  private batch = true;
  /** Parent id → the pending set its children were all queued in, for
   * noteStructureChange. Stale entries are harmless (the epoch moved on);
   * forget() drops a parent's entry with its state. */
  private structureNoted = new Map<number, number>();
  /** Parent id → each child's index in the parent's child list, rebuilt on
   * demand and dropped at every flush. Every lookup is verified against the
   * live list (`kids[i] === id`), so a list changed mid-flush — a fixed
   * element hoisted out from applyStyle — only costs a rebuild. Without it,
   * finding your own position was a linear scan per element: O(N²) for a
   * row of N (specs/147). */
  private siblingIdx = new Map<number, Map<number, number>>();
  /** Parent chain id → elements matched in this flush pass under it, as
   * exemplars for same-shape elements that follow (see matchRules). Dropped
   * with siblingIdx at every pass. */
  private shapeMemo = new Map<number, ElementState[]>();
  /** Parent id → how far this flush pass has walked its child list (see
   * locate). Dropped with siblingIdx at every pass. */
  private cursors = new Map<number, SiblingCursor>();
  /** locate()'s answer, in fields rather than a fresh object per element:
   * the element's first/last bits, its previous participating sibling, and
   * whether that sibling is itself the first. */
  private locBits = 0;
  private locPrev: number | null = null;
  private locPrevFirst = false;
  private flushQueued = false;
  private matchCache = new Map<string, MatchResult>();
  /** chainKey -> small integer, so a child's key embeds its parent's id
   * instead of the parent's whole key (mount builds one key per element and
   * deep trees made those strings grow with depth). */
  private chainIds = new Map<string, number>();
  private chainRefs = new Map<string, number>();
  private nextChainId = 1;
  /** Bumped when the stylesheet changes, which invalidates every element's
   * remembered match without having to walk them. */
  private matchEpoch = 1;
  /** Identity tokens for the objects the compute cache keys on. Numbers
   * (assigned where each object is created) keep the key a short string and
   * the lookup allocation-free. */
  private nextObjId = 1;
  private defaultsIds = new WeakMap<object, number>();
  /** Defaults ids by CONTENT, so the same tag defaults get the same id in a
   * build-time capture and on the device, whatever order the tags first
   * appear in (a snapshot names defaults by their JSON, specs/119). */
  private defaultsIdByJson = new Map<string, number>();
  /** Every registered sheet in order: its build-time hash ('' if none) and
   * whether it is scoped. What a style snapshot is checked against. */
  private sheetLog: { hash: string; scoped: boolean }[] = [];
  /** Sheets that are inputs to styles without a selector matching through
   * them — `:root` tokens and `@keyframes`. Always part of a snapshot's
   * dependencies. */
  private inputSheets = new Set<string>();
  /** Every scope an element has carried, or that an imported snapshot's
   * chains mention. Only grows. A scoped sheet whose scope is NOT in here
   * cannot change any cached answer — see the fast path in register(). */
  private seenScopes = new Set<string>();
  /** Record which sheets each match drew on (MatchResult.sheets). Only the
   * build-time capture needs it, and it is decided before the first match
   * so no cached result lacks the list (specs/119). */
  private readonly trackSheets =
    typeof (globalThis as { __fjsCaptureStyles?: unknown }).__fjsCaptureStyles === 'function';
  /** Reused by markDirty so a walk allocates nothing. */
  private walkStack: number[] = [];
  private counters = { recompute: 0, computeHit: 0, computeMiss: 0, matchHit: 0, matchMiss: 0, applied: 0, flushMs: 0, flushes: 0, markMs: 0, markCalls: 0, markVisited: 0 };

  /** Counters since [resetStats]. Cheap enough to leave on (a few integer
   * increments per element); `examples/hello-fjs`'s theme page reads them. */
  get stats(): StyleEngineStats {
    const base = {
      ...this.counters,
      elements: this.states.size,
      rules: this.rules.length,
    };
    return this.nativeOnly ? this.native!.stats(base) : base;
  }

  /** The native style engine (specs/150), once attached. The per-element
   * entry points then only write style input ops; libfjs-style keeps the
   * element state and calls back into buildMatch / computeResult. */
  private native: NativeStyleBackend | undefined;
  /** Native attached and not verifying: the TS half is off. */
  private nativeOnly = false;
  /** Verify mode (specs/150): elements the TS engine recomputed since the
   * last comparison, and what the comparisons found. */
  private verifyIds: number[] | undefined;
  private verifyCounts = { compared: 0, mismatched: 0 };

  /** Hands the per-element half to libfjs-style. Call before the first
   * element is registered: state already held here is not migrated.
   *
   * `verify`: both engines run. The TS one keeps its state and writes its
   * styles as always; libfjs-style's land after them in each frame (and
   * win). After every frame the elements the TS engine recomputed are
   * compared with libfjs-style's results and differences are logged — any
   * app becomes a parity test, on fjsrun or a device. */
  attachNative(fns: FjsNativeFns, verify = false): boolean {
    if (this.native !== undefined || fns.styleAttach === undefined || this.states.size > 0) return false;
    this.native = new NativeStyleBackend(
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
    if (this.rules.length > 0 || this.pseudoRules !== undefined) this.native.sendRules();
    this.nativeOnly = !verify;
    if (verify) {
      this.native.verifying = true;
      this.verifyIds = [];
      const next = setOpSink((frame) => {
        next(frame);
        this.compareNative();
      });
    }
    return true;
  }

  /** Verify mode: what the comparisons found so far. */
  get verifyStats(): { compared: number; mismatched: number } {
    return { ...this.verifyCounts };
  }

  private compareNative(): void {
    const ids = this.verifyIds!;
    if (ids.length === 0) return;
    this.verifyIds = [];
    const native = this.native!;
    for (const id of ids) {
      const s = this.states.get(id);
      if (s === undefined || s.computed === undefined) continue;
      const r = native.resultOf(id);
      if (r === null) continue; // detached: nothing left to compare
      this.verifyCounts.compared++;
      const ts = JSON.stringify([s.computed, s.activeComputed ?? null, s.hoverComputed ?? null, s.pseudo ?? null]);
      const nv = r === undefined ? 'none' : JSON.stringify([r.style, r.activeStyle ?? null, r.hoverStyle ?? null, r.pseudo ?? null]);
      if (ts === nv) continue;
      if (++this.verifyCounts.mismatched <= 20) {
        const cls = [...s.classes].join('.');
        console.error(`[fjs] native style verify: #${id} <${s.tag}${cls ? `.${cls}` : ''}> ts=${ts} native=${nv}`);
      }
    }
  }

  get nativeAttached(): boolean {
    return this.native !== undefined;
  }

  resetStats(): void {
    this.native?.resetStats();
    this.counters = { recompute: 0, computeHit: 0, computeMiss: 0, matchHit: 0, matchMiss: 0, applied: 0, flushMs: 0, flushes: 0, markMs: 0, markCalls: 0, markVisited: 0 };
  }

  constructor(
    private readonly parentOf: Map<number, number | null>,
    private readonly childrenOf: Map<number, number[]>,
    private readonly applyStyle: (
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
    ) => void,
  ) {}

  /** Registers a <style> block. scope=null means global (non-scoped). */
  register(scope: string | null, cssText: string, hash = ''): void {
    const outcome = this.registerSheet(scope, cssText, hash);
    if (this.native === undefined || outcome === null) return;
    // libfjs-style gets the sheet's rules appended either way (resending the
    // whole table per sheet was quadratic: vant registers dozens); outside
    // the fast path every cache is dropped on top, as here
    this.native.appendRules(outcome === 'full' ? this.lastAdded : outcome);
    if (outcome === 'full') this.native.restyleAll();
  }

  /** Registers one sheet. Returns null when it added no rules, the rules it
   * added when the fast path below applied (no cached answer can change),
   * 'full' when every cache was invalidated. */
  private registerSheet(scope: string | null, cssText: string, hash: string): CssRule[] | 'full' | null {
    // every sheet, in order, for the style snapshot check (specs/119)
    this.sheetLog.push({ hash, scoped: scope !== null });
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
    // keyframes feed computed `animation` styles without any rule matching
    // through them, so a snapshot depends on the sheet all the same
    if (keyframes.length > 0) this.inputSheets.add(hash);
    if (all.length === 0) return null;
    for (const r of all) r.sheet = hash;
    this.nextOrder = all[all.length - 1].order + 1;
    const parsed: CssRule[] = [];
    for (const r of all) {
      if (r.root !== true) {
        // pseudo-element rules cascade in their own bucket: their selectors
        // match the element, but the declarations must never style it
        if (r.pseudo !== undefined) {
          (this.pseudoRules ??= []).push(r);
          this.hasPseudo = true;
          indexRule(this.pseudoBuckets, r);
        } else {
          parsed.push(r);
        }
        continue;
      }
      // :root tokens are an input to every computed style on the page
      this.inputSheets.add(hash);
      touchesRoot = true;
      for (const [k, v] of Object.entries(r.decls)) {
        if (k.startsWith('--')) (this.rootCustom ??= {})[normalizeVarKey(k)] = String(v);
        else warnOnce(`":root" declaration "${k}" is not supported (only custom properties), skipped`);
      }
    }
    this.rules.push(...parsed);
    for (const r of parsed) indexRule(this.plainBuckets, r);
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
            // elements that already carry it were keyed without it
            for (const [eid, st] of this.states) {
              if (st.attrs?.has(t.name)) {
                st.selfSig = undefined;
                this.markDirty(eid, true);
              }
            }
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
      !this.seenScopes.has(scope) &&
      !(this.native?.hasSeenScope(scope) ?? false) &&
      !touchesRoot &&
      keyframes.length === 0 &&
      this.shapeFlags() === flagsBefore
    ) {
      return all.filter((r) => r.root !== true);
    }
    this.matchEpoch++;
    // every MatchResult (and the computed styles hanging off it) is stale
    this.matchCache.clear();
    // retained caches died with the epoch — drop the queue so the trim
    // doesn't do cleanup the clear already did
    this.retiredChains.length = 0;
    this.retiredHead = 0;
    this.retiredSet.clear();
    for (const id of this.states.keys()) this.mark(id);
    this.scheduleFlush();
    this.lastAdded = all.filter((r) => r.root !== true);
    return 'full';
  }

  /** The rules the last 'full' registerSheet added (see register). */
  private lastAdded: CssRule[] = [];

  /** The identity token of a tag-defaults object (see defaultsIdForJson). */
  private defaultsIdOf(defaults: Record<string, unknown>): number {
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

  /** Registers an element created by the renderer. `tag` is the ORIGINAL
   * tag the user wrote (div, span, ...) so CSS selectors match it. `rawText`
   * marks a text element the renderer synthesized for bare string content
   * (`createText`), as opposed to an explicit `<text>` the page wrote: raw
   * text is a real element in the fjs tree but a plain text node in the
   * browser DOM, so it must not count for `:first-child`/`:last-child`
   * position (see the plan's two mixing cases). */
  ensure(id: number, tag: string, defaults?: Record<string, unknown>, rawText?: boolean): void {
    if (this.native !== undefined) {
      // libfjs-style ignores a second registration, as the check below does
      this.native.ensure(id, tag, defaults ? this.defaultsIdOf(defaults) : 0, defaults, rawText === true);
      if (this.nativeOnly) return;
    }
    if (this.states.has(id)) return;
    const defaultsId = defaults ? this.defaultsIdOf(defaults) : 0;
    const epoch = this.dirtyEpoch;
    const kids = this.childrenOf.get(id);
    const state: ElementState = {
      tag,
      // shared until first written: most elements get a class list (which
      // replaces this set wholesale) and many never get a scope — two fresh
      // Sets per created element were pure allocation (specs/118)
      classes: EMPTY_CLASSES,
      scopes: EMPTY_CLASSES,
      defaults,
      defaultsId,
      rawText,
      // queued: mark() inlined — the state is new, so it cannot be in the
      // pending set already, and a second lookup of what we are holding was
      // most of what mark() costs here (specs/149)
      dirtyEpoch: epoch,
      // A fresh element has no children, so queuing it IS queuing its whole
      // subtree: stamp it as walked. Anything attached below it later is
      // queued by its own insert — the same invariant the walk's stamp
      // relies on — so the addScope / setClasses / insert that follow in the
      // same pending set all take markDirty's early return instead of each
      // walking (specs/146). An element registered with children already
      // under it (a harness registering a built tree) is left to the first
      // real walk.
      subtreeEpoch: kids === undefined || kids.length === 0 ? epoch : undefined,
    };
    this.states.set(id, state);
    this.dirtyList.push(id);
    this.scheduleFlush();
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
    if (this.native !== undefined) {
      // media conditions are judged here and baked into the table
      this.native.sendRules();
      if (this.nativeOnly) return;
    }
    this.matchEpoch++;
    this.matchCache.clear();
    this.retiredChains.length = 0;
    this.retiredHead = 0;
    this.retiredSet.clear();
    for (const id of this.states.keys()) this.mark(id);
    this.scheduleFlush();
  }

  /** Sibling structure changed under `parentId` (insert / remove / v-for
   * move): every child's `:first-child`/`:last-child` position may have
   * flipped, and with `A + B` rules in play so may everyone's "previous
   * sibling". Marks the registered children; each recompute compares fresh
   * position bits / sibling signature against the cached ones and only
   * elements that actually moved pay for a subtree re-key. No-op while no
   * structural or sibling rules exist. */
  noteStructureChange(parentId: number): void {
    // native: libfjs-style reads the structure off the Insert / Remove ops
    if (this.nativeOnly) return;
    if (!this.hasStructural && !this.hasSiblingRules) return;
    // Once per parent per pending set. After one full pass every child is
    // queued, and queued stays queued until the flush bumps dirtyEpoch; a
    // child attached afterwards was queued by its own attach — every path
    // that adds to a child list (the renderer's insert, hoist, unhoist,
    // host migration) calls recomputeSubtree on the child first. Without
    // this, building a row of N children re-marked 1 + 2 + … + N of them
    // (specs/146: 8.5 → ~2 ms for 4150 elements with structural rules on).
    if (this.structureNoted.get(parentId) === this.dirtyEpoch) {
      this.scheduleFlush();
      return;
    }
    const kids = this.childrenOf.get(parentId);
    if (kids === undefined) return;
    for (let i = 0; i < kids.length; i++) this.mark(kids[i]);
    this.structureNoted.set(parentId, this.dirtyEpoch);
    this.scheduleFlush();
  }

  // ---- build-time style snapshot (specs/119) ---------------------------------
  //
  // A page's match and compute caches are a pure function of its element tree
  // and the registered sheets, so `fjs build` fills them in Node and ships the
  // result; the router imports it before the page mounts and a first open
  // runs as warm as a reopen. Two runtime counters make the caches
  // unportable as they stand — chain keys embed the PARENT's chain id, and
  // compute results are keyed by the parent's computed-style id — so the
  // snapshot stores both as trees (parent entry index + own part) and the
  // import replays them, minting the ids the device would have minted.
  //
  // Inputs that decide a cached answer but are NOT in its key, each checked
  // before import (snapshotMismatch) — add to this list if the engine grows
  // another one, or a stale snapshot will be applied silently:
  //   the registered sheets (and their order), the viewport's @media
  //   outcomes, the engine flags that shape signatures and match results
  //   (structural / sibling / pseudo rules), :root tokens and @keyframes
  //   (inputSheets), tag defaults (by content) and rawText (in the entry).

  /** The flags that decide signature format and match-result shape, as one
   * comparable value (register's fast path compares before / after). */
  private shapeFlags(): number {
    return (this.hasMedia ? 1 : 0) | (this.hasStructural ? 2 : 0) | (this.hasSiblingRules ? 4 : 0) | (this.hasPseudo ? 8 : 0);
  }

  /** Changes whenever cached matches are invalidated; the router imports a
   * page's snapshot again only after it moved. */
  get snapshotEpoch(): number {
    return this.matchEpoch;
  }

  /** The caches behind every live element, as a snapshot. Call after the
   * page mounted and flushed; meant for the build-time capture, whose engine
   * records each match's sheets (trackSheets). */
  exportSnapshot(): StyleSnapshot {
    const objs: unknown[] = [];
    const objIndex = new Map<string, number>();
    const ref = (o: unknown): number => {
      if (o === undefined || o === null) return -1;
      const json = JSON.stringify(o);
      let i = objIndex.get(json);
      if (i === undefined) {
        i = objs.length;
        objs.push(o);
        objIndex.set(json, i);
      }
      return i;
    };
    const sheets = new Set<string>(this.inputSheets);
    const chains: StyleSnapshot['chains'] = [];
    const matches: StyleSnapshot['matches'] = [];
    const computes: StyleSnapshot['computes'] = [];
    const chainIndex = new Map<string, number>();
    const matchIndex = new Map<MatchResult, number>();
    const computeIndex = new Map<string, number>();

    // parents before children: walk from the elements whose parent has no
    // engine state (page roots, hoisted overlays), not by id — a hoisted
    // element can be older than the overlay host it now lives in
    const roots: number[] = [];
    for (const id of this.states.keys()) {
      const pid = this.parentOf.get(id);
      if (pid == null || !this.states.has(pid)) roots.push(id);
    }
    roots.sort((a, b) => a - b);
    const stack: Array<[number, number, number, Record<string, string> | undefined]> = [];
    for (let r = roots.length - 1; r >= 0; r--) stack.push([roots[r], -1, -1, this.rootCustom]);
    while (stack.length > 0) {
      const [id, parentChain, parentCompute, inheritedCustom] = stack.pop()!;
      const s = this.states.get(id)!;
      const key = s.chainKey;
      const matched = s.matched;
      // an element never matched (or whose parent's chain is not in the
      // snapshot) cannot be keyed; its subtree is left to compute cold
      if (key === undefined || matched === undefined) continue;
      let chain = chainIndex.get(key);
      if (chain === undefined) {
        let match = matchIndex.get(matched);
        if (match === undefined) {
          match = matches.length;
          matchIndex.set(matched, match);
          matches.push([
            ref(matched.decls), ref(matched.custom), ref(matched.activeDecls), ref(matched.hoverDecls),
            ref(matched.beforeDecls), ref(matched.afterDecls), ref(matched.placeholderDecls),
            ref(matched.activeBeforeDecls), ref(matched.activeAfterDecls),
          ]);
          for (const h of matched.sheets ?? []) sheets.add(h);
        }
        chain = chains.length;
        chainIndex.set(key, chain);
        chains.push([parentChain, key.slice(key.indexOf('\u0003') + 1), match]);
      }
      let compute = -1;
      // Inline-styled elements are exported too since v3 (specs/144): before,
      // they were skipped and so was their whole subtree (no parent compute
      // to key the children on) — the bulk of a vant form's cold misses.
      const inlineKey = s.inline === undefined && s.inlineCustom === undefined ? '' : this.inlineKeyOf(s);
      const parentStateless = parentChain < 0;
      if (s.computed !== undefined && s.computedId !== undefined && (parentStateless || parentCompute >= 0)) {
        const rawText = s.rawText === true ? 1 : 0;
        const ckey = `${chain}:${parentCompute}:${inlineKey}`;
        const seen = computeIndex.get(ckey);
        if (seen !== undefined) {
          compute = seen;
        } else {
          compute = computes.length;
          computeIndex.set(ckey, compute);
          // The custom-property table is usually the very object inherited
          // from the parent (or the :root one) — vant's is ~500 tokens, so
          // spelling it out per entry made a snapshot mostly copies of it.
          // Stored as a reference instead; the import resolves it the same
          // way compute() shares it.
          const custom =
            s.custom === undefined ? -1
              : s.custom === inheritedCustom ? CUSTOM_INHERITED
                : ref(s.custom);
          computes.push([
            chain, parentCompute, ref(s.computed), ref(s.activeComputed), ref(s.hoverComputed),
            custom, ref(s.pseudo), s.defaults ? JSON.stringify(s.defaults) : '', rawText, inlineKey,
          ]);
        }
      }
      const kids = this.childrenOf.get(id);
      if (kids !== undefined) {
        for (let i = kids.length - 1; i >= 0; i--) {
          if (this.states.has(kids[i])) stack.push([kids[i], chain, compute, s.custom]);
        }
      }
    }
    const media: Array<[string, boolean]> = [];
    const seenMedia = new Set<string>();
    for (const rule of [...this.rules, ...(this.pseudoRules ?? [])]) {
      if (rule.media === undefined) continue;
      const json = JSON.stringify(rule.media);
      if (seenMedia.has(json)) continue;
      seenMedia.add(json);
      media.push([json, mediaMatches(rule.media, this.viewport.width, this.viewport.height)]);
    }
    const order = new Map<string, number>();
    this.sheetLog.forEach((e, i) => {
      if (!order.has(e.hash)) order.set(e.hash, i);
    });
    return {
      v: STYLE_SNAPSHOT_VERSION,
      flags: [this.hasStructural, this.hasSiblingRules, this.hasPseudo],
      media,
      sheets: [...sheets].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
      globals: this.sheetLog.filter((e) => !e.scoped).map((e) => e.hash),
      objs,
      chains,
      matches,
      computes,
    };
  }

  /** Why `snap` does not describe this engine's current state, or null when
   * it does. See the input list above the section. */
  snapshotMismatch(snap: StyleSnapshot): string | null {
    if (snap.v !== STYLE_SNAPSHOT_VERSION) return `version ${String(snap.v)}`;
    const [structural, sibling, pseudo] = snap.flags;
    if (structural !== this.hasStructural || sibling !== this.hasSiblingRules || pseudo !== this.hasPseudo) {
      return 'engine flags differ (structural / sibling / pseudo rules)';
    }
    for (const [json, matched] of snap.media) {
      if (mediaMatches(JSON.parse(json), this.viewport.width, this.viewport.height) !== matched) {
        return `@media outcome differs (${this.viewport.width}x${this.viewport.height})`;
      }
    }
    const position = new Map<string, number>();
    this.sheetLog.forEach((e, i) => {
      if (!position.has(e.hash)) position.set(e.hash, i);
    });
    let last = -1;
    for (const h of snap.sheets) {
      const at = position.get(h);
      if (at === undefined) return `sheet ${h || '(unhashed)'} is not registered`;
      if (at < last) return 'sheets registered in a different order';
      last = at;
    }
    const globals = new Set(snap.globals);
    for (const e of this.sheetLog) {
      if (e.scoped) continue;
      if (e.hash === '') return 'a global sheet without a build hash is registered';
      if (!globals.has(e.hash)) return `global sheet ${e.hash} was not there at build time`;
    }
    return null;
  }

  /** Fills the caches from a snapshot (object or its JSON). All-or-nothing:
   * returns false, touching nothing, when the snapshot does not match the
   * registered sheets / viewport / engine (snapshotMismatch). */
  importSnapshot(input: StyleSnapshot | string, label = ''): boolean {
    // the label (the page's path) keeps one page's refusal from swallowing
    // the next one's in warnOnce
    const of = label ? ` for ${label}` : '';
    let snap: StyleSnapshot;
    try {
      snap = typeof input === 'string' ? (JSON.parse(input) as StyleSnapshot) : input;
    } catch {
      warnOnce(`style snapshot${of}: unreadable JSON, skipped`);
      return false;
    }
    const why = this.snapshotMismatch(snap);
    if (why !== null) {
      warnOnce(`style snapshot${of} skipped: ${why}; styles are computed at runtime instead`);
      return false;
    }
    if (this.native !== undefined) {
      // verify mode seeds libfjs-style too, so the comparison covers seeds
      this.importSnapshotNative(snap);
      if (this.nativeOnly) return true;
    }
    const objs = snap.objs;
    const obj = <T>(i: number): T | undefined => (i < 0 ? undefined : (objs[i] as T));
    const results: MatchResult[] = [];
    const chainIdOf: number[] = [];
    for (let i = 0; i < snap.chains.length; i++) {
      const [parent, suffix, m] = snap.chains[i];
      // the scopes these cached answers were matched under count as seen:
      // a later sheet for one of them must invalidate (register fast path).
      // Suffix = tag \u0001 classes \u0001 scopes [\u0004 bits] [\u0005 prev].
      const scopes = suffix.split('\u0001')[2]?.split(/[\u0004\u0005]/)[0];
      if (scopes) for (const sc of scopes.split('\u0002')) this.seenScopes.add(sc);
      const key = `${parent < 0 ? 0 : chainIdOf[parent]}\u0003${suffix}`;
      let chainId = this.chainIds.get(key);
      if (chainId === undefined) {
        chainId = this.nextChainId++;
        this.chainIds.set(key, chainId);
      }
      chainIdOf[i] = chainId;
      let result = this.matchCache.get(key);
      if (result === undefined) {
        const [decls, custom, active, hover, before, after, placeholder, activeBefore, activeAfter] = snap.matches[m];
        result = {
          decls: obj<Record<string, unknown>>(decls) ?? {},
          custom: obj<Record<string, string>>(custom) ?? {},
          activeDecls: obj(active),
          hoverDecls: obj(hover),
          beforeDecls: obj(before),
          afterDecls: obj(after),
          placeholderDecls: obj(placeholder),
          activeBeforeDecls: obj(activeBefore),
          activeAfterDecls: obj(activeAfter),
          id: this.nextObjId++,
          byParent: new Map(),
          byInline: new Map(),
        };
        this.matchCache.set(key, result);
        // unreferenced until an element takes it: same standing as a chain
        // a closed page left behind, same bounded retention
        if (!this.chainRefs.has(key) && !this.retiredSet.has(key)) {
          this.retiredSet.add(key);
          this.retiredChains.push(key);
        }
      }
      results[i] = result;
    }
    const styleIdOf: number[] = [];
    const customOf: Array<Record<string, string> | undefined> = [];
    for (let j = 0; j < snap.computes.length; j++) {
      const [chain, parentCompute, style, active, hover, custom, pseudo, defaultsJson, rawText, inlineKey] = snap.computes[j];
      if (parentCompute >= 0 && styleIdOf[parentCompute] === undefined) continue;
      const parentStyleId = parentCompute < 0 ? 0 : styleIdOf[parentCompute];
      const matched = results[chain];
      const byInlineKey = inlineKey === '' ? '' : `${parentStyleId}\u0003${inlineKey}`;
      const existing = byInlineKey === '' ? matched.byParent.get(parentStyleId) : matched.byInline.get(byInlineKey);
      if (existing !== undefined) {
        styleIdOf[j] = existing.styleId;
        customOf[j] = existing.custom;
        continue;
      }
      const computed = obj<Record<string, unknown>>(style) ?? {};
      const activeStyle = obj<Record<string, unknown>>(active);
      const hoverStyle = obj<Record<string, unknown>>(hover);
      const customMap =
        custom === CUSTOM_INHERITED
          ? parentCompute < 0 ? this.rootCustom : customOf[parentCompute]
          : obj<Record<string, string>>(custom);
      const result: ComputeResult = {
        style: computed,
        keys: Object.keys(computed),
        activeStyle,
        activeKeys: activeStyle ? Object.keys(activeStyle) : undefined,
        hoverStyle,
        hoverKeys: hoverStyle ? Object.keys(hoverStyle) : undefined,
        custom: customMap,
        pseudo: obj<PseudoStyles>(pseudo),
        styleId: this.nextObjId++,
        customId: customMap ? this.nextObjId++ : 0,
        defaultsId: defaultsJson === '' ? 0 : this.defaultsIdForJson(defaultsJson),
        rawText: rawText === 1,
      };
      if (byInlineKey === '') {
        if (matched.byParent.size > 64) matched.byParent.clear();
        matched.byParent.set(parentStyleId, result);
      } else {
        if (matched.byInline.size > 128) matched.byInline.clear();
        matched.byInline.set(byInlineKey, result);
      }
      styleIdOf[j] = result.styleId;
      customOf[j] = customMap;
    }
    if (this.retiredChains.length - this.retiredHead > RETIRED_CHAIN_LIMIT) this.trimRetiredChains();
    return true;
  }

  /** importSnapshot under the native engine: the same MatchResult /
   * ComputeResult objects the TS import builds, handed to libfjs-style as
   * seeded chains and compute entries (NativeStyleBackend.seedChain /
   * seedCompute) — a seeded page's first open calls back for nothing. */
  private importSnapshotNative(snap: StyleSnapshot): void {
    const native = this.native!;
    const objs = snap.objs;
    const obj = <T>(i: number): T | undefined => (i < 0 ? undefined : (objs[i] as T));
    const matchOf: MatchResult[] = [];
    const chainMatch: number[] = [];
    for (let i = 0; i < snap.chains.length; i++) {
      const [parent, suffix, m] = snap.chains[i];
      let result = matchOf[m];
      if (result === undefined) {
        const [decls, custom, active, hover, before, after, placeholder, activeBefore, activeAfter] = snap.matches[m];
        result = {
          decls: obj<Record<string, unknown>>(decls) ?? {},
          custom: obj<Record<string, string>>(custom) ?? {},
          activeDecls: obj(active),
          hoverDecls: obj(hover),
          beforeDecls: obj(before),
          afterDecls: obj(after),
          placeholderDecls: obj(placeholder),
          activeBeforeDecls: obj(activeBefore),
          activeAfterDecls: obj(activeAfter),
          id: this.nextObjId++,
          byParent: new Map(),
          byInline: new Map(),
        };
        matchOf[m] = result;
      }
      chainMatch[i] = result.id;
      native.seedChain(i, parent < 0 ? 0 : parent + 1, suffix, result);
    }
    const resultIdOf: number[] = [];
    const customOf: Array<Record<string, string> | undefined> = [];
    for (let j = 0; j < snap.computes.length; j++) {
      const [chain, parentCompute, style, active, hover, custom, pseudo, defaultsJson, rawText, inlineKey] = snap.computes[j];
      if (parentCompute >= 0 && resultIdOf[parentCompute] === undefined) continue;
      const computed = obj<Record<string, unknown>>(style) ?? {};
      const activeStyle = obj<Record<string, unknown>>(active);
      const hoverStyle = obj<Record<string, unknown>>(hover);
      const customMap =
        custom === CUSTOM_INHERITED
          ? parentCompute < 0 ? this.rootCustom : customOf[parentCompute]
          : obj<Record<string, string>>(custom);
      const result: ComputeResult = {
        style: computed,
        keys: Object.keys(computed),
        activeStyle,
        activeKeys: activeStyle ? Object.keys(activeStyle) : undefined,
        hoverStyle,
        hoverKeys: hoverStyle ? Object.keys(hoverStyle) : undefined,
        custom: customMap,
        pseudo: obj<PseudoStyles>(pseudo),
        styleId: this.nextObjId++,
        customId: customMap ? this.nextObjId++ : 0,
        defaultsId: defaultsJson === '' ? 0 : this.defaultsIdForJson(defaultsJson),
        rawText: rawText === 1,
      };
      native.seedCompute(chainMatch[chain], parentCompute < 0 ? 0 : resultIdOf[parentCompute], inlineKey, result);
      resultIdOf[j] = result.styleId;
      customOf[j] = customMap;
    }
  }

  /** @internal Test/diagnostic view of cache sizes. */
  cacheStatsForTest(): { matchCache: number; chainIds: number; byParent: number } {
    let byParent = 0;
    for (const m of this.matchCache.values()) byParent += m.byParent.size;
    return {
      matchCache: this.matchCache.size,
      chainIds: this.chainIds.size,
      byParent,
    };
  }

  forget(id: number): void {
    if (this.native !== undefined) {
      this.native.forget(id);
      if (this.nativeOnly) return;
    }
    // the id may still sit in dirtyList; recompute skips ids with no state
    const s = this.states.get(id);
    if (!s) return;
    this.releaseChain(s);
    this.states.delete(id);
    this.structureNoted.delete(id);
  }

  setClasses(id: number, value: unknown): void {
    if (this.native !== undefined) {
      this.native.setClasses(id, value);
      if (this.nativeOnly) return;
    }
    const s = this.states.get(id);
    if (!s) return;
    let classes = parseClassValue(value);
    // the state token follows setDisabled, never the class value (a caller
    // may echo classesOf() back). parseClassValue hands out SHARED sets, so
    // adjust a copy, and only when the token is actually involved.
    const wantDisabled = s.classes.has(DISABLED_CLASS);
    if (classes.has(DISABLED_CLASS) !== wantDisabled) {
      classes = new Set(classes);
      if (wantDisabled) classes.add(DISABLED_CLASS);
      else classes.delete(DISABLED_CLASS);
    }
    this.replaceClasses(id, s, classes);
  }

  /** `:disabled` state of a form control (the renderer's `disabled` prop).
   * CSS only lets form controls be `:disabled`; a `disabled` attribute on a
   * div matches nothing, so other tags are ignored here too. */
  setDisabled(id: number, disabled: boolean): void {
    if (this.native !== undefined) {
      this.native.setDisabled(id, disabled);
      if (this.nativeOnly) return;
    }
    const s = this.states.get(id);
    if (!s || !DISABLEABLE_TAGS.has(s.tag) || s.classes.has(DISABLED_CLASS) === disabled) return;
    const classes = new Set(s.classes);
    if (disabled) classes.add(DISABLED_CLASS);
    else classes.delete(DISABLED_CLASS);
    this.replaceClasses(id, s, classes);
  }

  private replaceClasses(id: number, s: ElementState, classes: Set<string>): void {
    if (sameSet(classes, s.classes)) return;
    s.classes = classes;
    s.selfSig = undefined;
    if (this.queuedAlone(id, s)) return;
    this.markDirty(id, true);
    // `.a + .b` reads this element's classes: the next sibling must re-match
    this.markNextSibling(id);
  }

  /** An attribute the renderer wrote (null removes it). Kept for every
   * name — a stylesheet registered later may test it — but only a name some
   * selector tests restyles the element (and its subtree: the attribute can
   * sit on an ancestor compound, `.van-popover[data-popper-placement^=top]
   * .van-popover__arrow`) (specs/129). */
  setAttribute(id: number, name: string, value: string | null): void {
    if (this.native !== undefined) {
      this.native.setAttribute(id, name, value);
      if (this.nativeOnly) return;
    }
    const s = this.states.get(id);
    if (!s) return;
    const key = name.toLowerCase();
    const prev = s.attrs?.get(key);
    if (value == null) {
      if (prev === undefined) return;
      s.attrs!.delete(key);
    } else {
      if (prev === value) return;
      (s.attrs ??= new Map()).set(key, value);
    }
    if (!this.attrNames.has(key)) return;
    s.selfSig = undefined;
    this.markDirty(id, true);
    this.markNextSibling(id);
  }

  /** The element's current class list. The Transition shim reads it to add /
   * remove its `-enter-*` / `-leave-*` classes without losing whatever the
   * renderer last patched in (setClasses replaces the list). */
  classesOf(id: number): string[] {
    if (this.nativeOnly) return this.native!.classesOf(id);
    const s = this.states.get(id);
    return s ? [...s.classes].filter((c) => c !== DISABLED_CLASS) : [];
  }

  /** DevTools (spec 092): the registered rules that match this element right
   * now — selector source text, which selectors matched (indices into
   * `selectors`), and the rule's declarations — in cascade order (weakest
   * first, so the panel's last row is the winner). Runs the same candidate
   * walk the match cache populates, on demand for ONE element at human click
   * cadence: nothing is cached and the compute hot path is untouched.
   * `:active` / `:hover` selectors match structurally but never "apply"
   * while the state is off, so they are reported as not-matching (a rule
   * that only has state selectors is left out entirely). */
  matchedRulesOf(id: number): MatchedRuleReport[] {
    if (this.nativeOnly) return this.native!.matchedRulesOf(id);
    const s = this.states.get(id);
    if (!s) return [];
    const stamp = ++this.bucketEpoch;
    const hits: Array<{ rule: CssRule; matched: number[]; spec: number }> = [];
    const walk = (bucket: CssRule[] | undefined): void => {
      if (bucket === undefined) return;
      for (const rule of bucket) {
        if ((rule as IndexedRule).bucketStamp === stamp) continue;
        (rule as IndexedRule).bucketStamp = stamp;
        if (rule.media !== undefined && !mediaMatches(rule.media, this.viewport.width, this.viewport.height)) {
          continue;
        }
        const matched: number[] = [];
        let spec = -1;
        rule.selectors.forEach((sel, i) => {
          if (sel.pseudo || sel.active || sel.hover) return;
          if (rule.scope != null) {
            const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
            if (!has) return;
          }
          if (!this.matchSelector(sel, id)) return;
          matched.push(i);
          spec = Math.max(spec, sel.specificity);
        });
        if (matched.length !== 0) hits.push({ rule, matched, spec });
      }
    };
    for (const cls of s.classes) walk(this.plainBuckets.byClass.get(cls));
    walk(this.plainBuckets.byTag.get(s.tag));
    walk(this.plainBuckets.catchAll);
    hits.sort((a, b) => a.spec - b.spec || a.rule.order - b.rule.order);
    return hits.map(({ rule, matched }) => ({
      selectors: rule.selectors.map((sel) => sel.text ?? ''),
      matched,
      decls: rule.decls,
    }));
  }

  /** The element's computed style, or undefined before the first compute.
   * The Transition shim reads `animationDuration` / `animationDelay` off it
   * to time the class removal — there are no DOM transitionend events on
   * this side to listen for. */
  computedOf(id: number): Record<string, unknown> | undefined {
    if (this.nativeOnly) return this.native!.computedOf(id);
    return this.states.get(id)?.computed;
  }

  /** The record the inline-style entry points edit: the element's state, or
   * under the native engine a sparse per-element record (created here —
   * the engine cannot tell an unregistered id from one never styled). */
  private inlineState(id: number): Pick<ElementState, 'inline' | 'inlineCustom' | 'inlineKeyCache'> | undefined {
    return this.nativeOnly ? this.native!.inlineRecord(id, true) : this.states.get(id);
  }

  /** An inline record changed: restyle the element and its subtree. */
  private inlineChanged(id: number, s: Pick<ElementState, 'inline' | 'inlineCustom' | 'inlineKeyCache'>): void {
    if (this.native !== undefined) {
      const empty = s.inline === undefined && s.inlineCustom === undefined;
      this.native.inlineChanged(id, empty ? '' : this.inlineKeyOf(s), s);
      if (this.nativeOnly) return;
    }
    this.markDirty(id, true);
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
    const s = this.nativeOnly ? this.native!.inlineRecord(id, false) : this.states.get(id);
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

  /** Called via the renderer's setScopeId hook: Vue marks every element of
   * a component whose SFC has <style scoped> with its data-v-xxx id. */
  addScope(id: number, scope: string): void {
    if (this.native !== undefined) {
      this.native.addScope(id, scope);
      if (this.nativeOnly) return;
    }
    const s = this.states.get(id);
    if (!s || s.scopes.has(scope)) return;
    // Interned and never mutated: every element of one SFC carries the same
    // `{data-v-xxx}`, so a fresh Set per element was pure allocation
    // (specs/146). Adding a scope swaps in another shared set.
    s.scopes = internScopes(s.scopes, scope, this.seenScopes);
    s.selfSig = undefined;
    if (this.queuedAlone(id, s)) return;
    this.markDirty(id, true);
    this.markNextSibling(id);
  }

  /** True for an element whose whole subtree is already in the pending set
   * and that has no parent yet — how both Vue paths hand over a new element:
   * the scope and class land before the insert. markDirty would take its
   * stamped early return and markNextSibling finds no siblings, so the two
   * calls are skipped outright; a mount makes 2 × 4000 of them (specs/149).
   * The flush still runs: ensure scheduled it when it queued the element. */
  private queuedAlone(id: number, s: ElementState): boolean {
    return this.batch && s.subtreeEpoch === this.dirtyEpoch && this.parentOf.get(id) == null;
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

  /** Marks `id` (and optionally its subtree) for recomputation and queues a
   * single microtask flush. Mounting touches each element several times
   * (create → addScope → class → insert); coalescing turns that from
   * O(touches × subtree) recomputes into one pass per element. */
  /** Adds an element to the pending set, once. */
  private mark(id: number): void {
    const state = this.states.get(id);
    if (state === undefined || state.dirtyEpoch === this.dirtyEpoch) return;
    state.dirtyEpoch = this.dirtyEpoch;
    this.dirtyList.push(id);
  }

  markDirty(id: number, subtree: boolean): void {
    // native: structure and inputs arrive as ops, libfjs-style marks
    if (this.nativeOnly) return;
    if (subtree) {
      // A root already walked in this pending set means the whole subtree is
      // queued (see the stamp comment in the loop below) — the walk would
      // `continue` on its first node and end. Checking it here skips the
      // clock pair and the stack setup, which is most of what the call costs
      // on a mount: each element comes through here three times (addScope,
      // setClasses, insert's recomputeSubtree) and only the first one walks
      // (specs/146). Not timed: there is no walk to time.
      const root = this.states.get(id);
      if (root !== undefined && root.subtreeEpoch === this.dirtyEpoch) {
        this.scheduleFlush();
        return;
      }
      const clock = engineClock();
      const t0 = clock ? clock() : 0;
      // An explicit stack, an indexed loop, and no allocation for the common
      // cases. This walk is the whole subtree on every theme switch, and at
      // that size the shape of the loop was costing more than the cascade it
      // exists to schedule: a closure frame per node, an iterator object per
      // `for...of`, an empty array for every leaf's missing child list, and a
      // `seen` Set that grew to the size of the tree.
      //
      // `seen` is gone because this is a tree: trackInsert gives every child
      // exactly one parent. The visit cap is the backstop, so a cycle
      // introduced by a broken adapter degrades to a missed restyle instead
      // of a hang.
      const stack = this.walkStack;
      stack.length = 0;
      stack.push(id);
      let visited = 0;
      // The cap only guards against a cyclic childrenOf, which a broken
      // adapter could produce; it degrades to a missed restyle, not a hang.
      // So it has to be generous: this walk covers the whole NODE tree, not
      // just the styled elements, and those are different numbers — v-if
      // anchors are nodes the engine deliberately does not track. Sizing it
      // off `states` truncated real walks and silently left elements
      // unstyled, which is far worse than the hang it guards against.
      //
      // Marking "everything" past some threshold was tried and reverted: the
      // router parks tab pages instead of unmounting them, so a theme change
      // on the visible page would drag every parked page's elements into the
      // recompute with it.
      const cap = (this.parentOf.size + this.states.size) * 2 + 1024;
      while (stack.length > 0) {
        const nid = stack.pop()!;
        if (++visited > cap) {
          warnOnce('style: subtree walk hit its visit cap (cyclic tree?)');
          break;
        }
        // Vue mounts bottom-up: every insert of a subtree root re-walks the
        // subtree it carries, so a node N levels deep used to be visited N
        // times per mount (vant-form: ~6 ms of pure re-marking, specs/118).
        // A subtree already walked in THIS pending set is fully queued, and
        // anything attached below it since then was queued by its own
        // insert (nodeOps.insert → recomputeSubtree(child)), so it can be
        // skipped whole. The flush bumps dirtyEpoch, which retires every
        // stamp at once. Untracked nodes (v-if anchors) carry no state and
        // are simply walked through, as before.
        const state = this.states.get(nid);
        if (state !== undefined) {
          if (state.subtreeEpoch === this.dirtyEpoch) continue;
          state.subtreeEpoch = this.dirtyEpoch;
          if (state.dirtyEpoch !== this.dirtyEpoch) {
            state.dirtyEpoch = this.dirtyEpoch;
            this.dirtyList.push(nid);
          }
        }
        const kids = this.childrenOf.get(nid);
        if (kids !== undefined) {
          for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
        }
      }
      this.counters.markVisited += visited;
      if (clock) this.counters.markMs += clock() - t0;
      this.counters.markCalls++;
    } else {
      this.mark(id);
    }
    this.scheduleFlush();
  }

  /** Same semantics as before (kept for external callers), but the recompute
   * itself is now coalesced into the next microtask flush. */
  recomputeSubtree(id: number): void {
    this.markDirty(id, true);
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    Promise.resolve().then(() => this.flushPending());
  }

  /** Recomputes everything marked dirty, now. The microtask above does it
   * for ordinary batching; the host flush calls it too (renderer.ts
   * registerPreFlush), so ops never leave with the styles of elements they
   * create still pending — a forced layout read (getBoundingClientRect
   * flushes first) would otherwise lay those elements out unstyled: vant's
   * swipe measured the full 402px screen before its parents' paddings. */
  flushPending(): void {
    this.flushQueued = false;
    // native: libfjs-style flushes inside uiOps
    if (this.nativeOnly) return;
    if (!this.dirtyList.length) return;
    const clock = engineClock();
    const t0 = clock ? clock() : 0;
    // parents are always created before children (ascending ids), so one
    // ascending pass gives every element a fresh parent computed style
    let guard = 0;
    while (this.dirtyList.length && guard++ < 100) {
      const ids = this.dirtyList;
      // a fresh list (not a copy) so anything dirtied during the pass lands
      // in the next one, under the next stamp
      this.dirtyList = [];
      this.dirtyEpoch++;
      this.siblingIdx.clear();
      this.shapeMemo.clear();
      this.cursors.clear();
      ids.sort((a, b) => a - b);
      for (let i = 0; i < ids.length; i++) this.recompute(ids[i]);
    }
    if (clock) this.counters.flushMs += clock() - t0;
    this.counters.flushes++;
  }

  private recompute(id: number): void {
    const s = this.states.get(id);
    if (!s) return;
    if (this.verifyIds !== undefined) this.verifyIds.push(id);
    this.counters.recompute++;
    s.pass = this.dirtyEpoch;
    const merged = this.compute(id);
    s.computed = merged;
    const active = s.activeComputed;
    const hover = s.hoverComputed;
    // Pseudo styles ride the same notification with the hover convention:
    // undefined = unchanged, null = the element stopped matching any
    // pseudo-element rule (clear the synthesized boxes), object = current.
    // Computed BEFORE the early returns below: a class change can add or
    // drop a pseudo match while leaving the element's own style identical.
    let pseudoNote: PseudoStyles | null | undefined;
    if (s.pseudo !== s.pseudoApplied) {
      if (s.pseudo === undefined) pseudoNote = null;
      else if (s.pseudoApplied === undefined || pseudoChanged(s.pseudo, s.pseudoApplied)) {
        pseudoNote = s.pseudo;
      }
    }
    s.pseudoApplied = s.pseudo;
    // Identity first. compute() hands every element that resolved to the same
    // style the same object, so "nothing changed" is usually a pointer
    // compare — and the `?? {}` spelling below allocated two objects per
    // element for the common case of no pressed variant at all.
    if (merged === s.applied && active === s.appliedActive && hover === s.appliedHover && pseudoNote === undefined) return;
    if (
      pseudoNote === undefined &&
      s.applied !== undefined &&
      sameStyle(merged, s.computedKeys!, s.applied, s.appliedKeys!) &&
      sameOptionalStyle(active, s.activeKeys, s.appliedActive, s.appliedActiveKeys) &&
      sameOptionalStyle(hover, s.hoverKeys, s.appliedHover, s.appliedHoverKeys)
    ) {
      return;
    }
    this.counters.applied++;
    s.applied = merged;
    s.appliedKeys = s.computedKeys;
    s.appliedActive = active;
    s.appliedActiveKeys = s.activeKeys;
    s.appliedHover = hover;
    s.appliedHoverKeys = s.hoverKeys;
    // null, not undefined: an element that stops matching every :active rule
    // has to clear the one the native side is still holding
    this.applyStyle(id, merged, active ?? null, s.hadHover ? hover ?? null : undefined, pseudoNote);
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

  private compute(id: number): Record<string, unknown> {
    const s = this.states.get(id);
    if (!s) return {};
    // inheritance: the parent's CACHED computed style (recomputeSubtree
    // keeps parents fresh before children, so no recursion is needed —
    // re-walking the ancestor chain here made deep trees quadratic)
    const pid = this.parentOf.get(id);
    const parent = pid != null ? this.states.get(pid) : undefined;
    const parentComputed = parent?.computed;
    const parentCustom = parentComputed ? parent!.custom : this.rootCustom;
    const matched = this.matchRules(id, s);
    // Elements with no inline style of their own see a style that depends
    // only on (parent style, parent custom props, matched rules, tag
    // defaults) — all shared objects — so equal inputs reuse one result.
    const memoizable = s.inline === undefined && s.inlineCustom === undefined;
    const parentStyleId = parentComputed ? parent!.computedId! : 0;
    // An inline style is the one input the byParent key leaves out, so those
    // elements are memoized apart, under the inline CONTENT (specs/144). The
    // full input list of this function is: parent computed style + parent
    // custom props (one parentStyleId, minted together), the matched rule
    // set (the MatchResult itself; its chain key includes the tag, hence the
    // tag defaults), defaultsId and rawText (checked on a hit), and inline +
    // inlineCustom (the inline key). Anything new that compute() reads must
    // join one of these, or a hit hands back a stale style without a sound.
    // Content, not object identity: Vue builds a fresh object for every
    // `:style` render, and a row of vant Rate stars carries equal ones.
    const inlineKey = memoizable ? '' : `${parentStyleId}\u0003${this.inlineKeyOf(s)}`;
    {
      const hit = memoizable ? matched.byParent.get(parentStyleId) : matched.byInline.get(inlineKey);
      // defaultsId is fixed for a given match (the chain key includes the
      // tag), but a mismatch would be silent corruption, so it is checked
      if (hit && hit.defaultsId === (s.defaultsId ?? 0) && hit.rawText === (s.rawText === true)) {
        this.counters.computeHit++;
        this.takeResult(s, hit);
        return hit.style;
      }
    }
    const entry = this.computeResult(matched, parentComputed, parentCustom, s);
    {
      // Bounded: every restyle mints new parent style ids, so entries for
      // parents that no longer exist would otherwise pile up per rule set.
      // Inline styles get more room — distinct inline contents are the norm
      // there — and an animation writing a new transform every frame keeps
      // missing (as it always did) without growing the table past 128.
      if (memoizable) {
        if (matched.byParent.size > 64) matched.byParent.clear();
        matched.byParent.set(parentStyleId, entry);
      } else {
        if (matched.byInline.size > 128) matched.byInline.clear();
        matched.byInline.set(inlineKey, entry);
      }
    }
    this.takeResult(s, entry);
    return entry.style;
  }

  /** Copies a compute result onto the element (a cache hit or a fresh one). */
  private takeResult(s: ElementState, hit: ComputeResult): void {
    s.custom = hit.custom;
    s.computedId = hit.styleId;
    s.customId = hit.customId;
    s.activeComputed = hit.activeStyle;
    s.computedKeys = hit.keys;
    s.activeKeys = hit.activeKeys;
    s.hoverComputed = hit.hoverStyle;
    s.hoverKeys = hit.hoverKeys;
    s.pseudo = hit.pseudo;
    if (hit.hoverStyle) s.hadHover = true;
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

  /** The element's inline style + inline custom props as one string. Cached
   * against the two objects it was built from: every inline write replaces
   * them rather than mutating (setInlineStyle, patchInlineStyle,
   * mutateInline, setInlineCustomProps), so identity says when to rebuild
   * without each writer having to remember to clear it. */
  private inlineKeyOf(s: Pick<ElementState, 'inline' | 'inlineCustom' | 'inlineKeyCache'>): string {
    const c = s.inlineKeyCache;
    if (c !== undefined && c.inline === s.inline && c.custom === s.inlineCustom) return c.key;
    const key = `${JSON.stringify(s.inline ?? null)}\u0003${JSON.stringify(s.inlineCustom ?? null)}`;
    s.inlineKeyCache = { inline: s.inline, custom: s.inlineCustom, key };
    return key;
  }

  /** Rebuilds the matching-relevant signature of self + the ancestor chain
   * (tags/classes/scopes). Two elements with equal chainKeys see exactly
   * the same rule set, so their matchRules results are interchangeable. */
  private buildChainKey(id: number, s: ElementState): string {
    const pid = this.parentOf.get(id);
    const parent = pid != null ? this.states.get(pid) : undefined;
    const parentId = parent?.chainId ?? 0;
    let sig = s.selfSig;
    if (sig === undefined) {
      sig = `${s.tag}\u0001${joinSorted(s.classes)}\u0001${joinSorted(s.scopes)}`;
      // Sibling position joins the signature only when some rule cares.
      // Without the gate, every list row would pay the sibling scan and the
      // key would churn on every reorder for nothing.
      // matchRules — the only caller — has just recomputed structBits
      if (this.hasStructural) sig += `\u0004${s.structBits ?? this.structuralBits(id, s)}`;
      if (s.attrs && this.attrNames.size > 0) {
        const parts: string[] = [];
        for (const n of this.attrNames) {
          const v = s.attrs.get(n);
          if (v !== undefined) parts.push(`${n}=${v}`);
        }
        if (parts.length) sig += `\u0006${parts.sort().join('\u0002')}`;
      }
      s.selfSig = sig;
    }
    // The previous sibling joins per build (never cached on selfSig): a
    // class change on the neighbor must re-key this element without
    // touching its own signature
    if (this.hasSiblingRules) sig += `\u0005${this.prevSiblingSig(id)}`;
    return `${parentId}\u0003${sig}`;
  }

  /** Bit 0 = last child, bit 1 = first child, among the parent's children
   * that participate in structural position: registered (v-if comment
   * anchors are not) and not raw-text elements. A parentless element is
   * both — on web the page root is `#app`'s first (and last) child. */
  private structuralBits(id: number, s: ElementState): number {
    void s;
    const pid = this.parentOf.get(id);
    if (pid == null) return 3;
    const kids = this.childrenOf.get(pid);
    if (kids === undefined) return 3;
    const at = this.indexIn(pid, kids, id);
    if (at < 0) return 0;
    // first: nothing participating before it; last: nothing after. The same
    // rule the two full scans applied, walked outward from the element's own
    // index instead of inward from the ends.
    let bits = 2 | 1;
    for (let i = at - 1; i >= 0; i--) {
      const k = this.states.get(kids[i]);
      if (k !== undefined && !k.rawText) {
        bits &= ~2;
        break;
      }
    }
    for (let i = at + 1; i < kids.length; i++) {
      const k = this.states.get(kids[i]);
      if (k !== undefined && !k.rawText) {
        bits &= ~1;
        break;
      }
    }
    return bits;
  }

  /** An element matched earlier in this pass whose match stands in for
   * `s`'s (see the call site in matchRules), else undefined. */
  private sameShape(s: ElementState, parentChainId: number): ElementState | undefined {
    const list = this.shapeMemo.get(parentChainId);
    if (list === undefined) return undefined;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (
        // own signature: tag, and the class / scope sets by identity (shared
        // sets from parseClassValue and internScopes — equal content in two
        // different objects just misses, it cannot mis-share). attrs were
        // ruled out by the caller for both sides.
        p.tag === s.tag &&
        p.classes === s.classes &&
        p.scopes === s.scopes &&
        // position and `+` neighbour, both freshly computed for s above
        (!this.hasStructural || p.structBits === s.structBits) &&
        (!this.hasSiblingRules || p.prevSig === s.prevSig) &&
        // still holding the match it made in this pass, under this parent
        // chain, against this generation of the sheets
        p.matched !== undefined &&
        p.chainKey !== undefined &&
        p.selfSig !== undefined &&
        p.matchedEpoch === this.matchEpoch &&
        p.matchedParentChainId === parentChainId
      ) {
        return p;
      }
    }
    return undefined;
  }

  /** `id`'s index in `kids` (the child list of `pid`), -1 if absent. */
  private indexIn(pid: number, kids: number[], id: number): number {
    // a short list is cheaper to scan than to index: most parents have a
    // handful of children, and a Map per parent per flush is an allocation
    if (kids.length <= 16) return kids.indexOf(id);
    let idx = this.siblingIdx.get(pid);
    let at = idx?.get(id);
    if (at === undefined || kids[at] !== id) {
      idx = new Map();
      for (let i = 0; i < kids.length; i++) idx.set(kids[i], i);
      this.siblingIdx.set(pid, idx);
      at = idx.get(id);
    }
    return at ?? -1;
  }

  /** The previous sibling that participates in structural position
   * (registered, not raw text) — the element an `A + B` selector matches
   * against. Null when there is none. */
  private prevElementSibling(id: number): number | null {
    const pid = this.parentOf.get(id);
    if (pid == null) return null;
    const kids = this.childrenOf.get(pid);
    if (kids === undefined) return null;
    const at = this.indexIn(pid, kids, id);
    if (at < 0) return null;
    for (let i = at - 1; i >= 0; i--) {
      const k = this.states.get(kids[i]);
      if (k !== undefined && !k.rawText) return kids[i];
    }
    return null;
  }

  /** The previous sibling's matching signature ('' when there is none) —
   * what a `+` combinator compares and the chain key embeds. */
  private prevSiblingSig(id: number): string {
    const prev = this.prevElementSibling(id);
    if (prev == null) return '';
    const ps = this.states.get(prev);
    if (!ps) return '';
    return this.siblingSig(ps, this.hasStructural ? this.structuralBits(prev, ps) : 0);
  }

  /** prevSiblingSig for the element locate() just placed: the neighbour and
   * its first bit come from the walk. Its last bit is 0 when the element
   * itself takes part in position (it follows the neighbour), else it is
   * looked up. */
  private locatedPrevSig(s: ElementState): string {
    const prev = this.locPrev;
    if (prev === null) return '';
    const ps = this.states.get(prev)!;
    if (!this.hasStructural) return this.siblingSig(ps, 0);
    const bits = s.rawText ? this.structuralBits(prev, ps) : this.locPrevFirst ? 2 : 0;
    return this.siblingSig(ps, bits);
  }

  /** `ps`'s signature as the next sibling's `+` sees it, with position
   * `bits` (ignored while no structural rule exists). */
  private siblingSig(ps: ElementState, bits: number): string {
    // the tag|classes|scopes part is cached on the sibling and checked by
    // set identity; only the position bits are read live (a hoist during
    // this flush can move the sibling without re-marking it)
    let base = ps.sibBase;
    if (base === undefined || base.classes !== ps.classes || base.scopes !== ps.scopes) {
      base = {
        classes: ps.classes,
        scopes: ps.scopes,
        str: `${ps.tag}\u0001${joinSorted(ps.classes)}\u0001${joinSorted(ps.scopes)}`,
      };
      ps.sibBase = base;
    }
    if (!this.hasStructural) return base.str;
    // four possible position suffixes: keep each spelled once, so equal
    // neighbours hand out the same string instead of a fresh concatenation
    const withBits = (base.withBits ??= []);
    return (withBits[bits] ??= `${base.str}\u0004${bits}`);
  }

  /** Places `id` in its parent's child list by continuing this pass's walk
   * of that list, and leaves its first/last bits and previous participating
   * sibling in locBits / locPrev / locPrevFirst. False when it cannot (the
   * caller then looks each up on its own, as before).
   *
   * A pass recomputes in ascending id order, and a list built in one go —
   * every mount — hands its children over in list order, so the next child
   * is the next entry after the last one placed (or one past an anchor).
   * Looked up one by one, each child found its own index and scanned both
   * ways for neighbours, and the `+` signature scanned again for the
   * neighbour's own position: 2.5–3 µs per element with structural or
   * sibling rules on (specs/149). The walk costs one step.
   *
   * Everything is read off the live list, never remembered between
   * elements except the walk's position, and that is verified before use
   * (`kids[at] === id` of the last one placed), so a list changed in the
   * middle of the pass — a fixed element hoisted out by applyStyle — only
   * restarts the walk. */
  private locate(id: number, pid: number, s: ElementState): boolean {
    const kids = this.childrenOf.get(pid);
    if (kids === undefined) return false;
    const n = kids.length;
    if (n === 1) {
      // an only child: no walk to keep (a cell's text — half of a grid)
      if (kids[0] !== id) return false;
      this.locBits = 3;
      this.locPrev = null;
      this.locPrevFirst = false;
      return true;
    }
    const states = this.states;
    let c = this.cursors.get(pid);
    let i: number;
    let prev: number | null;
    let prevFirst: boolean;
    if (c !== undefined && c.kids === kids && kids[c.at] === c.id) {
      // continue the walk; a short gap is anchors or children that are not
      // dirty — anything further means the order is not the list's
      prev = c.prev;
      prevFirst = c.prevFirst;
      const end = Math.min(n, c.at + 1 + LOCATE_MAX_STEP);
      for (i = c.at + 1; i < end; i++) {
        const k = kids[i];
        if (k === id) break;
        const ks = states.get(k);
        if (ks !== undefined && !ks.rawText) {
          prevFirst = prev === null;
          prev = k;
        }
      }
      if (i === end) return false;
    } else {
      // start a walk here: where the element sits, and its participating
      // neighbour before it (and whether that one is the first)
      i = this.indexIn(pid, kids, id);
      if (i < 0) return false;
      prev = null;
      prevFirst = false;
      for (let j = i - 1; j >= 0; j--) {
        const ks = states.get(kids[j]);
        if (ks !== undefined && !ks.rawText) {
          if (prev === null) {
            prev = kids[j];
            prevFirst = true;
          } else {
            prevFirst = false;
            break;
          }
        }
      }
      if (c === undefined) {
        c = { kids, at: i, id, prev: null, prevFirst: false };
        this.cursors.set(pid, c);
      }
      c.kids = kids;
    }
    let bits = prev === null ? 3 : 1;
    for (let j = i + 1; j < n; j++) {
      const ks = states.get(kids[j]);
      if (ks !== undefined && !ks.rawText) {
        bits &= ~1;
        break;
      }
    }
    this.locBits = bits;
    this.locPrev = prev;
    this.locPrevFirst = prevFirst;
    c.at = i;
    c.id = id;
    if (s.rawText) {
      c.prev = prev;
      c.prevFirst = prevFirst;
    } else {
      c.prevFirst = prev === null;
      c.prev = id;
    }
    return true;
  }

  /** Wakes the next participating sibling: `.a + .b` makes this element's
   * classes matching-relevant for the neighbor that follows. */
  private markNextSibling(id: number): void {
    if (!this.hasSiblingRules) return;
    const pid = this.parentOf.get(id);
    if (pid == null) return;
    const kids = this.childrenOf.get(pid);
    if (kids === undefined) return;
    let past = false;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i] === id) {
        past = true;
        continue;
      }
      if (!past) continue;
      const k = this.states.get(kids[i]);
      if (k !== undefined && !k.rawText) {
        this.mark(kids[i]);
        return;
      }
    }
    this.scheduleFlush();
  }

  private matchRules(id: number, s: ElementState): MatchResult {
    // The match depends on this element's own signature and its ancestors',
    // and nothing else. A theme change touches neither, so on a restyle the
    // answer is already on the element — reusing it skips building the chain
    // key string and two map lookups for every element on the page.
    const pid = this.parentOf.get(id);
    const parentChainId = (pid != null ? this.states.get(pid)?.chainId : 0) ?? 0;
    // Position and `+` neighbour from the pass's walk of the parent's child
    // list when it can give them (locate), else each looked up on its own.
    const located = this.batch && pid != null && (this.hasStructural || this.hasSiblingRules) && this.locate(id, pid, s);
    if (this.hasStructural) {
      // Sibling position is not in the parent chain: a neighbor's
      // insert/remove leaves the parent chainId alone. The dirty element
      // itself recomputes bits here; if they moved, its cached match is
      // stale AND every descendant's chain key embeds this element's chain
      // id, so the whole subtree has to re-key. `noteStructureChange` marks
      // the siblings; this is where each one finds out whether it moved.
      const bits = located ? this.locBits : this.structuralBits(id, s);
      if (s.structBits !== bits) {
        const firstBuild = s.selfSig === undefined;
        s.structBits = bits;
        s.selfSig = undefined;
        if (s.chainKey !== undefined) this.releaseChain(s);
        if (!firstBuild) this.markDirty(id, true);
      }
    }
    if (this.hasSiblingRules) {
      // Same story for `A + B`: the previous sibling's identity is not in
      // the parent chain, so whoever got marked rechecks it here. A change
      // re-keys this element (buildChainKey embeds the signature); unlike
      // the structural case descendants are unaffected — no subtree work.
      const sig = located ? this.locatedPrevSig(s) : this.prevSiblingSig(id);
      if (s.prevSig !== sig) {
        const firstBuild = s.selfSig === undefined && s.prevSig === undefined;
        s.prevSig = sig;
        if (s.chainKey !== undefined) this.releaseChain(s);
        if (!firstBuild) this.markDirty(id, false);
      }
    }
    if (
      s.matched !== undefined &&
      s.selfSig !== undefined &&
      s.matchedEpoch === this.matchEpoch &&
      s.matchedParentChainId === parentChainId
    ) {
      this.counters.matchHit++;
      return s.matched;
    }

    // Same shape, same pass: an element matched earlier in THIS flush pass
    // under the same parent chain, with the same inputs this element would
    // feed buildChainKey, has this element's chain key, id and match. Rows
    // of a list are the case — siblings, and their children as cousins (the
    // parents shared one chain id). Compared by identity, so no key string
    // and no map lookup on a string (specs/147). Each condition in
    // sameShape is one input of buildChainKey / the rule match; a new match
    // input must join it, or an exemplar silently hands over a stale match.
    const shareable = this.attrNames.size === 0 || s.attrs === undefined;
    // Also for an element that still holds an old key (a re-key after an
    // ancestor's class flip): retainChain swaps it for the shared one.
    if (shareable) {
      const shared = this.sameShape(s, parentChainId);
      if (shared !== undefined) {
        this.counters.matchHit++;
        s.selfSig = shared.selfSig;
        this.retainChain(s, shared.chainKey!, shared.chainId!);
        s.matched = shared.matched;
        s.matchedParentChainId = parentChainId;
        s.matchedEpoch = this.matchEpoch;
        return shared.matched!;
      }
    }

    // rows in a list share one chainKey, so the whole rule scan runs once
    // per distinct tree signature instead of once per element
    const key = this.buildChainKey(id, s);
    let chainId = this.chainIds.get(key);
    if (chainId === undefined) {
      chainId = this.nextChainId++;
      this.chainIds.set(key, chainId);
    }
    this.retainChain(s, key, chainId);
    const remember = (result: MatchResult): MatchResult => {
      s.matched = result;
      s.matchedParentChainId = parentChainId;
      s.matchedEpoch = this.matchEpoch;
      if (shareable) {
        const list = this.shapeMemo.get(parentChainId);
        if (list === undefined) this.shapeMemo.set(parentChainId, [s]);
        else if (list.length < 8) list.push(s);
      }
      return result;
    };
    const cached = this.matchCache.get(key);
    if (cached) {
      this.counters.matchHit++;
      return remember(cached);
    }
    this.counters.matchMiss++;
    // Three cascades: the plain one, and one per runtime state. Each state
    // cascade carries the rules that apply in that state, weighted by their
    // best selector UNDER that state's rules:
    //   pressed (:active)  = plain rules + :active rules. NOT hover rules —
    //     on web a touch press never matches :hover, so folding hover styles
    //     here would restyle touch press on the App differently; the widget
    //     layer adds the hover variant itself when the pointer is really over
    //     the node (FjsStyle.stateOf).
    //   hovered (:hover)   = plain rules + :hover rules. NOT :active rules —
    //     hovering is not pressing on either end.
    // Custom properties stay out of both: they inherit, and a state only
    // restyles the node itself.
    const plain = this.matchPlain;
    const active = this.matchActive;
    const hover = this.matchHover;
    plain.length = 0;
    active.length = 0;
    hover.length = 0;
    this.matchAnyActive = false;
    this.matchAnyHover = false;
    // Candidate walk instead of the full rule scan: a rule can only match
    // through one of its selectors' subjects, and every subject demands one
    // of its classes or its tag of THIS element — so the element's class
    // buckets, its tag bucket and the catch-all together are a superset of
    // everything that could match. A rule indexed under several of the
    // element's keys is reached once per key; the stamp dedupes that (a
    // duplicate visit would also be harmless — same rule, same spec,
    // idempotent fold — the stamp just skips the repeat work).
    const stamp = ++this.bucketEpoch;
    for (const cls of s.classes) {
      this.scanPlainBucket(this.plainBuckets.byClass.get(cls), stamp, id, s, plain, active, hover);
    }
    this.scanPlainBucket(this.plainBuckets.byTag.get(s.tag), stamp, id, s, plain, active, hover);
    this.scanPlainBucket(this.plainBuckets.catchAll, stamp, id, s, plain, active, hover);
    let pseudoLists: PseudoHits | undefined;
    if (this.hasPseudo) {
      pseudoLists = { before: [], after: [], placeholder: [], activeBefore: [], activeAfter: [] };
      for (const cls of s.classes) {
        this.scanPseudoBucket(this.pseudoBuckets.byClass.get(cls), stamp, id, s, pseudoLists);
      }
      this.scanPseudoBucket(this.pseudoBuckets.byTag.get(s.tag), stamp, id, s, pseudoLists);
      this.scanPseudoBucket(this.pseudoBuckets.catchAll, stamp, id, s, pseudoLists);
    }
    const result = this.buildMatch(plain, active, hover, this.matchAnyActive, this.matchAnyHover, pseudoLists);
    this.matchCache.set(key, result);
    return remember(result);
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
    // build-time capture only: which sheets this answer depends on
    const sheetSet = this.trackSheets ? new Set<string>() : undefined;
    if (sheetSet) {
      for (const m of plain) sheetSet.add(m.rule.sheet ?? '');
      for (const m of active) sheetSet.add(m.rule.sheet ?? '');
      for (const m of hover) sheetSet.add(m.rule.sheet ?? '');
    }
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
      if (sheetSet) {
        for (const m of before) sheetSet.add(m.rule.sheet ?? '');
        for (const m of after) sheetSet.add(m.rule.sheet ?? '');
        for (const m of placeholder) sheetSet.add(m.rule.sheet ?? '');
        for (const m of activeBefore) sheetSet.add(m.rule.sheet ?? '');
        for (const m of activeAfter) sheetSet.add(m.rule.sheet ?? '');
      }
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
      sheets: sheetSet ? [...sheetSet] : undefined,
    };
  }

  /** One candidate bucket of the plain scan — the body is the per-rule work
   * the full scan used to do, unchanged (media filter, scope check, selector
   * match, the three-cascade split). Kept as a method so the walk over an
   * element's class buckets + tag bucket + catch-all stays one loop per
   * bucket with no per-element allocation beyond the matches themselves. */
  private scanPlainBucket(
    bucket: CssRule[] | undefined,
    stamp: number,
    id: number,
    s: ElementState,
    plain: Array<{ rule: CssRule; spec: number }>,
    active: Array<{ rule: CssRule; spec: number }>,
    hover: Array<{ rule: CssRule; spec: number }>,
  ): void {
    if (bucket === undefined) return;
    for (const rule of bucket) {
      if ((rule as IndexedRule).bucketStamp === stamp) continue;
      (rule as IndexedRule).bucketStamp = stamp;
      if (rule.media !== undefined && !mediaMatches(rule.media, this.viewport.width, this.viewport.height)) {
        continue;
      }
      // scoped rules apply to elements carrying the scope; :deep selectors
      // apply to anything inside a subtree that carries it
      let bestPlain = -1; // selectors with neither state flag
      let bestActive = -1; // best selector that is not hover-only
      let bestHover = -1; // best selector that is not active-only
      for (const sel of rule.selectors) {
        if (rule.scope != null) {
          const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
          if (!has) continue;
        }
        if (!this.matchSelector(sel, id)) continue;
        const spec = sel.specificity;
        if (!sel.active && !sel.hover) bestPlain = Math.max(bestPlain, spec);
        if (!sel.hover) bestActive = Math.max(bestActive, spec);
        if (!sel.active) bestHover = Math.max(bestHover, spec);
      }
      const best = Math.max(bestPlain, bestActive, bestHover);
      if (best < 0) continue;
      // scoped rules win ties over global ones (like the extra [data-v]
      // attribute selector in real browsers)
      const bump = rule.scope != null ? 10 : 0;
      if (bestPlain >= 0) plain.push({ rule, spec: bestPlain + bump });
      if (bestActive >= 0) active.push({ rule, spec: bestActive + bump });
      if (bestHover >= 0) hover.push({ rule, spec: bestHover + bump });
      if (bestActive > bestPlain) this.matchAnyActive = true;
      if (bestHover > bestPlain) this.matchAnyHover = true;
    }
  }

  /** Same walk for the pseudo-element rule set (::before / ::after /
   * ::placeholder): per-rule body is the old pseudo scan verbatim,
   * cascaded per pseudo kind by the caller. */
  private scanPseudoBucket(
    bucket: CssRule[] | undefined,
    stamp: number,
    id: number,
    s: ElementState,
    lists: PseudoHits,
  ): void {
    if (bucket === undefined) return;
    for (const rule of bucket) {
      if ((rule as IndexedRule).bucketStamp === stamp) continue;
      (rule as IndexedRule).bucketStamp = stamp;
      if (rule.media !== undefined && !mediaMatches(rule.media, this.viewport.width, this.viewport.height)) {
        continue;
      }
      let bestPlain = -1; // selectors without :active
      let bestActive = -1; // any selector — the pressed cascade takes both
      for (const sel of rule.selectors) {
        if (rule.scope != null) {
          const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
          if (!has) continue;
        }
        if (!this.matchSelector(sel, id)) continue;
        if (!sel.active) bestPlain = Math.max(bestPlain, sel.specificity);
        bestActive = Math.max(bestActive, sel.specificity);
      }
      if (bestActive < 0) continue;
      const bump = rule.scope != null ? 10 : 0;
      if (rule.pseudo === 'placeholder') {
        if (bestPlain >= 0) lists.placeholder.push({ rule, spec: bestPlain + bump });
        continue;
      }
      const isBefore = rule.pseudo === 'before';
      if (bestPlain >= 0) (isBefore ? lists.before : lists.after).push({ rule, spec: bestPlain + bump });
      (isBefore ? lists.activeBefore : lists.activeAfter).push({
        rule,
        spec: bestActive + bump,
        state: bestActive > bestPlain,
      });
    }
  }

  private retainChain(s: ElementState, key: string, chainId: number): void {
    if (s.chainKey === key) return;
    if (s.chainKey !== undefined) this.releaseChain(s);
    s.chainKey = key;
    s.chainId = chainId;
    this.chainRefs.set(key, (this.chainRefs.get(key) ?? 0) + 1);
  }

  private releaseChain(s: ElementState): void {
    const key = s.chainKey;
    if (key === undefined) return;
    const refs = (this.chainRefs.get(key) ?? 1) - 1;
    if (refs <= 0) {
      // Retire, don't delete (specs/076): the id and the cached match stay
      // findable so navigating back to a page hits them instead of
      // re-matching every signature. The bounded trim below is what
      // actually frees them.
      this.chainRefs.delete(key);
      if (!this.retiredSet.has(key)) {
        this.retiredSet.add(key);
        this.retiredChains.push(key);
      }
      if (this.retiredChains.length - this.retiredHead > RETIRED_CHAIN_LIMIT) {
        this.trimRetiredChains();
      }
    } else {
      this.chainRefs.set(key, refs);
    }
    s.chainKey = undefined;
    s.chainId = undefined;
    s.matched = undefined;
    s.matchedParentChainId = undefined;
    s.matchedEpoch = undefined;
  }

  /** Evicts oldest retired chains past the cap. A key that was
   * re-referenced since retiring (chainRefs has it again) is skipped and
   * simply dropped from the queue — its id and cache stay live; it re-joins
   * the queue if it dies again. */
  private trimRetiredChains(): void {
    while (this.retiredChains.length - this.retiredHead > RETIRED_CHAIN_LIMIT) {
      const key = this.retiredChains[this.retiredHead++];
      this.retiredSet.delete(key);
      if (this.chainRefs.get(key) === undefined) {
        this.chainIds.delete(key);
        this.matchCache.delete(key);
      }
    }
    if (this.retiredHead > 256 && this.retiredHead * 2 > this.retiredChains.length) {
      this.retiredChains.splice(0, this.retiredHead);
      this.retiredHead = 0;
    }
  }

  private matchSelector(sel: Selector, id: number): boolean {
    return this.matchCompoundFrom(sel, sel.compounds.length - 1, id);
  }

  private matchCompoundFrom(sel: Selector, idx: number, id: number): boolean {
    const s = this.states.get(id);
    if (!s) return false;
    const c = sel.compounds[idx];
    if (c.tag != null && s.tag !== c.tag) return false;
    for (const cls of c.classes) {
      if (!s.classes.has(cls)) return false;
    }
    if (c.classAttr && !c.classAttr.every((t) => matchClassAttr(t, s.classes))) return false;
    if (c.attrs && !c.attrs.every((t) => matchAttr(t, s))) return false;
    if (c.first || c.last || c.notFirst || c.notLast) {
      const bits = this.structuralBits(id, s);
      if (c.first && !(bits & 2)) return false;
      if (c.last && !(bits & 1)) return false;
      if (c.notFirst && bits & 2) return false;
      if (c.notLast && bits & 1) return false;
    }
    if (idx === 0) return true;
    const comb = sel.combinators[idx - 1];
    const pid = this.parentOf.get(id);
    if (pid == null) return false;
    if (comb === 'child') return this.matchCompoundFrom(sel, idx - 1, pid);
    if (comb === 'nextSibling') {
      // one candidate, no backtracking: `a + b + c` chains through the
      // same walk one compound at a time
      const prev = this.prevElementSibling(id);
      return prev != null && this.matchCompoundFrom(sel, idx - 1, prev);
    }
    // descendant: try every ancestor (backtracking across mixed combinators)
    let cur: number | null | undefined = pid;
    while (cur != null) {
      if (this.matchCompoundFrom(sel, idx - 1, cur)) return true;
      cur = this.parentOf.get(cur);
    }
    return false;
  }

  private hasScopeUp(id: number, scope: string): boolean {
    let cur: number | null | undefined = id;
    while (cur != null) {
      if (this.states.get(cur)?.scopes.has(scope)) return true;
      cur = this.parentOf.get(cur);
    }
    return false;
  }
}

/** Sorted join without the spread+sort allocations for the common
 * empty/single-entry sets (most elements carry 0-1 classes and scopes). */
function joinSorted(set: Set<string>): string {
  if (set.size === 0) return '';
  if (set.size === 1) {
    for (const v of set) return v;
  }
  const out: string[] = [];
  for (const v of set) out.push(v);
  out.sort();
  return out.join('\u0002');
}

/** The class set of an element that has none yet. Shared and never
 * mutated: class lists are replaced wholesale, scopes copy on first write
 * (addScope). */
/** Shared, read-only scope sets keyed by their sorted members. Unbounded,
 * but the key space is the set of scope-id combinations the app's
 * components actually produce — one per SFC plus a few slot/`:deep` mixes. */
const scopeSetCache = new Map<string, Set<string>>();

/** `current ∪ {scope}` as an interned set. `seen` is the calling engine's
 * seenScopes: recorded on every call, not only when a set is built — the
 * cache is module-wide and outlives engine instances (tests make many). */
function internScopes(current: Set<string>, scope: string, seen: Set<string>): Set<string> {
  seen.add(scope);
  const key = current.size === 0 ? scope : [...current, scope].sort().join(' ');
  let set = scopeSetCache.get(key);
  if (set === undefined) {
    set = new Set(current);
    set.add(scope);
    scopeSetCache.set(key, set);
  }
  return set;
}

/** The host clock behind the engine's own timers (`markMs` / `flushMs`).
 * Resolved once it exists instead of walking `globalThis.__fjs.fns` on every
 * call: markDirty runs several times per element on a mount (specs/146).
 * Not cached while absent — tests and the web build install it later or
 * never, and a cached `undefined` would switch the timers off for good. */
let cachedClock: (() => number) | undefined;
function engineClock(): (() => number) | undefined {
  if (cachedClock !== undefined) return cachedClock;
  const c = (globalThis as { __fjs?: { fns?: { nowMs?: () => number } } }).__fjs?.fns?.nowMs;
  if (c !== undefined) cachedClock = c;
  return c;
}

const EMPTY_CLASSES: Set<string> = new Set();

/** Parsed class strings. Element class sets are never mutated in place
 * (replaceClasses swaps the whole set; setClasses/setDisabled copy before
 * editing), so one set per distinct string can be shared by every element
 * that carries it — vant repeats the same few dozen class strings across a
 * page, and the regex split plus a fresh Set per patch was measurable under
 * the interpreter (specs/118). Cleared wholesale past the cap: the key space
 * is bounded by the source, the cap only guards against generated names. */
const classSetCache = new Map<string, Set<string>>();
const CLASS_SET_CACHE_MAX = 4096;

function parseClassValue(value: unknown): Set<string> {
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

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ---- var() resolution --------------------------------------------------------

/** Normalizes a custom property name by resolving CSS escape sequences
 * (`theme\.color` -> `theme.color`) so escaped stylesheet references and
 * raw generated keys land on the same entry. */
function normalizeVarKey(name: string): string {
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
function resolveVars(style: Record<string, unknown>, custom?: Record<string, string>): Record<string, unknown> {
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
function sameStyle(
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

function sameMap(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  const ak = a ? Object.keys(a) : [];
  const bk = b ? Object.keys(b) : [];
  if (ak.length !== bk.length) return false;
  return sameStyle(a ?? {}, ak, b ?? {}, bk);
}

/** [sameStyle] where either side may be absent — the `:active` variant, which
 * most elements do not have. */
function sameOptionalStyle(
  a: Record<string, unknown> | undefined,
  aKeys: string[] | undefined,
  b: Record<string, unknown> | undefined,
  bKeys: string[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return sameStyle(a, aKeys ?? [], b, bKeys ?? []);
}
