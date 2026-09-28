// The JS half of the native style engine (specs/150).
//
// libfjs-style (packages/flutter_fjs/native/style) keeps the per-element
// state — tree, signatures, match / compute caches, dirty tracking, the
// flush — and reads it from style input ops riding the UI frames. What stays
// here is what the per-element path must NOT pay for: the CSS semantics,
// reached through StyleEngine.buildMatch / computeResult once per distinct
// match set / computed style, and the few per-element records the renderer
// reads back (class lists, inline layers).
//
// On by default where the host has __fjs.fns.styleAttach (vue/renderer.ts);
// `globalThis.__fjsNativeStyle = false` before the renderer loads keeps the
// TS engine, `'verify'` runs both and compares (StyleEngine.verifyNative).
import { flushNow, frameEpoch, getWriter, scheduleFlush } from '../host';
import { utf8Encode } from '../ui/utf8';
import { DISABLED_CLASS, mediaMatches, type AttrTest, type ClassAttrTest, type CssRule } from './parser';
import type { ComputeResult, MatchedRuleReport, MatchResult, PseudoHits, PseudoStyles, RuleHit, StyleEngine, StyleEngineStats } from './style';

/** Tags whose `:disabled` state the engine tracks (StyleEngine.setDisabled). */
const DISABLEABLE_TAGS = new Set(['input', 'textarea', 'button', 'select', 'option', 'fieldset']);

/** Mirrors fjs_style.h FJS_STYLE_RESULT_NOTIFY. */
const RESULT_NOTIFY = 1;

/** fjs_style.h attribute test operators. */
const ATTR_OPS: Record<ClassAttrTest['op'], number> = { '=': 1, '~=': 2, '|=': 3, '^=': 4, '$=': 5, '*=': 6 };

/** Computed results kept before a generation rolls over (see rotate). The
 * TS engine bounded the same growth per match (byParent ≤ 64); here one
 * table holds every result libfjs-style may still name. */
const RESULT_GENERATION_MAX = 16384;

type InlineRecord = { inline?: Record<string, unknown>; inlineCustom?: Record<string, string> };

/** One node of a clone template (specs/152), in pre-order, root first. */
export interface TemplateNodeSpec {
  /** Index of the parent node, -1 for the root. */
  parent: number;
  /** Registers with the style engine (elements and raw text; not anchors). */
  styled: boolean;
  raw: boolean;
  /** The tag the style engine matches (the tag the page wrote). */
  styleTag: string;
  defaults: Record<string, unknown> | undefined;
  defaultsId: number;
  scope: string | null;
  /** The class attribute value, null for none. */
  classes: string | null;
  /** What the Create op names, the constant props JSON ('' = none) and the
   * static text ('' = none) the element gets. */
  createTag: string;
  props: string;
  text: string;
}

/** What the backend needs from the engine that owns it — its CSS state and
 * the renderer's apply callback. */
export interface NativeStyleHost {
  engine: StyleEngine;
  /** Every registered rule (plain and pseudo), the :root tokens, the
   * viewport and whether pseudo rules exist. */
  sources(): {
    rules: readonly CssRule[];
    pseudoRules: readonly CssRule[];
    rootCustom: Record<string, string> | undefined;
    viewport: { width: number; height: number };
    hasPseudo: boolean;
  };
  /** StyleEngine's parseClassValue (shared, cached sets). */
  parseClasses(value: unknown): Set<string>;
  /** The renderer's applyStyle, for results flagged NOTIFY — its side
   * effects only: libfjs-style has written the element's styles already. */
  apply(
    id: number,
    style: Record<string, unknown>,
    active: Record<string, unknown> | null,
    pseudo: PseudoStyles | null | undefined,
  ): void;
}

