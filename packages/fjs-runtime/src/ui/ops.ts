// Binary UI op writer — the TypeScript twin of flutter_fjs's
// lib/src/ui_ops.dart decoder (and of the dump in native/tools/fjsrun.cpp;
// all three switch on the same opcodes and must move together).
// One flush() = one frame = one call into native __fjs.fns.uiOps(Uint8Array).
// Little-endian throughout.
// Writes go into a single growable byte buffer (per-byte array pushes are
// the dominant mount cost under QuickJS).
import { drawableText } from './drawable-text';
import { utf8Encode } from './utf8';

export const enum UiOp {
  Create = 1,
  Remove = 2,
  Insert = 3,
  RemoveChild = 4,
  SetText = 5,
  SetProps = 6,
  DefineStyle = 7,
  SetStyle = 8,
  ResetStyles = 9,
  Canvas = 10,
  Webgl = 11,
  SetHoverStyle = 12,
  // Style input ops (specs/150): consumed by libfjs-style inside
  // __fjs.fns.uiOps and stripped before the frame reaches Dart, so Dart's
  // decoder never sees them — only written while the native style engine is
  // attached. Layouts in native/style/include/fjs_style.h.
  StyleAtom = 0x40,
  StyleEl = 0x41,
  StyleClasses = 0x42,
  StyleScope = 0x43,
  StyleInline = 0x44,
  StyleForget = 0x45,
  StyleRestyle = 0x46,
  StyleRules = 0x47,
  StyleAttr = 0x48,
  StyleRulesAppend = 0x49,
  StyleSeedChain = 0x4a,
  StyleSeedCompute = 0x4b,
}

/** How many interned styles the peer is asked to remember at once. The style
 * engine's own compute cache is capped at 4096 distinct results, so a smaller
 * table here only costs the occasional re-send. Overflow is handled by ending
 * the epoch (ResetStyles), never by dropping individual entries: ids are
 * resolved at decode time and the peer holds the resolved style directly, so
 * an entry leaving the table cannot dangle. */
const STYLE_TABLE_MAX = 2048;

/** Op protocol revision the host's decoder implements; interned styles need
 * 2, canvas display lists need 3, a canvas that erases part of itself needs
 * 4 (NEEDS_LAYER), WebGL command streams need 5, and the `:hover` style slot
 * needs 6. The host sets
 * `globalThis.__fjsHost` when it creates the VM. A missing value means an
 * older host that only knows ops 1-6 — a bundle built against this runtime
 * can meet one, since bundles ship separately from the Flutter binary. */
export function hostUiOpsVersion(): number {
  const declared = (globalThis as { __fjsHost?: { uiOpsVersion?: number } })
    .__fjsHost?.uiOpsVersion;
  return typeof declared === 'number' ? declared : 1;
}

let warnedOldHost = new Set<string>();
function warnOldHostOnce(what = 'canvas'): void {
  if (warnedOldHost.has(what)) return;
  warnedOldHost.add(what);
  console.warn(
    `[fjs] host is too old for ${what === 'canvas' ? '<canvas>' : what} ` +
      `(op protocol too low); nothing will be drawn. Update the flutter_fjs ` +
      'host.',
  );
}

export class OpWriter {
  private buf = new Uint8Array(8192);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  private u8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  private u32(v: number): void {
    this.ensure(4);
    const b = this.buf;
    let p = this.len;
    b[p++] = (v >>> 0) & 0xff;
    b[p++] = ((v >>> 8) & 0xff) as number;
    b[p++] = ((v >>> 16) & 0xff) as number;
    b[p++] = ((v >>> 24) & 0xff) as number;
    this.len = p;
  }

  /** One op byte followed by three u32s — Insert and SetStyle, the two ops
   * a mount writes per element. u8 + three u32 calls were four method calls
   * and four capacity checks for 13 bytes; under the interpreter the calls
   * cost more than the stores (specs/149). Same bytes as the long form. */
  private op3(op: number, a: number, b: number, c: number): void {
    this.ensure(13);
    const buf = this.buf;
    let p = this.len;
    buf[p++] = op;
    buf[p++] = a & 0xff;
    buf[p++] = (a >>> 8) & 0xff;
    buf[p++] = (a >>> 16) & 0xff;
    buf[p++] = (a >>> 24) & 0xff;
    buf[p++] = b & 0xff;
    buf[p++] = (b >>> 8) & 0xff;
    buf[p++] = (b >>> 16) & 0xff;
    buf[p++] = (b >>> 24) & 0xff;
    buf[p++] = c & 0xff;
    buf[p++] = (c >>> 8) & 0xff;
    buf[p++] = (c >>> 16) & 0xff;
    buf[p++] = (c >>> 24) & 0xff;
    this.len = p;
  }

