// The style engine a Flutter build ships (specs/172): the CSS half from
// style-core.ts, with every per-element entry point handed to libfjs-style
// (css/native-style.ts, specs/150). The TS per-element engine (style.ts)
// stays out of the bundle — vue/host-ops.ts picks this class whenever the
// build says `__FJS_TS_STYLE__ = false`, so esbuild drops the other one.
//
// Same public surface as StyleEngine in native-only mode; the methods that
// only the TS engine needs (markDirty's walk, structure notes) are no-ops
// here because libfjs-style reads structure off the Insert / Remove ops.
import type { NativeStyleBackend, TemplateNodeSpec } from './native-style';
import { StyleCore, type ApplyStyle, type InlineLayers, type MatchedRuleReport, type StyleEngineStats } from './style-core';

export class NativeStyleEngine extends StyleCore {
  private native!: NativeStyleBackend;

  constructor(applyStyle: ApplyStyle) {
    super(applyStyle);
  }

  /** Attaches libfjs-style; must run before the first element exists. False
   * when the host has no native style engine — the caller reports it (a
   * native-only bundle cannot style anything without one). */
  attachNative(fns: FjsNativeFns): boolean {
    if (fns.styleAttach === undefined) return false;
    this.native = this.newNativeBackend(fns);
    return true;
  }

  get nativeAttached(): boolean {
    return this.native !== undefined;
  }

  get stats(): StyleEngineStats {
    return this.native.stats({ ...this.counters, elements: 0, rules: this.rules.length });
  }

  resetStats(): void {
    this.native.resetStats();
    this.counters = { recompute: 0, computeHit: 0, computeMiss: 0, matchHit: 0, matchMiss: 0, applied: 0, flushMs: 0, flushes: 0, markMs: 0, markCalls: 0, markVisited: 0 };
  }

  /** Verify mode needs the TS engine (`fjs build --ts-style`). */
  get verifyStats(): { compared: number; mismatched: number } {
    return { compared: 0, mismatched: 0 };
  }

  // ---- template clones (specs/152, 162) ----------------------------------------

  get canClone(): boolean {
    return this.native.attached;
  }

  defineCloneTemplate(nodes: Array<Omit<TemplateNodeSpec, 'defaultsId'>>): number {
    return this.native.defineTemplate(nodes.map((n) => ({ ...n, defaultsId: n.defaults ? this.defaultsIdOf(n.defaults) : 0 })));
  }

  cloneTemplate(template: number, first: number): void {
    this.native.clone(template, first);
  }

  cloneMany(template: number, first: number, count: number, parent: number, anchor: number, textNode: number, texts: readonly string[] | null): void {
    this.native.cloneMany(template, first, count, parent, anchor, textNode, texts);
  }

  // ---- sheets ------------------------------------------------------------------

  register(scope: string | null, cssText: string): void {
    const outcome = this.registerSheet(scope, cssText);
    if (outcome === null) return;
    // see StyleEngine.register: appended either way, restyled outside the
    // fast path
    this.native.appendRules(outcome === 'full' ? this.lastAdded : outcome);
    if (outcome === 'full') this.native.restyleAll();
  }

  // ---- elements ----------------------------------------------------------------

  ensure(id: number, tag: string, defaults?: Record<string, unknown>, rawText?: boolean): void {
    this.native.ensure(id, tag, defaults ? this.defaultsIdOf(defaults) : 0, defaults, rawText === true);
  }

  noteStructureChange(parentId: number): void {
    void parentId;
  }

  forgetRemoved(ids: readonly number[]): void {
    this.native.forgetRemoved(ids);
  }

  forget(id: number): void {
    this.native.forget(id);
  }

  setClasses(id: number, value: unknown): void {
    this.native.setClasses(id, value);
  }

  setDisabled(id: number, disabled: boolean): void {
    this.native.setDisabled(id, disabled);
  }

  setAttribute(id: number, name: string, value: string | null): void {
    this.native.setAttribute(id, name, value);
  }

  addScope(id: number, scope: string): void {
    this.native.addScope(id, scope);
  }

  classesOf(id: number): string[] {
    return this.native.classesOf(id);
  }

  matchedRulesOf(id: number): MatchedRuleReport[] {
    return this.native.matchedRulesOf(id);
  }

  computedOf(id: number): Record<string, unknown> | undefined {
    return this.native.computedOf(id);
  }

  markDirty(id: number, subtree: boolean): void {
    void id;
    void subtree;
  }

  recomputeSubtree(id: number): void {
    void id;
  }

  /** libfjs-style flushes inside uiOps; what the backend still holds goes
   * into this frame. */
  flushPending(): void {
    this.native.commit();
  }

  // ---- StyleCore hooks ---------------------------------------------------------

  protected scopeSeen(scope: string): boolean {
    return this.native?.hasSeenScope(scope) ?? false;
  }

  protected invalidateAll(): void {
    // nothing cached on this side: restyleAll in register() drops
    // libfjs-style's caches
  }

  protected viewportChanged(): void {
    // media conditions are judged here and baked into the table
    this.native.sendRules();
  }

  protected inlineState(id: number): InlineLayers | undefined {
    return this.native.inlineRecord(id, true);
  }

  protected inlineRead(id: number): InlineLayers | undefined {
    return this.native.inlineRecord(id, false);
  }

  protected inlineChanged(id: number, s: InlineLayers): void {
    const empty = s.inline === undefined && s.inlineCustom === undefined;
    this.native.inlineChanged(id, empty ? '' : this.inlineKeyOf(s), s);
  }
}