export class NativeStyleBackend {
  private readonly writer = getWriter();
  private atoms = new Map<string, number>();
  private atomNames: string[] = [''];
  /** Host rule index (fjs_style_hit.rule) → rule; a full table resets it,
   * an appended one extends it. Rules left out (a failing @media) hold no
   * index. */
  private table: CssRule[] = [];
  /** Match / result ids libfjs-style may name, in two generations: a roll
   * (rotate) restyles everything under new ids, and the old generation
   * stays readable until that restyle has run. */
  private matches = new Map<number, MatchResult>();
  private oldMatches = new Map<number, MatchResult>();
  private results = new Map<number, ComputeResult>();
  private oldResults = new Map<number, ComputeResult>();
  private rotating = false;
  /** Hit set → its match: two chains that drew on the same rules share one
   * MatchResult, so their elements share compute results too. */
  private matchByHits = new Map<string, number>();
  /** Scopes an element has carried (register's fast path, see appendRules). */
  private seenScopes = new Set<string>();
  private defaults = new Map<number, Record<string, unknown>>();
  /** Tag → atom * 2 + (1 when the tag can be :disabled). */
  private tagInfo = new Map<string, number>();
  /** Class attribute value → its atoms (bounded like parseClassValue's). */
  private classAtoms = new Map<string, number[]>();
  private lastScope = '';
  private lastScopeAtom = 0;
  /** Sparse per-element records: form controls (their class atoms, and
   * which are :disabled), inline styles, elements with pseudo-element boxes. */
  private disableable = new Map<number, number[]>();
  private disabledOn = new Set<number>();
  private inlines = new Map<number, InlineRecord>();
  private inlineKeys = new Map<string, number>();
  private pseudoApplied = new Map<number, PseudoStyles>();

  constructor(
    private readonly host: NativeStyleHost,
    private readonly fns: FjsNativeFns,
  ) {
    const ok = fns.styleAttach!(
      (hits) => this.defineMatch(hits),
      (el, match, parent, tag, defaultsId, inlineKey, flags, seeded) =>
        this.compute(el, match, parent, tag, defaultsId, inlineKey, flags, seeded),
      (el, result) => this.styled(el, result),
    );
    if (!ok) throw new Error('styleAttach refused');
  }

  /** False once a frame was rejected: libfjs-style detached itself. */
  get attached(): boolean {
    // only a frame can detach it: ask once per frame (a clone checks per
    // instance, and the answer is a native call)
    if (this.attachedAt !== frameEpoch.value) {
      this.attachedAt = frameEpoch.value;
      this.attachedNow = (this.fns.styleResult?.(0) ?? -1) >= 0;
    }
    return this.attachedNow;
  }

  private attachedAt = -1;
  private attachedNow = true;

  private atom(name: string): number {
    let a = this.atoms.get(name);
    if (a === undefined) {
      a = this.atomNames.length;
      this.atomNames.push(name);
      this.atoms.set(name, a);
      this.writer.styleAtom(a, name);
    }
    return a;
  }

  // ---- per-element inputs ----------------------------------------------------
  //
  // The mount path: one call per element per input, and each must cost less
  // than the TS engine's own fast path did (specs/149 queuedAlone), or the
  // flush saved is paid back here — under the interpreter a function hop or
  // a Map write is ~0.1-0.3 µs. So: no per-element records (the class list
  // lives in libfjs-style, read back through styleClasses on the rare read),
  // lookups cached per tag / class string / scope, one buffer write per op.

  ensure(id: number, tag: string, defaultsId: number, defaults: Record<string, unknown> | undefined, rawText: boolean): void {
    let info = this.tagInfo.get(tag);
    if (info === undefined) {
      info = this.atom(tag) * 2 + (DISABLEABLE_TAGS.has(tag) ? 1 : 0);
      this.tagInfo.set(tag, info);
    }
    if (defaults !== undefined && !this.defaults.has(defaultsId)) this.defaults.set(defaultsId, defaults);
    if ((info & 1) !== 0) this.disableable.set(id, []);
    this.commit();
    this.pId = id;
    this.pTag = info >>> 1;
    this.pDefaults = defaultsId;
    this.pRaw = rawText;
    this.pScope = 0;
    this.pClasses = null;
    scheduleFlush();
  }

  /** The element registered last and not written yet: Vue hands a new
   * element its scope and class right after creating it (createElement →
   * setScopeId → patchProp('class')), so those fold into its one EL record
   * instead of three (specs/151). Anything else that writes, and the frame
   * going out (StyleEngine.flushPending runs as a pre-flush), commits it. */
  private pId = 0;
  private pTag = 0;
  private pDefaults = 0;
  private pRaw = false;
  private pScope = 0;
  private pClasses: readonly number[] | null = null;

  commit(): void {
    if (this.pId === 0) return;
    this.writer.styleEl(this.pId, this.pTag, this.pDefaults, this.pRaw, this.pScope, this.pClasses);
    this.pId = 0;
  }

