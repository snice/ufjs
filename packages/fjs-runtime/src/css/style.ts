// Style engine: stores rules parsed from <style> blocks, matches them
// against elements, and computes each element's final style object
// (cascade by specificity + source order, then CSS inheritance along the
// element tree). The Vue renderer feeds element state (tag/class/scopes/
// inline style) and applies computed styles back through setProps, so the
// native bridge keeps receiving exactly one merged `style` map per element.
import { DISABLED_CLASS, camelize, normalizeValue, parseInlineCss, parseStylesheet, warnOnce, type ClassAttrTest, type CssRule, type Selector, mediaMatches } from './parser';
import { registerFontFace, type FontFaceDecl } from './font-face';
import type { KeyframesDecl } from './animation';

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
    kind(next.placeholder, prev?.placeholder)
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

function foldAbsoluteCalcOnce(value: string): string {
  return value.replace(/calc\(([^()]*)\)/g, (whole: string, expr: string) => {
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
      const sign = op === '' || op === '+' ? 1 : op === '-' ? -1 : NaN;
      if (Number.isNaN(sign)) return whole;
      const n = parseFloat(m[2]) * sign;
      if (m[3] === '%') percent += n;
      else px += n;
    }
    if (consumed !== expr.trim().length) return whole;
    if (percent !== 0) {
      // a percent term stays in the expression for the peer's resolver, but
      // the px terms can still collapse into one
      return `calc(${percent * 100}% ${px < 0 ? '-' : '+'} ${Math.abs(px)}px)`;
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
  selfSig?: string; // cached `tag|classes|scopes` part of the chain key
  structBits?: number; // last seen first/last bits (selfSig embeds them)
  /** Last seen signature of the previous participating sibling — only
   * tracked while some `A + B` rule exists, and part of the chain key. */
  prevSig?: string;
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
}

interface MatchResult {
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
   * declarations style that pseudo, never the element itself. State variants
   * (`:active::before`) stay out — the plain variant is the supported
   * subset, registered in css-compat.md. */
  beforeDecls?: Record<string, unknown>;
  afterDecls?: Record<string, unknown>;
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
}

interface ComputeResult {
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
export const STYLE_SNAPSHOT_VERSION = 1;

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
  /** [decls, custom, active, hover, before, after, placeholder]. */
  matches: Array<[number, number, number, number, number, number, number]>;
  /** [chain, parent compute, style, active, hover, custom, pseudo,
   *  defaults JSON ('' = none), rawText 0/1]. */
  computes: Array<[number, number, number, number, number, number, number, string, number]>;
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
    return {
      ...this.counters,
      elements: this.states.size,
      rules: this.rules.length,
    };
  }

  resetStats(): void {
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
    ) => void,
  ) {}

  /** Registers a <style> block. scope=null means global (non-scoped). */
  register(scope: string | null, cssText: string, hash = ''): void {
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
    if (all.length === 0) return;
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
      !touchesRoot &&
      keyframes.length === 0 &&
      this.shapeFlags() === flagsBefore
    ) {
      return;
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
    if (this.states.has(id)) return;
    let defaultsId = 0;
    if (defaults) {
      defaultsId = this.defaultsIds.get(defaults) ?? 0;
      if (defaultsId === 0) {
        defaultsId = this.defaultsIdForJson(JSON.stringify(defaults));
        this.defaultsIds.set(defaults, defaultsId);
      }
    }
    this.states.set(id, {
      tag,
      // shared until first written: most elements get a class list (which
      // replaces this set wholesale) and many never get a scope — two fresh
      // Sets per created element were pure allocation (specs/118)
      classes: EMPTY_CLASSES,
      scopes: EMPTY_CLASSES,
      defaults,
      defaultsId,
      rawText,
    });
    this.mark(id);
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
    if (!this.hasStructural && !this.hasSiblingRules) return;
    const kids = this.childrenOf.get(parentId);
    if (kids === undefined) return;
    for (let i = 0; i < kids.length; i++) this.mark(kids[i]);
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
          ]);
          for (const h of matched.sheets ?? []) sheets.add(h);
        }
        chain = chains.length;
        chainIndex.set(key, chain);
        chains.push([parentChain, key.slice(key.indexOf('\u0003') + 1), match]);
      }
      let compute = -1;
      const memoizable = s.inline === undefined && s.inlineCustom === undefined;
      const parentStateless = parentChain < 0;
      if (memoizable && s.computed !== undefined && s.computedId !== undefined && (parentStateless || parentCompute >= 0)) {
        const rawText = s.rawText === true ? 1 : 0;
        const ckey = `${chain}:${parentCompute}`;
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
            custom, ref(s.pseudo), s.defaults ? JSON.stringify(s.defaults) : '', rawText,
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
  importSnapshot(input: StyleSnapshot | string): boolean {
    let snap: StyleSnapshot;
    try {
      snap = typeof input === 'string' ? (JSON.parse(input) as StyleSnapshot) : input;
    } catch {
      warnOnce('style snapshot: unreadable JSON, skipped');
      return false;
    }
    const why = this.snapshotMismatch(snap);
    if (why !== null) {
      warnOnce(`style snapshot skipped: ${why}; styles are computed at runtime instead`);
      return false;
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
        const [decls, custom, active, hover, before, after, placeholder] = snap.matches[m];
        result = {
          decls: obj<Record<string, unknown>>(decls) ?? {},
          custom: obj<Record<string, string>>(custom) ?? {},
          activeDecls: obj(active),
          hoverDecls: obj(hover),
          beforeDecls: obj(before),
          afterDecls: obj(after),
          placeholderDecls: obj(placeholder),
          id: this.nextObjId++,
          byParent: new Map(),
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
      const [chain, parentCompute, style, active, hover, custom, pseudo, defaultsJson, rawText] = snap.computes[j];
      if (parentCompute >= 0 && styleIdOf[parentCompute] === undefined) continue;
      const parentStyleId = parentCompute < 0 ? 0 : styleIdOf[parentCompute];
      const matched = results[chain];
      const existing = matched.byParent.get(parentStyleId);
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
      if (matched.byParent.size > 64) matched.byParent.clear();
      matched.byParent.set(parentStyleId, result);
      styleIdOf[j] = result.styleId;
      customOf[j] = customMap;
    }
    if (this.retiredChains.length - this.retiredHead > RETIRED_CHAIN_LIMIT) this.trimRetiredChains();
    return true;
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
    // the id may still sit in dirtyList; recompute skips ids with no state
    const s = this.states.get(id);
    if (!s) return;
    this.releaseChain(s);
    this.states.delete(id);
  }

  setClasses(id: number, value: unknown): void {
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
    this.markDirty(id, true);
    // `.a + .b` reads this element's classes: the next sibling must re-match
    this.markNextSibling(id);
  }

  /** The element's current class list. The Transition shim reads it to add /
   * remove its `-enter-*` / `-leave-*` classes without losing whatever the
   * renderer last patched in (setClasses replaces the list). */
  classesOf(id: number): string[] {
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
    return this.states.get(id)?.computed;
  }

  setInlineStyle(id: number, value: unknown): void {
    const s = this.states.get(id);
    if (!s) return;
    const { style, custom } = normalizeInline(value);
    if (sameMap(style, s.inline) && sameMap(custom, s.inlineCustom)) return;
    s.inline = style;
    s.inlineCustom = custom;
    this.markDirty(id, true);
  }

  /** The DOM's patchStyle semantics for a `:style` re-patch: an object
   * binding DIFFS against its previous value (set the next keys, drop the
   * keys that disappeared), so a key the binding did not change keeps
   * whatever wrote it in between — on a real DOM that is what makes
   * `el.style` writes from a library like @vueuse/motion survive a parent
   * re-render, and the shim needs the same here. A css string or a clear
   * replaces wholesale, like cssText. */
  patchInlineStyle(id: number, prev: unknown, next: unknown): void {
    const s = this.states.get(id);
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
        this.markDirty(id, true);
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
    this.markDirty(id, true);
  }

  /** The element's current inline layer, for the DOM-shaped `el.style` shim
   * to read back (ui/element.ts). Inline properties plus the `--`-prefixed
   * custom ones; this is the WRITE record, not the resolved cascade — the
   * DOM's getComputedStyle semantics are out of scope for the shim. */
  inlineRecord(id: number): Record<string, unknown> | undefined {
    const s = this.states.get(id);
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
    const s = this.states.get(id);
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
    this.markDirty(id, true);
  }

  /** Called via the renderer's setScopeId hook: Vue marks every element of
   * a component whose SFC has <style scoped> with its data-v-xxx id. */
  addScope(id: number, scope: string): void {
    const s = this.states.get(id);
    if (!s || s.scopes.has(scope)) return;
    this.seenScopes.add(scope);
    // copy-on-write: ensure() starts every element on the shared empty set
    if (s.scopes === EMPTY_CLASSES) s.scopes = new Set();
    s.scopes.add(scope);
    s.selfSig = undefined;
    this.markDirty(id, true);
    this.markNextSibling(id);
  }

  /** Merges a useCssVars() batch into the element's inline custom props
   * (keys without the leading `--` are normalized; null/'' removes). */
  setInlineCustomProps(id: number, vars: Record<string, unknown>): void {
    const s = this.states.get(id);
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
    this.markDirty(id, true);
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
    if (subtree) {
      const clock = (globalThis as { __fjs?: { fns?: { nowMs?: () => number } } })
        .__fjs?.fns?.nowMs;
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
    if (!this.dirtyList.length) return;
    const clock = (globalThis as { __fjs?: { fns?: { nowMs?: () => number } } })
      .__fjs?.fns?.nowMs;
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
      ids.sort((a, b) => a - b);
      for (let i = 0; i < ids.length; i++) this.recompute(ids[i]);
    }
    if (clock) this.counters.flushMs += clock() - t0;
    this.counters.flushes++;
  }

  private recompute(id: number): void {
    const s = this.states.get(id);
    if (!s) return;
    this.counters.recompute++;
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
    if (memoizable) {
      const hit = matched.byParent.get(parentStyleId);
      // defaultsId is fixed for a given match (the chain key includes the
      // tag), but a mismatch would be silent corruption, so it is checked
      if (hit && hit.defaultsId === (s.defaultsId ?? 0) && hit.rawText === (s.rawText === true)) {
        this.counters.computeHit++;
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
        return hit.style;
      }
    }
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
    s.custom = custom;
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
    }
    resolveInheritKeyword(merged, parentComputed);
    const parentFontPx = fontSizePx(parentComputed?.fontSize, INITIAL_FONT_PX);
    const style = resolveVars(merged, custom);
    resolveEm(style, parentFontPx);
    this.attachKeyframes(style, custom);
    // the pressed variant is the same pipeline over the pressed cascade, so
    // inline styles and inherited values keep winning where they should.
    // :hover computes the same way; both state variants keep custom
    // properties out (they inherit, and a state only restyles the node).
    s.activeComputed = matched.activeDecls
      ? resolveVars(overlayCascade(matched.activeDecls), custom)
      : undefined;
    if (s.activeComputed) resolveEm(s.activeComputed, parentFontPx);
    s.hoverComputed = matched.hoverDecls
      ? resolveVars(overlayCascade(matched.hoverDecls), custom)
      : undefined;
    if (s.hoverComputed) resolveEm(s.hoverComputed, parentFontPx);
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
        // currentColor on a decoration box means the inherited text color
        // (vant paints the stepper +/- lines with it); the peer has no
        // currentColor, so substitute the resolved value here
        const color = merged0.color;
        if (typeof color === 'string') {
          for (const k in merged0) {
            const v = merged0[k];
            if (typeof v === 'string' && v.includes('currentColor')) {
              merged0[k] = v.replace(/currentcolor/gi, color);
            }
          }
        }
        return merged0;
      };
      pseudo = {};
      if (matched.beforeDecls !== undefined) pseudo.before = build(matched.beforeDecls);
      if (matched.afterDecls !== undefined) pseudo.after = build(matched.afterDecls);
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
    s.pseudo = pseudo;
    if (s.hoverComputed) s.hadHover = true;
    s.computedId = this.nextObjId++;
    s.customId = custom ? this.nextObjId++ : 0;
    s.computedKeys = Object.keys(style);
    s.activeKeys = s.activeComputed ? Object.keys(s.activeComputed) : undefined;
    s.hoverKeys = s.hoverComputed ? Object.keys(s.hoverComputed) : undefined;
    if (memoizable) {
      // Bounded: every restyle mints new parent style ids, so entries for
      // parents that no longer exist would otherwise pile up per rule set.
      if (matched.byParent.size > 64) matched.byParent.clear();
      matched.byParent.set(parentStyleId, {
        style,
        keys: s.computedKeys,
        activeStyle: s.activeComputed,
        activeKeys: s.activeKeys,
        hoverStyle: s.hoverComputed,
        hoverKeys: s.hoverKeys,
        custom,
        pseudo: s.pseudo,
        styleId: s.computedId,
        rawText: s.rawText === true,
        customId: s.customId,
        defaultsId: s.defaultsId ?? 0,
      });
    }
    return style;
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
      if (this.hasStructural) sig += `\u0004${this.structuralBits(id, s)}`;
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
    const pid = this.parentOf.get(id);
    if (pid == null) return 3;
    const kids = this.childrenOf.get(pid);
    if (kids === undefined) return 3;
    let bits = 0;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i] === id) {
        bits |= 2;
        break;
      }
      const k = this.states.get(kids[i]);
      if (k !== undefined && !k.rawText) break;
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i] === id) {
        bits |= 1;
        break;
      }
      const k = this.states.get(kids[i]);
      if (k !== undefined && !k.rawText) break;
    }
    return bits;
  }

  /** The previous sibling that participates in structural position
   * (registered, not raw text) — the element an `A + B` selector matches
   * against. Null when there is none. */
  private prevElementSibling(id: number): number | null {
    const pid = this.parentOf.get(id);
    if (pid == null) return null;
    const kids = this.childrenOf.get(pid);
    if (kids === undefined) return null;
    let at = -1;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i] === id) {
        at = i;
        break;
      }
    }
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
    let sig = `${ps.tag}\u0001${joinSorted(ps.classes)}\u0001${joinSorted(ps.scopes)}`;
    if (this.hasStructural) sig += `\u0004${this.structuralBits(prev, ps)}`;
    return sig;
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
    if (this.hasStructural) {
      // Sibling position is not in the parent chain: a neighbor's
      // insert/remove leaves the parent chainId alone. The dirty element
      // itself recomputes bits here; if they moved, its cached match is
      // stale AND every descendant's chain key embeds this element's chain
      // id, so the whole subtree has to re-key. `noteStructureChange` marks
      // the siblings; this is where each one finds out whether it moved.
      const bits = this.structuralBits(id, s);
      if (s.structBits !== bits) {
        const firstBuild = s.selfSig === undefined;
        s.structBits = bits;
        s.selfSig = undefined;
        this.releaseChain(s);
        if (!firstBuild) this.markDirty(id, true);
      }
    }
    if (this.hasSiblingRules) {
      // Same story for `A + B`: the previous sibling's identity is not in
      // the parent chain, so whoever got marked rechecks it here. A change
      // re-keys this element (buildChainKey embeds the signature); unlike
      // the structural case descendants are unaffected — no subtree work.
      const sig = this.prevSiblingSig(id);
      if (s.prevSig !== sig) {
        const firstBuild = s.selfSig === undefined && s.prevSig === undefined;
        s.prevSig = sig;
        this.releaseChain(s);
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
    const anyActive = this.matchAnyActive;
    const anyHover = this.matchAnyHover;
    const byCascade = (
      a: { rule: CssRule; spec: number },
      b: { rule: CssRule; spec: number },
    ) => a.spec - b.spec || a.rule.order - b.rule.order;
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
    // cascaded per pseudo kind in source order. State variants stay out
    // (`:active::before` is not the supported subset — see MatchResult).
    let beforeDecls: Record<string, unknown> | undefined;
    let afterDecls: Record<string, unknown> | undefined;
    let placeholderDecls: Record<string, unknown> | undefined;
    if (this.hasPseudo) {
      const before: Array<{ rule: CssRule; spec: number }> = [];
      const after: Array<{ rule: CssRule; spec: number }> = [];
      const placeholder: Array<{ rule: CssRule; spec: number }> = [];
      for (const cls of s.classes) {
        this.scanPseudoBucket(this.pseudoBuckets.byClass.get(cls), stamp, id, s, before, after, placeholder);
      }
      this.scanPseudoBucket(this.pseudoBuckets.byTag.get(s.tag), stamp, id, s, before, after, placeholder);
      this.scanPseudoBucket(this.pseudoBuckets.catchAll, stamp, id, s, before, after, placeholder);
      const fold = (bucket: Array<{ rule: CssRule; spec: number }>) => {
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
      }
      beforeDecls = fold(before);
      afterDecls = fold(after);
      placeholderDecls = fold(placeholder);
    }
    const result: MatchResult = {
      decls,
      custom,
      activeDecls,
      hoverDecls,
      beforeDecls,
      afterDecls,
      placeholderDecls,
      id: this.nextObjId++,
      byParent: new Map(),
      sheets: sheetSet ? [...sheetSet] : undefined,
    };
    this.matchCache.set(key, result);
    return remember(result);
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
    before: Array<{ rule: CssRule; spec: number }>,
    after: Array<{ rule: CssRule; spec: number }>,
    placeholder: Array<{ rule: CssRule; spec: number }>,
  ): void {
    if (bucket === undefined) return;
    for (const rule of bucket) {
      if ((rule as IndexedRule).bucketStamp === stamp) continue;
      (rule as IndexedRule).bucketStamp = stamp;
      if (rule.media !== undefined && !mediaMatches(rule.media, this.viewport.width, this.viewport.height)) {
        continue;
      }
      let best = -1;
      for (const sel of rule.selectors) {
        if (rule.scope != null) {
          const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
          if (!has) continue;
        }
        if (!this.matchSelector(sel, id)) continue;
        best = Math.max(best, sel.specificity);
      }
      if (best < 0) continue;
      const spec = best + (rule.scope != null ? 10 : 0);
      (rule.pseudo === 'before' ? before : rule.pseudo === 'placeholder' ? placeholder : after).push({
        rule,
        spec,
      });
    }
  }

  private retainChain(s: ElementState, key: string, chainId: number): void {
    if (s.chainKey === key) return;
    this.releaseChain(s);
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
