// Canvas display-list decoding — the Dart twin of fjs-runtime's
// canvas/display-list.ts. The two files list the same command bytes in the
// same order and must move together; there is no generator keeping them
// honest, the same way ui_ops.dart and ui/ops.ts are kept in step by hand.
//
// A chunk (one op-10 payload) is self-contained: it carries its own string
// table, so it can be replayed on its own and dropped on its own.
//
// Layout: little-endian, `u8 cmd` followed by fixed arguments. Coordinates
// are f32 — canvas coordinates are logical pixels, where f32's precision is
// far finer than any screen, and it halves the cost of the argument-heavy
// commands (a lineTo is 9 bytes instead of 17). Strings are interned per
// chunk and referenced by u16: a chart frame sets fillStyle to the same
// handful of colour strings thousands of times.
import 'dart:convert';
import 'dart:typed_data';

abstract final class CanvasCmd {
  // resources
  static const strDef = 0x01;
  static const defLinearGradient = 0x40;
  static const defRadialGradient = 0x41;
  static const defPattern = 0x42;

  // state
  static const save = 0x10;
  static const restore = 0x11;
  static const transform = 0x12;
  static const setTransform = 0x13;
  static const resetTransform = 0x14;

  static const setFillColor = 0x20;
  static const setFillHandle = 0x21;
  static const setStrokeColor = 0x22;
  static const setStrokeHandle = 0x23;
  static const setLineWidth = 0x24;
  static const setLineCap = 0x25;
  static const setLineJoin = 0x26;
  static const setMiterLimit = 0x27;
  static const setLineDash = 0x28;
  static const setLineDashOffset = 0x29;
  static const setGlobalAlpha = 0x2A;
  static const setComposite = 0x2B;
  static const setFont = 0x2C;
  static const setTextAlign = 0x2D;
  static const setTextBaseline = 0x2E;
  static const setShadow = 0x2F;

  // drawing
  static const clearRect = 0x30;
  static const fillRect = 0x31;
  static const strokeRect = 0x32;
  static const fillPath = 0x33;
  static const strokePath = 0x34;
  static const clipPath = 0x35;
  static const fillText = 0x36;
  static const strokeText = 0x37;
  static const drawImage = 0x38;
  static const reset = 0x39;

  /// Truncation marker. Always the FIRST command of its chunk (the JS writer
  /// splits there), so the host can drop everything older without parsing.
  static const clearAll = 0x3A;

  /// "This canvas erases part of itself." Also only ever at a chunk's head,
  /// so the display list can read it without parsing: the painter has to
  /// open a layer BEFORE the first command, or a clearRect punches a hole
  /// through whatever is under the canvas box. See canvas/display_list.dart.
  static const needsLayer = 0x3B;
}

/// Path sub-stream commands. A path is encoded inline with the fill/stroke/
/// clip that uses it rather than being retained here: the browser's current
/// path is JS-side state, and re-sending it keeps this decoder stateless
/// across chunks — the cost is one duplicate path when a page fills AND
/// strokes the same one.
abstract final class CanvasPathCmd {
  static const moveTo = 1;
  static const lineTo = 2;
  static const cubicTo = 3;
  static const quadTo = 4;
  static const arc = 5;

  /// Legacy: a current JS runtime lowers `arcTo` to lineTo + arc and never
  /// sends this. Kept for bundles older than that (`fjs dev` connects any
  /// bundle to any client), and to keep the numbering stable.
  static const arcTo = 6;
  static const ellipse = 7;
  static const rect = 8;
  static const close = 9;
}

/// drawImage's three argument forms, matching the DOM's overloads.
abstract final class CanvasDrawImageForm {
  static const dstPoint = 3; // dx, dy
  static const dstRect = 5; // dx, dy, dw, dh
  static const srcDstRect = 9; // sx..sh, dx..dh
}

class CanvasOpException implements Exception {
  CanvasOpException(this.message);
  final String message;
  @override
  String toString() => 'CanvasOpException: $message';
}

/// Cursor over one chunk. Bounds-checked: a truncated or misaligned chunk
/// throws rather than painting garbage (constitution V).
class CanvasChunkReader {
  /// Starts a cursor over [bytes] — one canvas chunk as delivered by the
  /// JS side, little-endian throughout.
  CanvasChunkReader(this.bytes) : _data = ByteData.sublistView(bytes), _p = 0;

  /// The chunk being read; [offset] indexes into it.
  final Uint8List bytes;
  final ByteData _data;
  int _p;

  /// Strings defined by this chunk, by id.
  final Map<int, String> strings = {};

  /// True once every byte of the chunk has been read; a [CanvasOpException]
  /// is the alternative for chunks that end mid-command.
  bool get done => _p >= bytes.length;
  int get offset => _p;

  void _need(int n) {
    if (_p + n > bytes.length) {
      throw CanvasOpException(
        'truncated canvas chunk at offset $_p (need $n, have ${bytes.length - _p})',
      );
    }
  }

  int u8() {
    _need(1);
    return bytes[_p++];
  }

  int u16() {
    _need(2);
    final v = _data.getUint16(_p, Endian.little);
    _p += 2;
    return v;
  }

  int u32() {
    _need(4);
    final v = _data.getUint32(_p, Endian.little);
    _p += 4;
    return v;
  }

  /// Signed 32-bit — the wire shape is the same as [u32] (two's complement),
  /// this just reinterprets. Used for the fields the JS writer marks i32.
  int i32() {
    _need(4);
    final v = _data.getInt32(_p, Endian.little);
    _p += 4;
    return v;
  }

  /// IEEE 754 single precision, little-endian — coordinates and sizes the
  /// JS writer did not want to round to fixed-point.
  double f32() {
    _need(4);
    final v = _data.getFloat32(_p, Endian.little);
    _p += 4;
    return v;
  }

  /// Reads a string-table reference. An id this chunk never defined is a
  /// protocol bug on the writer's side, not something to paint around.
  String str() {
    final id = u16();
    final s = strings[id];
    if (s == null) {
      throw CanvasOpException('canvas chunk references undefined string $id');
    }
    return s;
  }

  /// Consumes a STR_DEF, which is the only command this reader interprets on
  /// its own.
  void readStrDef() {
    final id = u16();
    final len = u16();
    _need(len);
    strings[id] = utf8.decode(bytes.sublist(_p, _p + len));
    _p += len;
  }

  /// Same intern, u32 length: the webgl family carries whole shader sources
  /// that exceed the 64 KiB a u16 can express (spec 023). The 2d display
  /// list keeps the u16 form.
  void readStrDef32() {
    final id = u16();
    final len = u32();
    _need(len);
    strings[id] = utf8.decode(bytes.sublist(_p, _p + len));
    _p += len;
  }

  Uint8List sub(int len) {
    _need(len);
    final out = Uint8List.sublistView(bytes, _p, _p + len);
    _p += len;
    return out;
  }
}