  setClasses(id: number, value: unknown): void {
    let atoms = typeof value === 'string' ? this.classAtoms.get(value) : undefined;
    if (atoms === undefined) {
      atoms = [];
      for (const c of this.host.parseClasses(value)) if (c !== DISABLED_CLASS) atoms.push(this.atom(c));
      if (typeof value === 'string') {
        if (this.classAtoms.size >= 4096) this.classAtoms.clear();
        this.classAtoms.set(value, atoms);
      }
    }
    // the state token follows setDisabled, never the class value — kept
    // here per form control, so neither this nor setDisabled has to read
    // libfjs-style's copy (a read flushes: mid-patch, that restyled half-
    // built trees over and over)
    const own = this.disableable.get(id);
    if (own !== undefined) {
      this.disableable.set(id, atoms);
      if (this.disabledOn.has(id)) atoms = [...atoms, this.disabledAtom()];
    }
    if (id === this.pId) {
      this.pClasses = atoms;
      return;
    }
    this.commit();
    this.writer.styleClasses(id, atoms);
    scheduleFlush();
  }

  setDisabled(id: number, disabled: boolean): void {
    const own = this.disableable.get(id);
    if (own === undefined || this.disabledOn.has(id) === disabled) return;
    if (disabled) this.disabledOn.add(id);
    else this.disabledOn.delete(id);
    this.commit();
    this.writer.styleClasses(id, disabled ? [...own, this.disabledAtom()] : own);
    scheduleFlush();
  }

  classesOf(id: number): string[] {
    const d = this.disabledAtom();
    return this.currentAtoms(id)
      .filter((a) => a !== d)
      .map((a) => this.atomNames[a]);
  }

  /** The class atoms libfjs-style holds, after sending what is pending. */
  private currentAtoms(id: number): number[] {
    flushNow();
    const buf = this.fns.styleClasses?.(id);
    return buf ? Array.from(new Uint32Array(buf)) : [];
  }

  private disabledAtom(): number {
    return this.atom(DISABLED_CLASS);
  }

  addScope(id: number, scope: string): void {
    let a = this.lastScopeAtom;
    if (scope !== this.lastScope) {
      a = this.atom(scope);
      this.lastScope = scope;
      this.lastScopeAtom = a;
      this.seenScopes.add(scope);
    }
    if (id === this.pId && this.pScope === 0) {
      this.pScope = a;
      return;
    }
    this.commit();
    this.writer.styleScope(id, a);
    scheduleFlush();
  }


  hasSeenScope(scope: string): boolean {
    return this.seenScopes.has(scope);
  }

  /** A reported attribute (null removes). Sent for every name: a sheet
   * registered later may test one (StyleEngine.setAttribute keeps them all
   * for the same reason). */
  setAttribute(id: number, name: string, value: string | null): void {
    this.commit();
    this.writer.styleAttr(id, this.atom(name.toLowerCase()), value);
    scheduleFlush();
  }

  /** The element's inline record, created on first write. */
  inlineRecord(id: number, create: boolean): InlineRecord | undefined {
    let r = this.inlines.get(id);
    if (r === undefined && create) {
      r = {};
      this.inlines.set(id, r);
    }
    return r;
  }

  /** `key` is StyleEngine.inlineKeyOf of `record`, '' when it is empty. */
  inlineChanged(id: number, key: string, record: InlineRecord): void {
    // verify mode edits the TS engine's state; the compute callback reads
    // the layers from here
    if (key === '') this.inlines.delete(id);
    else if (this.inlines.get(id) !== record) this.inlines.set(id, { inline: record.inline, inlineCustom: record.inlineCustom });
    this.commit();
    this.writer.styleInline(id, key === '' ? 0 : this.inlineKeyId(key));
    scheduleFlush();
  }

  /** Inline layer content → the small id libfjs-style keys on. */
  private inlineKeyId(key: string): number {
    let k = this.inlineKeys.get(key);
    if (k === undefined) {
      k = this.inlineKeys.size + 1;
      this.inlineKeys.set(key, k);
    }
    return k;
  }

  forget(id: number): void {
    this.disableable.delete(id);
    this.disabledOn.delete(id);
    this.inlines.delete(id);
    this.pseudoApplied.delete(id);
    if (id === this.pId) this.pId = 0;
    else this.commit();
    this.writer.styleForget(id);
  }