  /** One op byte and a u32 id, in one capacity check (see op3). */
  private op1(op: number, a: number, extra: number): void {
    this.ensure(5 + extra);
    const buf = this.buf;
    let p = this.len;
    buf[p++] = op;
    buf[p++] = a & 0xff;
    buf[p++] = (a >>> 8) & 0xff;
    buf[p++] = (a >>> 16) & 0xff;
    buf[p++] = (a >>> 24) & 0xff;
    this.len = p;
  }

  private u16(v: number): void {
    this.ensure(2);
    const b = this.buf;
    let p = this.len;
    b[p++] = (v >>> 0) & 0xff;
    b[p++] = ((v >>> 8) & 0xff) as number;
    this.len = p;
  }

  private bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  /** Writes `s` as a length-prefixed UTF-8 string (u32 prefix when `wide`,
   * else u16).
   *
   * Nearly everything that crosses here is ASCII — text content, and the
   * JSON of every SetProps — and for ASCII the UTF-8 bytes ARE the char
   * codes. Encoding into a temporary Uint8Array first and copying it in
   * cost an allocation plus a second pass per string; under the
   * interpreter that was most of a SetText (specs/118: 6.3 → 4.6 µs). The
   * scan bails to utf8Encode on the first non-ASCII code unit, so anything
   * else (CJK, emoji, lone surrogates) gets exactly the bytes it always got. */
  private str(s: string, wide: boolean): void {
    const n = s.length;
    for (let i = 0; i < n; i++) {
      if (s.charCodeAt(i) >= 0x80) {
        const encoded = utf8Encode(s);
        if (wide) this.u32(encoded.length);
        else this.u16(encoded.length);
        this.bytes(encoded);
        return;
      }
    }
    if (wide) this.u32(n);
    else this.u16(n);
    this.ensure(n);
    const b = this.buf;
    let p = this.len;
    for (let i = 0; i < n; i++) b[p++] = s.charCodeAt(i);
    this.len = p;
  }

  /** Encoded tag names. A page uses a dozen distinct tags across hundreds of
   * creates, and re-encoding "view" every time was 2.3 µs of a 4.5 µs
   * create op (specs/118). */
  private tagBytes = new Map<string, Uint8Array>();

  create(id: number, tag: string): this {
    let encoded = this.tagBytes.get(tag);
    if (encoded === undefined) {
      encoded = utf8Encode(tag);
      this.tagBytes.set(tag, encoded);
    }
    const n = encoded.length;
    this.op1(UiOp.Create, id, 2 + n);
    const buf = this.buf;
    let p = this.len;
    buf[p++] = n & 0xff;
    buf[p++] = (n >>> 8) & 0xff;
    for (let i = 0; i < n; i++) buf[p++] = encoded[i];
    this.len = p;
    return this;
  }

  remove(id: number): this {
    this.u8(UiOp.Remove);
    this.u32(id);
    return this;
  }

  insert(parent: number, child: number, index: number): this {
    this.op3(UiOp.Insert, parent, child, index);
    return this;
  }

  removeChild(parent: number, child: number): this {
    this.u8(UiOp.RemoveChild);
    this.u32(parent);
    this.u32(child);
    return this;
  }

  setText(id: number, text: string): this {
    this.op1(UiOp.SetText, id, 0);
    this.str(drawableText(text), true);
    return this;
  }

