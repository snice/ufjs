// Binary UI op protocol shared between fjs-runtime (TypeScript) and this
// decoder. Frames arrive from JS via __fjs.fns.uiOps(Uint8Array); one call
// is one frame = a batch of back-to-back ops (little-endian).
//
//  op 1 CREATE        u32 id, u16 tagLen, utf8 tag
//  op 2 REMOVE        u32 id
//  op 3 INSERT        u32 parent, u32 child, u32 index
//  op 4 REMOVE_CHILD  u32 parent, u32 child
//  op 5 SET_TEXT      u32 id, u32 len, utf8 text
//  op 6 SET_PROPS     u32 id, u32 jsonLen, utf8 JSON
//  op 7 DEFINE_STYLE  u32 styleId, u32 jsonLen, utf8 JSON
//  op 8 SET_STYLE     u32 id, u32 styleId, u32 activeStyleId
//  op 9 RESET_STYLES  (no payload)
//  op 10 CANVAS       u32 id, u32 byteLen, <canvas display list bytes>
//  op 11 WEBGL        u32 id, u32 byteLen, <webgl command stream bytes>
//  op 12 SET_HOVER_STYLE u32 id, u32 styleId
//
// Hover style (op 12) is the `:hover` variant slot, keyed exactly like op 8's
// activeStyleId: replace semantics, styleId 0 clears, entry resolved at
// decode time. It is its own op, not a third id inside op 8, because the
// declared protocol version only flows host -> runtime — an old runtime
// paired with a new host would keep writing the 12-byte op 8 while this
// decoder read 16. Hosts declare protocol version 6 to receive it; older
// hosts never see it (the JS side gates on the version and drops there).
//
// Parent id 0 refers to the implicit root container owned by the host.
//
// Canvas (op 10) carries one node's new drawing commands for the frame, in
// the compact binary the JS side's canvas/display-list.ts writes and
// canvas/canvas_ops.dart decodes. Unlike props, commands APPEND: a canvas is
// retained, so the node keeps the list until a full-canvas clearRect
// truncates it (see canvas/display_list.dart). Hosts declare protocol
// version 3 to receive it; an older host is told once by the JS side and the
// commands are dropped there.
//
// WebGL (op 11) carries one node's GL command stream, written by
// canvas/webgl/protocol.ts and decoded by canvas/webgl_replay.dart. Unlike
// op 10 these are EXECUTED, not retained: each chunk runs into the node's
// GL framebuffer as it arrives (flutter_angle), then the texture is marked
// for display. Hosts declare protocol version 5 to receive it; older hosts
// get the same drop-with-one-warning treatment as op 10.
//
// Props (op 6) is a flat JSON object, merged into whatever the node already
// has; a null value removes the key. See docs/ui-api.md for the property
// reference.
//
// Styles are interned (ops 7-9). The style engine hands one immutable
// computed-style object to every element that resolved to the same style, so
// the map crosses once as DEFINE_STYLE and each element costs 13 bytes of
// SET_STYLE. Both style slots are REPLACE, not merge; `styleId` 0 clears the
// slot. Rules:
//
//   * a style's DEFINE_STYLE precedes every SET_STYLE that references it
//   * ids are monotonic and are not reused within an epoch
//   * RESET_STYLES ends an epoch and drops the directory
//
// Dropping the directory is safe because SET_STYLE is resolved at decode time
// and the node holds the resolved style itself — a directory entry going away
// never leaves a node pointing at nothing. A SET_STYLE naming an id this
// decoder has never seen (a frame log replayed from mid-session) leaves the
// node's current style alone rather than throwing.
//
// The same opcodes are switched on in three places, with no generator to keep
// them honest: fjs-runtime's ui/ops.ts, this decoder, and the frame dump in
// native/tools/fjsrun.cpp. They must move together.
//
// Opcodes 0x40 and up are reserved for the native style engine's input ops
// (specs/150): libfjs-style consumes them inside uiOps and they never reach
// this decoder.
abstract final class UiOpCode {
  static const create = 1;
  static const remove = 2;
  static const insert = 3;
  static const removeChild = 4;
  static const setText = 5;
  static const setProps = 6;
  static const defineStyle = 7;
  static const setStyle = 8;
  static const resetStyles = 9;
  static const canvas = 10;
  static const webgl = 11;
  static const hoverStyle = 12;
}