  computedOf(id: number): Record<string, unknown> | undefined {
    flushNow();
    const r = this.fns.styleResult?.(id) ?? 0;
    return r > 0 ? this.result(r)?.style : undefined;
  }

  /** Verify mode: the element's current native result — undefined when it
   * has none, null when libfjs-style is detached. Reads after the frame. */
  resultOf(id: number): ComputeResult | undefined | null {
    const r = this.fns.styleResult?.(id) ?? -1;
    if (r < 0) return null;
    return r > 0 ? this.result(r) : undefined;
  }

  /** Verify mode: the TS engine applies styles and runs the renderer's side
   * effects; the notifications would repeat them. */
  verifying = false;

  private result(id: number): ComputeResult | undefined {
    return this.results.get(id) ?? this.oldResults.get(id);
  }

  /** DevTools: StyleEngine.matchedRulesOf off libfjs-style's hits. Which
   * selectors of a rule matched is not kept there; the report marks every
   * selector without a state or pseudo part that could carry the rule's
   * winning specificity. */
  matchedRulesOf(id: number): MatchedRuleReport[] {
    flushNow();
    const buf = this.fns.styleMatchedRules?.(id);
    if (!buf) return [];
    const hits = new Int32Array(buf);
    const out: Array<{ rule: CssRule; spec: number }> = [];
    for (let i = 0; i + 3 < hits.length; i += 4) {
      const rule = this.table[hits[i]];
      if (rule !== undefined && rule.pseudo === undefined && hits[i + 1] >= 0) out.push({ rule, spec: hits[i + 1] });
    }
    out.sort((a, b) => a.spec - b.spec || a.rule.order - b.rule.order);
    return out.map(({ rule, spec }) => ({
      selectors: rule.selectors.map((sel) => sel.text ?? ''),
      matched: rule.selectors.flatMap((sel, i) => (!sel.active && !sel.hover && !sel.pseudo && sel.specificity <= spec ? [i] : [])),
      decls: rule.decls,
    }));
  }

  resetStats(): void {
    this.fns.styleStats?.(true);
  }

  stats(base: StyleEngineStats): StyleEngineStats {
    const s = this.fns.styleStats?.(false);
    if (!s) return base;
    return {
      ...base,
      recompute: s.recompute,
      computeHit: s.computeHit,
      computeMiss: s.computeMiss,
      matchHit: s.matchHit,
      matchMiss: s.matchMiss,
      applied: s.applied,
      elements: s.elements,
      flushMs: s.flushMs,
    };
  }

  // ---- rule table ------------------------------------------------------------

  /** Sends the whole rule table (fjs_style.h): libfjs-style drops every
   * cache and restyles. On attach and on a viewport change when some rule
   * has a media condition (the table leaves failing rules out). */
  sendRules(): void {
    const src = this.host.sources();
    this.table = [];
    // old match ids are never named again once the table is replaced
    this.matches.clear();
    this.oldMatches.clear();
    this.matchByHits.clear();
    this.writer.styleRules(this.encode([...src.rules, ...src.pseudoRules]), false);
    scheduleFlush();
  }

  /** Adds one sheet's rules without invalidating anything; StyleEngine
   * .register follows with restyleAll unless its fast path held (a scoped
   * sheet whose scope no element has carried). libfjs-style invalidates by
   * itself when the new rules change the shape flags or the tested
   * attribute names. The hit-set memo stays valid: indices never move, and
   * a MatchResult depends on its rules alone. */
  appendRules(rules: readonly CssRule[]): void {
    if (rules.length === 0) return;
    this.writer.styleRules(this.encode(rules), true);
    scheduleFlush();
  }