  /** One canvas node's new drawing commands for this frame. The bytes are
   * the display list canvas/display-list.ts writes; this layer does not look
   * inside them (canvas/canvas_ops.dart is the decoder's twin).
   *
   * Drawing is a STREAM, not a property: two frames of commands append, they
   * do not replace each other, which is why this is its own op rather than a
   * key inside SetProps. A host too old to decode op 10 is told once and the
   * commands are dropped — silently painting nothing is the failure mode
   * constitution V exists to prevent, and a JSON fallback would mean
   * maintaining a second encoding for hosts that are already out of date. */
  canvas(id: number, commands: Uint8Array): this {
    if (this.uiOpsVersion < 3) {
      warnOldHostOnce();
      return this;
    }
    this.u8(UiOp.Canvas);
    this.u32(id);
    this.u32(commands.length);
    this.bytes(commands);
    return this;
  }

  /** One canvas node's new WebGL commands for this frame. The bytes are the
   * command stream canvas/webgl/protocol.ts writes; this layer does not look
   * inside them (canvas/webgl_replay.dart is the decoder's twin).
   *
   * Unlike op 10 these are EXECUTED, not retained: the host runs each chunk
   * into the node's GL framebuffer as it arrives and marks its texture for
   * display. Same degradation rule as op 10 — an old host is told once and
   * the commands are dropped, never silently blank. */
  webgl(id: number, commands: Uint8Array): this {
    if (this.uiOpsVersion < 5) {
      warnOldHostOnce('webgl');
      return this;
    }
    this.u8(UiOp.Webgl);
    this.u32(id);
    this.u32(commands.length);
    this.bytes(commands);
    return this;
  }

  setProps(id: number, props: Record<string, unknown>): this {
    return this.setPropsJson(id, JSON.stringify(props));
  }

  /** SetProps from an already-stringified props object — the element layer
   * caches the JSON of constant props (element.ts setConstProps) instead of
   * re-serializing the same object for every node. */
  setPropsJson(id: number, json: string): this {
    this.u8(UiOp.SetProps);
    this.u32(id);
    this.str(json, true);
    return this;
  }

  /** The `:hover` variant of a node's computed style, keyed like SetStyle's
   * active slot: replace semantics, id 0 clears. This is its own op rather
   * than a third slot inside SetStyle because widening SetStyle would leave
   * the decoder no way to tell which width an OLD runtime is sending — the
   * host's declared uiOpsVersion only flows one way, so an old runtime paired
   * with a new host reads every version gate as passed and keeps writing 12
   * bytes. A new opcode (the op 10/11 shape) degrades cleanly in both
   * directions: a new runtime gates on the version and never sends it to an
   * old host; an old runtime never emits it at all. */
  setHoverStyle(id: number, style: Record<string, unknown> | null): this {
    if (this.uiOpsVersion < 6) {
      if (style) warnOldHostOnce(':hover');
      return this;
    }
    // intern BEFORE writing the op: styleId() emits a DefineStyle into the
    // same buffer, which would otherwise land between op 12 and its payload
    const hid = style ? this.styleId(style) : 0;
    this.u8(UiOp.SetHoverStyle);
    this.u32(id);
    this.u32(hid);
    return this;
  }

  // ---- native style input (specs/150; see UiOp.StyleAtom) ----

  styleAtom(atom: number, name: string): this {
    this.op1(UiOp.StyleAtom, atom, 0);
    this.str(name, false);
    return this;
  }

  /** Registers an element with libfjs-style: 14 bytes, one capacity check
   * (the mount writes one per element). */
  styleEl(id: number, tag: number, defaultsId: number, rawText: boolean): this {
    this.ensure(14);
    const buf = this.buf;
    let p = this.len;
    buf[p++] = UiOp.StyleEl;
    buf[p++] = id & 0xff;
    buf[p++] = (id >>> 8) & 0xff;
    buf[p++] = (id >>> 16) & 0xff;
    buf[p++] = (id >>> 24) & 0xff;
    buf[p++] = tag & 0xff;
    buf[p++] = (tag >>> 8) & 0xff;
    buf[p++] = (tag >>> 16) & 0xff;
    buf[p++] = (tag >>> 24) & 0xff;
    buf[p++] = defaultsId & 0xff;
    buf[p++] = (defaultsId >>> 8) & 0xff;
    buf[p++] = (defaultsId >>> 16) & 0xff;
    buf[p++] = (defaultsId >>> 24) & 0xff;
    buf[p++] = rawText ? 1 : 0;
    this.len = p;
    return this;
  }

