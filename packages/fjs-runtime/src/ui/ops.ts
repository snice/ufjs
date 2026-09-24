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
    this.u8(UiOp.Create);
    this.u32(id);
    let encoded = this.tagBytes.get(tag);
    if (encoded === undefined) {
      encoded = utf8Encode(tag);
      this.tagBytes.set(tag, encoded);
    }
    this.u16(encoded.length);
    this.bytes(encoded);
    return this;
  }

  remove(id: number): this {
    this.u8(UiOp.Remove);
    this.u32(id);
    return this;
  }

  insert(parent: number, child: number, index: number): this {
    this.u8(UiOp.Insert);
    this.u32(parent);
    this.u32(child);
    this.u32(index);
    return this;
  }

  removeChild(parent: number, child: number): this {
    this.u8(UiOp.RemoveChild);
    this.u32(parent);
    this.u32(child);
    return this;
  }

  setText(id: number, text: string): this {
    this.u8(UiOp.SetText);
    this.u32(id);
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
    this.u8(UiOp.SetStyle);
    this.u32(id);
    this.u32(sid);
    this.u32(aid);
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
      const json = utf8Encode(JSON.stringify(style));
      this.u8(UiOp.DefineStyle);
      this.u32(id);
      this.u32(json.length);
      this.bytes(json);
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