  /** The rule table encoding for `rules`, continuing this.table's indices. */
  private encode(rules: readonly CssRule[]): Uint8Array {
    const { viewport } = this.host.sources();
    const kept = rules.filter((r) => r.media === undefined || mediaMatches(r.media, viewport.width, viewport.height));
    const bytes: number[] = [];
    const u8 = (v: number) => bytes.push(v & 0xff);
    const u16 = (v: number) => bytes.push(v & 0xff, (v >>> 8) & 0xff);
    const u32 = (v: number) => bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    const str16 = (v: string) => {
      // UTF-8, u16 length: selector values are short
      const enc = utf8Encode(v);
      u16(enc.length);
      for (let i = 0; i < enc.length; i++) bytes.push(enc[i]);
    };
    u32(kept.length);
    for (const rule of kept) {
      u32(this.table.length);
      this.table.push(rule);
      u32(rule.scope == null ? 0 : this.atom(rule.scope));
      u8(rule.pseudo === 'before' ? 1 : rule.pseudo === 'after' ? 2 : rule.pseudo === 'placeholder' ? 3 : 0);
      u8(rule.selectors.length);
      for (const sel of rule.selectors) {
        u8((sel.deep ? 1 : 0) | (sel.active ? 2 : 0) | (sel.hover ? 4 : 0));
        u16(sel.specificity);
        u8(sel.compounds.length);
        sel.compounds.forEach((c, ci) => {
          const comb = ci === 0 ? 'descendant' : sel.combinators[ci - 1];
          u8(comb === 'child' ? 1 : comb === 'nextSibling' ? 2 : 0);
          u32(c.tag == null ? 0 : this.atom(c.tag));
          u8((c.first ? 1 : 0) | (c.last ? 2 : 0) | (c.notFirst ? 4 : 0) | (c.notLast ? 8 : 0));
          u8(c.classes.length);
          for (const cls of c.classes) u32(this.atom(cls));
          const classAttr: readonly ClassAttrTest[] = c.classAttr ?? [];
          u8(classAttr.length);
          for (const t of classAttr) {
            u8(ATTR_OPS[t.op]);
            str16(t.value);
          }
          const attrs: readonly AttrTest[] = c.attrs ?? [];
          u8(attrs.length);
          for (const t of attrs) {
            u32(this.atom(t.name));
            u8(t.op === undefined ? 0 : ATTR_OPS[t.op]);
            str16(t.value ?? '');
          }
        });
      }
    }
    return Uint8Array.from(bytes);
  }

  /** :root tokens or @keyframes changed: every computed style may differ. */
  restyleAll(): void {
    this.writer.styleRestyle(0, true);
    scheduleFlush();
  }

  // ---- template clones (specs/152) ---------------------------------------------

  private nextTemplate = 1;