  styleClasses(id: number, atoms: readonly number[]): this {
    const n = atoms.length;
    this.op1(UiOp.StyleClasses, id, 2 + 4 * n);
    const buf = this.buf;
    let p = this.len;
    buf[p++] = n & 0xff;
    buf[p++] = (n >>> 8) & 0xff;
    for (let i = 0; i < n; i++) {
      const a = atoms[i];
      buf[p++] = a & 0xff;
      buf[p++] = (a >>> 8) & 0xff;
      buf[p++] = (a >>> 16) & 0xff;
      buf[p++] = (a >>> 24) & 0xff;
    }
    this.len = p;
    return this;
  }

  styleScope(id: number, atom: number): this {
    this.op1(UiOp.StyleScope, id, 4);
    const buf = this.buf;
    let p = this.len;
    buf[p++] = atom & 0xff;
    buf[p++] = (atom >>> 8) & 0xff;
    buf[p++] = (atom >>> 16) & 0xff;
    buf[p++] = (atom >>> 24) & 0xff;
    this.len = p;
    return this;
  }

  styleInline(id: number, key: number): this {
    this.op1(UiOp.StyleInline, id, 4);
    this.u32(key);
    return this;
  }

  styleForget(id: number): this {
    this.op1(UiOp.StyleForget, id, 0);
    return this;
  }

  /** id 0 = every element, with libfjs-style's caches dropped. */
  styleRestyle(id: number, subtree: boolean): this {
    this.op1(UiOp.StyleRestyle, id, 1);
    this.buf[this.len++] = subtree ? 1 : 0;
    return this;
  }

  styleRules(table: Uint8Array, append = false): this {
    this.op1(append ? UiOp.StyleRulesAppend : UiOp.StyleRules, table.length, 0);
    this.bytes(table);
    return this;
  }

  /** SEED_CHAIN head: seed, parent seed. The signatures follow through
   * styleSigPart; styleSeedChainEnd closes it. */
  styleSeedChain(seed: number, parentSeed: number): this {
    this.op1(UiOp.StyleSeedChain, seed, 4);
    this.u32(parentSeed);
    return this;
  }

  /** One signature of a SEED_CHAIN (fjs_style.h `<sig>`); `attrs` only for
   * the chain's own signature (null for the neighbour's). */
  styleSigPart(tag: number, classes: readonly number[], scopes: readonly number[], bits: number, attrs: Array<[number, string]> | null): this {
    this.u32(tag);
    this.u16(classes.length);
    for (let i = 0; i < classes.length; i++) this.u32(classes[i]);
    this.u16(scopes.length);
    for (let i = 0; i < scopes.length; i++) this.u32(scopes[i]);
    this.u32(bits);
    if (attrs !== null) {
      this.u16(attrs.length);
      for (const [name, value] of attrs) {
        this.u32(name);
        this.str(value, true);
      }
    }
    return this;
  }

  styleSeedChainPrev(has: boolean): this {
    this.u8(has ? 1 : 0);
    return this;
  }

  styleSeedChainEnd(match: number): this {
    this.u32(match);
    return this;
  }

  /** SEED_COMPUTE (its JSON is asked for on first use). */
  styleSeedCompute(
    match: number,
    parentResult: number,
    defaultsId: number,
    inlineKey: number,
    rawText: boolean,
    result: number,
    flags: number,
  ): this {
    this.op3(UiOp.StyleSeedCompute, match, parentResult, defaultsId);
    this.u32(inlineKey);
    this.u8(rawText ? 1 : 0);
    this.u32(result);
    this.u32(flags);
    return this;
  }

  /** A reported attribute; null removes it. */
  styleAttr(id: number, name: number, value: string | null): this {
    this.op1(UiOp.StyleAttr, id, 0);
    this.u32(name);
    this.u8(value === null ? 0 : 1);
    this.str(value ?? '', true);
    return this;
  }

