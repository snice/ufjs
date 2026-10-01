// Style engine: stores rules parsed from <style> blocks, matches them
// against elements, and computes each element's final style object
// (cascade by specificity + source order, then CSS inheritance along the
// element tree). The Vue renderer feeds element state (tag/class/scopes/
// inline style) and applies computed styles back through setProps, so the
// native bridge keeps receiving exactly one merged `style` map per element.
//
// specs/172: the CSS half (sheets, cascade, compute) lives in style-core.ts;
// this is the TS per-element engine on top of it. A Flutter build ships
// NativeStyleEngine (style-native.ts) instead unless built with --ts-style.
import { DISABLED_CLASS, warnOnce, type AttrTest, type ClassAttrTest, type CssRule, type Selector, mediaMatches } from './parser';
import type { NativeStyleBackend, TemplateNodeSpec } from './native-style';
import { setOpSink } from '../host';
import {
  StyleCore,
  parseClassValue,
  sameStyle,
  type ApplyStyle,
  type ComputeResult,
  type InlineLayers,
  type MatchedRuleReport,
  type MatchResult,
  type PseudoHits,
  type PseudoStyles,
  type StyleEngineStats,
} from './style-core';

export * from './style-core';

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

interface ElementState extends InlineLayers {
  tag: string;
  classes: Set<string>;
  scopes: Set<string>;
  /** Renderer-synthesized bare-text element (`createText`); excluded from
   * sibling position for structural pseudos. Explicit `<text>` is not. */
  rawText?: boolean;
  defaults?: Record<string, unknown>; // HTML tag default style (h1, tr, ...)
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

/** How many dead chains to keep around before evicting the oldest. A chain
 * holds its key string, its id and a MatchResult (declarations plus the
 * per-parent compute cache) — low hundreds of bytes each, so the cap bounds
 * retention at roughly a page's worth of signatures (~0.2 MB). The point of
 * keeping them: navigating BACK to a page hits the retained matches instead
 * of re-paying the full mount (specs/076). */
const RETIRED_CHAIN_LIMIT = 512;

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

export class StyleEngine extends StyleCore {
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
  /** Every scope an element has carried. Only grows. A scoped sheet whose
   * scope is NOT in here cannot change any cached answer — see the fast path
   * in register(). */
  private seenScopes = new Set<string>();
  /** Reused by markDirty so a walk allocates nothing. */
  private walkStack: number[] = [];

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
    this.native = this.newNativeBackend(fns);
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

  /** Whether template clones can be expanded natively right now (specs/152):
   * attached, and not detached by a rejected frame since. */
  get canClone(): boolean {
    return this.native !== undefined && this.native.attached;
  }

  /** Registers a clone template with libfjs-style; 0 when this one cannot be
   * cloned (see NativeStyleBackend.defineTemplate). */
  defineCloneTemplate(nodes: Array<Omit<TemplateNodeSpec, 'defaultsId'>>): number {
    if (this.native === undefined) return 0;
    return this.native.defineTemplate(nodes.map((n) => ({ ...n, defaultsId: n.defaults ? this.defaultsIdOf(n.defaults) : 0 })));
  }

  /** One instance of a registered template, its nodes numbered from `first`. */
  cloneTemplate(template: number, first: number): void {
    this.native!.clone(template, first);
  }

  /** specs/162: count instances in one op — the engine also inserts every
   * root under `parent` before `anchor` (0 = append) and overrides
   * `textNode`'s static text per copy (0xffffffff = none, texts null). */
  cloneMany(template: number, first: number, count: number, parent: number, anchor: number, textNode: number, texts: readonly string[] | null): void {
    this.native!.cloneMany(template, first, count, parent, anchor, textNode, texts);
  }

  resetStats(): void {
    this.native?.resetStats();
    this.counters = { recompute: 0, computeHit: 0, computeMiss: 0, matchHit: 0, matchMiss: 0, applied: 0, flushMs: 0, flushes: 0, markMs: 0, markCalls: 0, markVisited: 0 };
  }

  constructor(
    private readonly parentOf: Map<number, number | null>,
    private readonly childrenOf: Map<number, number[]>,
    applyStyle: ApplyStyle,
  ) {
    super(applyStyle);
  }

  /** Registers a <style> block. scope=null means global (non-scoped). */
  register(scope: string | null, cssText: string): void {
    const outcome = this.registerSheet(scope, cssText);
    if (this.native === undefined || outcome === null) return;
    // libfjs-style gets the sheet's rules appended either way (resending the
    // whole table per sheet was quadratic: vant registers dozens); outside
    // the fast path every cache is dropped on top, as here
    this.native.appendRules(outcome === 'full' ? this.lastAdded : outcome);
    if (outcome === 'full') this.native.restyleAll();
  }

  // ---- StyleCore hooks ---------------------------------------------------------

  protected override ruleAdded(rule: CssRule, pseudo: boolean): void {
    indexRule(pseudo ? this.pseudoBuckets : this.plainBuckets, rule);
  }

  protected override attrNameAdded(name: string): void {
    // elements that already carry it were keyed without it
    for (const [eid, st] of this.states) {
      if (st.attrs?.has(name)) {
        st.selfSig = undefined;
        this.markDirty(eid, true);
      }
    }
  }

  protected scopeSeen(scope: string): boolean {
    return this.seenScopes.has(scope) || (this.native?.hasSeenScope(scope) ?? false);
  }

  protected invalidateAll(): void {
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

  protected viewportChanged(): void {
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

  /** @internal Test/diagnostic view of cache sizes. */
  cacheStatsForTest(): { matchCache: number; chainIds: number; byParent: number; epoch: number } {
    let byParent = 0;
    for (const m of this.matchCache.values()) byParent += m.byParent.size;
    return {
      epoch: this.matchEpoch,
      matchCache: this.matchCache.size,
      chainIds: this.chainIds.size,
      byParent,
    };
  }

  /** Every element of a subtree whose Remove op the host gets:
   * libfjs-style forgets them there, so no FORGET word per element; the TS
   * engine (when it runs) forgets them one by one (specs/158). */
  forgetRemoved(ids: readonly number[]): void {
    if (this.native !== undefined) {
      this.native.forgetRemoved(ids);
      if (this.nativeOnly) return;
    }
    for (let i = 0; i < ids.length; i++) this.forgetTs(ids[i]);
  }

  forget(id: number): void {
    if (this.native !== undefined) {
      this.native.forget(id);
      if (this.nativeOnly) return;
    }
    this.forgetTs(id);
  }

  private forgetTs(id: number): void {
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
  protected inlineState(id: number): InlineLayers | undefined {
    return this.nativeOnly ? this.native!.inlineRecord(id, true) : this.states.get(id);
  }

  protected inlineRead(id: number): InlineLayers | undefined {
    return this.nativeOnly ? this.native!.inlineRecord(id, false) : this.states.get(id);
  }

  /** An inline record changed: restyle the element and its subtree. */
  protected inlineChanged(id: number, s: InlineLayers): void {
    if (this.native !== undefined) {
      const empty = s.inline === undefined && s.inlineCustom === undefined;
      this.native.inlineChanged(id, empty ? '' : this.inlineKeyOf(s), s);
      if (this.nativeOnly) return;
    }
    this.markDirty(id, true);
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
    // native: libfjs-style flushes inside uiOps; what the backend still holds
    // goes into this frame
    if (this.native !== undefined) {
      this.native.commit();
      if (this.nativeOnly) return;
    }
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

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
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