  /** Encodes a template (W_TEMPLATE) and returns its id, or 0 when it holds
   * something a clone cannot carry: a form control the engine tracks
   * `:disabled` for keeps a per-element record here (ensure). */
  defineTemplate(nodes: readonly TemplateNodeSpec[]): number {
    for (const n of nodes) if (n.styled && DISABLEABLE_TAGS.has(n.styleTag)) return 0;
    const tid = this.nextTemplate++;
    const words: number[] = [7, tid, nodes.length];
    const pack = (v: string) => {
      const b = utf8Encode(v);
      words.push(b.length);
      for (let i = 0; i < b.length; i += 4) {
        words.push((b[i] | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0);
      }
    };
    for (const n of nodes) {
      if (n.defaults !== undefined && !this.defaults.has(n.defaultsId)) this.defaults.set(n.defaultsId, n.defaults);
      if (n.scope !== null) this.seenScopes.add(n.scope);
      const classes: number[] = [];
      if (n.classes !== null) for (const c of this.host.parseClasses(n.classes)) if (c !== DISABLED_CLASS) classes.push(this.atom(c));
      words.push(
        (n.raw ? 1 : 0) | (n.styled ? 2 : 0),
        n.parent < 0 ? 0xffffffff : n.parent,
        n.styled ? this.atom(n.styleTag) : 0,
        n.defaultsId,
        n.scope === null ? 0 : this.atom(n.scope),
        classes.length,
        ...classes,
      );
      pack(n.createTag);
      pack(n.props);
      pack(n.text);
    }
    this.commit();
    this.writer.styleTemplate(words);
    scheduleFlush();
    return tid;
  }

  /** One instance of a template; its nodes are `first`, `first + 1`, …. */
  clone(template: number, first: number): void {
    this.commit();
    this.writer.styleClone(template, first);
    scheduleFlush();
  }

  // ---- build-time snapshot (specs/119) ---------------------------------------

  /** One snapshot chain: StyleEngine's chain key suffix — `tag \1 classes
   * \1 scopes`, then `\4 bits`, `\6 attrs`, `\5 prev` as the engine's
   * shape flags had them — respelled in atoms (SEED_CHAIN). */
  seedChain(seed: number, parentSeed: number, suffix: string, match: MatchResult): void {
    this.matches.set(match.id, match);
    const cut = suffix.indexOf('\u0005');
    const self = cut < 0 ? suffix : suffix.slice(0, cut);
    const prev = cut < 0 ? '' : suffix.slice(cut + 1);
    // parse everything first: atom() may write ATOM ops, which must not land
    // inside the seed op
    const own = this.parseSig(self, true);
    const nb = prev === '' ? null : this.parseSig(prev, false);
    const w = this.writer;
    w.styleSeedChain(seed, parentSeed);
    w.styleSigPart(own.tag, own.classes, own.scopes, own.bits, own.attrs);
    w.styleSeedChainPrev(nb !== null);
    if (nb !== null) w.styleSigPart(nb.tag, nb.classes, nb.scopes, nb.bits, null);
    w.styleSeedChainEnd(match.id);
  }

  private parseSig(
    text: string,
    withAttrs: boolean,
  ): { tag: number; classes: number[]; scopes: number[]; bits: number; attrs: Array<[number, string]> | null } {
    let rest = text;
    let attrText = '';
    const a = rest.indexOf('\u0006');
    if (a >= 0) {
      attrText = rest.slice(a + 1);
      rest = rest.slice(0, a);
    }
    let bits = 0xffffffff;
    const b = rest.indexOf('\u0004');
    if (b >= 0) {
      bits = Number(rest.slice(b + 1));
      rest = rest.slice(0, b);
    }
    const [tag, classText = '', scopeText = ''] = rest.split('\u0001');
    const list = (joined: string) => (joined === '' ? [] : joined.split('\u0002'));
    const classes = list(classText).map((c) => this.atom(c));
    const scopes = list(scopeText).map((sc) => {
      // a later sheet for one of these scopes must invalidate
      this.seenScopes.add(sc);
      return this.atom(sc);
    });
    let attrs: Array<[number, string]> | null = null;
    if (withAttrs) {
      attrs = list(attrText).map((pair) => {
        const eq = pair.indexOf('=');
        return [this.atom(pair.slice(0, eq)), pair.slice(eq + 1)] as [number, string];
      });
    }
    return { tag: this.atom(tag), classes, scopes, bits, attrs };
  }

  /** One snapshot compute entry, keyed as libfjs-style's compute cache is
   * (SEED_COMPUTE). `inlineKey` is StyleEngine.inlineKeyOf's spelling. The
   * JSON is not sent: the first element to hit the entry asks for it
   * (compute's `seeded`) — most of a snapshot's entries are, and the strings
   * cross far cheaper as a callback's return than written into the frame. */
  seedCompute(match: number, parentResult: number, inlineKey: string, result: ComputeResult): void {
    this.results.set(result.styleId, result);
    this.writer.styleSeedCompute(
      match,
      parentResult,
      result.defaultsId,
      inlineKey === '' ? 0 : this.inlineKeyId(inlineKey),
      result.rawText,
      result.styleId,
      this.flagsOf(result),
    );
    scheduleFlush();
  }

  /** NOTIFY for the results the renderer has side effects for (fixed
   * hoisting, modal masks, pseudo boxes / placeholder); libfjs-style also
   * notifies an element LEAVING such a result, so an unhoist is seen too. */
  private flagsOf(entry: ComputeResult): number {
    return entry.style.position === 'fixed' || entry.pseudo !== undefined ? RESULT_NOTIFY : 0;
  }

  private describe(entry: ComputeResult): FjsNativeStyleResult {
    return {
      result: entry.styleId,
      flags: this.flagsOf(entry),
      style: JSON.stringify(entry.style),
      active: entry.activeStyle ? JSON.stringify(entry.activeStyle) : null,
      hover: entry.hoverStyle ? JSON.stringify(entry.hoverStyle) : null,
    };
  }

  /** Starts a new generation: libfjs-style drops its caches and restyles
   * every element (RESTYLE 0), minting new match / result ids; the current
   * tables become the old generation, readable until that restyle ran. Runs
   * outside the callbacks — the flush that filled the table may still name
   * what is in it. */
  private rotate(): void {
    this.rotating = false;
    this.oldResults = this.results;
    this.results = new Map();
    this.oldMatches = this.matches;
    this.matches = new Map();
    this.matchByHits.clear();
    this.restyleAll();
  }

  // ---- callbacks (inside uiOps; must not flush) ------------------------------

  private defineMatch(buf: ArrayBuffer): number {
    const hits = new Int32Array(buf);
    // hits arrive in candidate-walk order, which is the same for the same
    // rule set; a different order only costs a duplicate MatchResult
    const key = hits.join(',');
    const known = this.matchByHits.get(key);
    if (known !== undefined) return known;
    const plain: RuleHit[] = [];
    const active: RuleHit[] = [];
    const hover: RuleHit[] = [];
    let anyActive = false;
    let anyHover = false;
    const pseudo: PseudoHits | undefined = this.host.sources().hasPseudo
      ? { before: [], after: [], placeholder: [], activeBefore: [], activeAfter: [] }
      : undefined;
    for (let i = 0; i + 3 < hits.length; i += 4) {
      const rule = this.table[hits[i]];
      const bp = hits[i + 1];
      const ba = hits[i + 2];
      const bh = hits[i + 3];
      // scoped rules win ties over global ones (scanPlainBucket's bump)
      const bump = rule.scope != null ? 10 : 0;
      if (rule.pseudo === undefined) {
        if (bp >= 0) plain.push({ rule, spec: bp + bump });
        if (ba >= 0) active.push({ rule, spec: ba + bump });
        if (bh >= 0) hover.push({ rule, spec: bh + bump });
        if (ba > bp) anyActive = true;
        if (bh > bp) anyHover = true;
      } else if (pseudo !== undefined) {
        // scanPseudoBucket's split
        if (rule.pseudo === 'placeholder') {
          if (bp >= 0) pseudo.placeholder.push({ rule, spec: bp + bump });
          continue;
        }
        const isBefore = rule.pseudo === 'before';
        if (bp >= 0) (isBefore ? pseudo.before : pseudo.after).push({ rule, spec: bp + bump });
        (isBefore ? pseudo.activeBefore : pseudo.activeAfter).push({ rule, spec: ba + bump, state: ba > bp });
      }
    }
    const result = this.host.engine.buildMatch(plain, active, hover, anyActive, anyHover, pseudo);
    this.matches.set(result.id, result);
    this.matchByHits.set(key, result.id);
    return result.id;
  }

  private compute(
    el: number,
    match: number,
    parentResult: number,
    tag: number,
    defaultsId: number,
    inlineKey: number,
    flags: number,
    seeded: number,
  ): FjsNativeStyleResult {
    if (seeded !== 0) {
      const known = this.result(seeded);
      if (known === undefined) throw new Error(`native style: unknown seeded result ${seeded}`);
      return this.describe(known);
    }
    const matched = this.matches.get(match) ?? this.oldMatches.get(match);
    if (matched === undefined) throw new Error(`native style: unknown match ${match}`);
    const parent = parentResult !== 0 ? this.result(parentResult) : undefined;
    const inline = inlineKey !== 0 ? this.inlines.get(el) : undefined;
    const entry = this.host.engine.computeResult(
      matched,
      parent?.style,
      parent ? parent.custom : this.host.sources().rootCustom,
      {
        tag: this.atomNames[tag],
        rawText: (flags & 1) !== 0 ? true : undefined,
        defaults: defaultsId !== 0 ? this.defaults.get(defaultsId) : undefined,
        defaultsId,
        inline: inline?.inline,
        inlineCustom: inline?.inlineCustom,
      },
    );
    this.results.set(entry.styleId, entry);
    if (this.results.size > RESULT_GENERATION_MAX && !this.rotating) {
      this.rotating = true;
      void Promise.resolve().then(() => this.rotate());
    }
    return this.describe(entry);
  }

  private styled(el: number, result: number): void {
    if (this.verifying) return;
    const entry = this.result(result);
    if (entry === undefined) return;
    const prev = this.pseudoApplied.get(el);
    let note: PseudoStyles | null | undefined;
    if (entry.pseudo === undefined) {
      if (prev !== undefined) note = null;
      this.pseudoApplied.delete(el);
    } else {
      if (prev !== entry.pseudo) note = entry.pseudo;
      this.pseudoApplied.set(el, entry.pseudo);
    }
    this.host.apply(el, entry.style, entry.activeStyle ?? null, note);
    scheduleFlush();
  }
}