  /** Style assignment for a computed style map. The style engine hands the
   * same (immutable) object to every element with an identical computed
   * style, so the map itself crosses the bridge ONCE per frame (DefineStyle)
   * and each element only references it by id (SetStyle, 13 bytes).
   *
   * Both slots are replace, not merge: passing no `activeStyle` clears the
   * pressed variant the peer is holding. That matches the only caller — the
   * renderer's applyStyle only omits it for elements that never matched an
   * `:active` rule.
   */
  setStyle(
    id: number,
    style: Record<string, unknown>,
    activeStyle?: Record<string, unknown> | null,
  ): this {
    if (this.uiOpsVersion < 2) return this.setStyleAsProps(id, style, activeStyle);
    const sid = this.styleId(style);
    const aid = activeStyle ? this.styleId(activeStyle) : 0;
    this.op3(UiOp.SetStyle, id, sid, aid);
    return this;
  }

  /** Interns a style object, emitting its definition the first time the peer
   * needs to know it. Ids come off object identity, so two elements that the
   * style engine collapsed onto one computed style share an id for free. */
  private styleId(style: Record<string, unknown>): number {
    let id = this.styleIds.get(style);
    if (id === undefined) {
      id = this.nextStyleId++;
      this.styleIds.set(style, id);
    }
    if (!this.defined.has(id)) {
      if (this.defined.size >= STYLE_TABLE_MAX) {
        // end the epoch rather than evicting one entry: ops are ordered, so
        // every SetStyle after this is preceded by a fresh DefineStyle
        this.u8(UiOp.ResetStyles);
        this.defined.clear();
      }
      // str() writes the same u32 length + UTF-8 bytes, but straight into
      // the frame for ASCII (nearly every style): utf8Encode's two JS passes
      // and temporary array were most of a cold page's style encoding —
      // there is no TextEncoder on the device engines (specs/144). Caching
      // the bytes per style would not help: an object is defined once per
      // style epoch anyway.
      this.u8(UiOp.DefineStyle);
      this.u32(id);
      this.str(JSON.stringify(style), true);
      this.defined.add(id);
    }
    return id;
  }

  /** Pre-interning encoding: the whole style map inlined into a SetProps for
   * every element. Only reachable against a host too old to decode ops 7-9. */
  private setStyleAsProps(
    id: number,
    style: Record<string, unknown>,
    activeStyle?: Record<string, unknown> | null,
  ): this {
    if (activeStyle !== undefined) {
      return this.writeProps(
        id,
        utf8Encode(JSON.stringify({ style, activeStyle })),
      );
    }
    let json = this.legacyStyleJson.get(style);
    if (json === undefined) {
      json = utf8Encode(JSON.stringify({ style }));
      this.legacyStyleJson.set(style, json);
    }
    return this.writeProps(id, json);
  }

  private legacyStyleJson = new WeakMap<object, Uint8Array>();
  private cachedUiOpsVersion = 0;

  /** Read on first use, not at construction: this writer is a module
   * singleton created when host.ts evaluates, and a test or an offline
   * runner may install `__fjsHost` after that. Cached once resolved. */
  private get uiOpsVersion(): number {
    return this.cachedUiOpsVersion ||
      (this.cachedUiOpsVersion = hostUiOpsVersion());
  }

  /** Object identity -> id. A WeakMap so a style the engine has dropped stops
   * pinning its id; `nextStyleId` never rewinds, which keeps a misordered or
   * truncated frame diagnosable instead of silently aliasing two styles. */
  private styleIds = new WeakMap<object, number>();
  /** Ids the peer currently holds definitions for. */
  private defined = new Set<number>();
  private nextStyleId = 1;

  /** Drops the peer's style directory, so the next use of every style
   * re-sends its definition. The host calls this when it starts recording
   * frames: a frame log has to be self-contained, and definitions emitted
   * before recording began are not in it.
   */
  forgetStyles(): void {
    if (this.defined.size === 0) return;
    this.defined.clear();
    this.u8(UiOp.ResetStyles);
  }

  /** SetProps from JSON already encoded as UTF-8 — for props written the
   * same way on many nodes (element.ts setConstProps): one buffer copy
   * instead of re-walking the string per node. */
  setPropsEncoded(id: number, json: Uint8Array): this {
    return this.writeProps(id, json);
  }

  private writeProps(id: number, json: Uint8Array): this {
    this.u8(UiOp.SetProps);
    this.u32(id);
    this.u32(json.length);
    this.bytes(json);
    return this;
  }

  get isEmpty(): boolean {
    return this.len === 0;
  }

  reset(): void {
    this.len = 0;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
