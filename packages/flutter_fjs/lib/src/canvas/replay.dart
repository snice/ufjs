// Replaying a canvas display list onto a Flutter Canvas.
//
// This file is the half of the 2D context that could not stay in JS: turning
// resolved commands into pixels. It holds no policy — every default, every
// save/restore decision and every dedup already happened on the JS side
// (canvas/context-2d.ts). What it does hold is the mapping from the DOM's
// drawing model to Flutter's, and that mapping has three places where the
// two models genuinely differ:
//
//   * SHADOWS. The DOM's shadow is a blurred, offset copy of the shape.
//     Flutter has no shadow property on Paint, so a shadowed draw is done
//     twice: once translated with a blurred paint, once normally. That is
//     what the browser does internally too, but it means a shadowed shape
//     costs two draws, which is why the shadow pass is skipped the moment
//     the shadow colour is transparent.
//   * COMPOSITING. `globalCompositeOperation` other than source-over is
//     defined against the whole canvas, not against the shape being drawn,
//     so those modes are wrapped in a saveLayer. Without the layer,
//     destination-out (say) would erase the layer Flutter happens to be
//     recording into, which may be the whole page.
//   * TEXT ORIGIN. The DOM positions text by a baseline and an alignment;
//     Flutter positions a laid-out paragraph by its top-left. The offset is
//     computed here from the paragraph's metrics.
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';

import '../render/style_parse.dart' show parseColor;
import 'canvas_ops.dart';
import 'images.dart';

/// Mutable 2D state, mirroring the JS context's. Only the fields the host
/// needs to build a Paint live here; the rest never crosses.
class _State {
  Color fillColor = const Color(0xFF000000);
  Object? fillShaderSource; // gradient/pattern handle definition
  Color strokeColor = const Color(0xFF000000);
  Object? strokeShaderSource;
  double lineWidth = 1;
  StrokeCap lineCap = StrokeCap.butt;
  StrokeJoin lineJoin = StrokeJoin.miter;
  double miterLimit = 10;
  List<double> lineDash = const [];
  double lineDashOffset = 0;
  double globalAlpha = 1;
  int composite = 0;
  String fontFamily = 'sans-serif';
  double fontSize = 10;
  int fontWeight = 400;
  bool fontItalic = false;
  int textAlign = 0;
  int textBaseline = 3;
  Color shadowColor = const Color(0x00000000);
  double shadowBlur = 0;
  double shadowOffsetX = 0;
  double shadowOffsetY = 0;

  /// The absolute transform the JS side last set, tracked because Flutter's
  /// Canvas can only MULTIPLY: `setTransform` has to be expressed as a delta
  /// against whatever is already applied.
  ///
  /// It lives in the saved state, not beside it. A `restore()` puts the
  /// canvas's transform back, so a tracker that stayed behind would compute
  /// every later delta against a matrix the canvas no longer has — and the
  /// drawing lands somewhere else entirely. That is not theoretical: ECharts
  /// draws each frame as `clip → series → restore → legend`, and with the
  /// tracker outside the state the legend was transformed off the canvas and
  /// vanished the moment anything re-rendered.
  Float64List applied = Matrix4identity();

  _State clone() => _State()
    ..applied = Float64List.fromList(applied)
    ..fillColor = fillColor
    ..fillShaderSource = fillShaderSource
    ..strokeColor = strokeColor
    ..strokeShaderSource = strokeShaderSource
    ..lineWidth = lineWidth
    ..lineCap = lineCap
    ..lineJoin = lineJoin
    ..miterLimit = miterLimit
    ..lineDash = lineDash
    ..lineDashOffset = lineDashOffset
    ..globalAlpha = globalAlpha
    ..composite = composite
    ..fontFamily = fontFamily
    ..fontSize = fontSize
    ..fontWeight = fontWeight
    ..fontItalic = fontItalic
    ..textAlign = textAlign
    ..textBaseline = textBaseline
    ..shadowColor = shadowColor
    ..shadowBlur = shadowBlur
    ..shadowOffsetX = shadowOffsetX
    ..shadowOffsetY = shadowOffsetY;
}

/// A gradient definition, kept until something paints with it.
class _GradientDef {
  _GradientDef(this.radial, this.geometry, this.offsets, this.colors);
  final bool radial;
  final List<double> geometry;
  final List<double> offsets;
  final List<Color> colors;
}

class _PatternDef {
  _PatternDef(this.imageHandle, this.repeat);
  final int imageHandle;
  final int repeat;
}

/// BlendModes in the order canvas/context-2d.ts numbers the composite
/// operations. Index is the wire value.
const List<BlendMode> _blendModes = [
  BlendMode.srcOver,
  BlendMode.srcIn,
  BlendMode.srcOut,
  BlendMode.srcATop,
  BlendMode.dstOver,
  BlendMode.dstIn,
  BlendMode.dstOut,
  BlendMode.dstATop,
  BlendMode.plus, // 'lighter'
  BlendMode.src, // 'copy'
  BlendMode.xor,
  BlendMode.multiply,
  BlendMode.screen,
  BlendMode.overlay,
  BlendMode.darken,
  BlendMode.lighten,
  BlendMode.colorDodge,
  BlendMode.colorBurn,
  BlendMode.hardLight,
  BlendMode.softLight,
  BlendMode.difference,
  BlendMode.exclusion,
  BlendMode.hue,
  BlendMode.saturation,
  BlendMode.color,
  BlendMode.luminosity,
];

/// Replays chunks onto [canvas]. One instance per paint; nothing survives a
/// frame except the caches held by [FjsCanvasImages] and the text painter
/// cache below, which are keyed by content and safe to share.
class CanvasReplay {
  CanvasReplay(this.canvas, this.size);

  final Canvas canvas;
  final Size size;

  _State _state = _State();
  final List<_State> _stack = [];
  final Map<int, _GradientDef> _gradients = {};
  final Map<int, _PatternDef> _patterns = {};

  void run(List<Uint8List> chunks) {
    for (final chunk in chunks) {
      _runChunk(chunk);
    }
    // A chunk can leave saves unbalanced (a page may save() in one frame and
    // restore() in the next); unwind so the painter hands the canvas back in
    // the state it borrowed it in.
    while (_stack.isNotEmpty) {
      canvas.restore();
      _state = _stack.removeLast();
    }
  }

  void _runChunk(Uint8List chunk) {
    final r = CanvasChunkReader(chunk);
    while (!r.done) {
      final cmd = r.u8();
      switch (cmd) {
        case CanvasCmd.strDef:
          r.readStrDef();
        case CanvasCmd.clearAll:
          // truncation marker; the retained list already dropped what came
          // before it, and there is nothing to paint for the marker itself
          break;
        case CanvasCmd.needsLayer:
          // read by the display list before the replay starts (it decides
          // whether the painter opens a layer); nothing to paint here
          break;
        case CanvasCmd.save:
          _stack.add(_state.clone());
          canvas.save();
        case CanvasCmd.restore:
          if (_stack.isNotEmpty) {
            _state = _stack.removeLast();
            canvas.restore();
          }
        case CanvasCmd.transform:
          canvas.transform(_matrix(r));
        case CanvasCmd.setTransform:
          // the DOM's setTransform replaces the transform; Flutter can only
          // multiply, so the current one is undone by restoring to the last
          // save point is not available here — instead the JS side is the
          // one that knows the absolute matrix, and this host applies it
          // relative to the widget's own origin by resetting through the
          // inverse of what it has applied so far
          _applyAbsoluteTransform(r);
        case CanvasCmd.resetTransform:
          _resetTransform();
        case CanvasCmd.setFillColor:
          _state.fillColor = _color(r.str());
          _state.fillShaderSource = null;
        case CanvasCmd.setFillHandle:
          _state.fillShaderSource = _shaderSource(r.u32());
        case CanvasCmd.setStrokeColor:
          _state.strokeColor = _color(r.str());
          _state.strokeShaderSource = null;
        case CanvasCmd.setStrokeHandle:
          _state.strokeShaderSource = _shaderSource(r.u32());
        case CanvasCmd.setLineWidth:
          _state.lineWidth = r.f32();
        case CanvasCmd.setLineCap:
          _state.lineCap = StrokeCap.values[r.u8().clamp(0, 2)];
        case CanvasCmd.setLineJoin:
          _state.lineJoin = _joins[r.u8().clamp(0, 2)];
        case CanvasCmd.setMiterLimit:
          _state.miterLimit = r.f32();
        case CanvasCmd.setLineDash:
          final count = r.u8();
          _state.lineDash = [for (var i = 0; i < count; i++) r.f32()];
        case CanvasCmd.setLineDashOffset:
          _state.lineDashOffset = r.f32();
        case CanvasCmd.setGlobalAlpha:
          _state.globalAlpha = r.f32();
        case CanvasCmd.setComposite:
          _state.composite = r.u8();
        case CanvasCmd.setFont:
          _state.fontFamily = r.str();
          _state.fontSize = r.f32();
          _state.fontWeight = r.u16();
          _state.fontItalic = r.u8() == 1;
        case CanvasCmd.setTextAlign:
          _state.textAlign = r.u8();
        case CanvasCmd.setTextBaseline:
          _state.textBaseline = r.u8();
        case CanvasCmd.setShadow:
          _state.shadowColor = _color(r.str());
          _state.shadowBlur = r.f32();
          _state.shadowOffsetX = r.f32();
          _state.shadowOffsetY = r.f32();
        case CanvasCmd.clearRect:
          final rect = _rect(r);
          canvas.drawRect(rect, Paint()..blendMode = BlendMode.clear);
        case CanvasCmd.fillRect:
          final rect = _rect(r);
          _draw((paint) => canvas.drawRect(rect, paint), fill: true);
        case CanvasCmd.strokeRect:
          final rect = _rect(r);
          _draw((paint) => canvas.drawRect(rect, paint), fill: false);
        case CanvasCmd.fillPath:
          final rule = r.u8();
          final path = _path(r, rule == 1);
          _draw((paint) => canvas.drawPath(path, paint), fill: true);
        case CanvasCmd.strokePath:
          final path = _path(r, false);
          _draw((paint) => canvas.drawPath(path, paint), fill: false);
        case CanvasCmd.clipPath:
          final rule = r.u8();
          canvas.clipPath(_path(r, rule == 1));
        case CanvasCmd.fillText:
          _text(r, fill: true);
        case CanvasCmd.strokeText:
          _text(r, fill: false);
        case CanvasCmd.drawImage:
          _drawImage(r);
        case CanvasCmd.reset:
          _state = _State();
        case CanvasCmd.defLinearGradient:
          _readGradient(r, radial: false);
        case CanvasCmd.defRadialGradient:
          _readGradient(r, radial: true);
        case CanvasCmd.defPattern:
          final handle = r.u32();
          _patterns[handle] = _PatternDef(r.u32(), r.u8());
        default:
          throw CanvasOpException(
            'unknown canvas command 0x${cmd.toRadixString(16)} at offset '
            '${r.offset - 1}',
          );
      }
    }
  }

  static const List<StrokeJoin> _joins = [
    StrokeJoin.miter,
    StrokeJoin.round,
    StrokeJoin.bevel,
  ];

  // ---- transforms --------------------------------------------------------

  Float64List _matrix(CanvasChunkReader r) {
    final a = r.f32();
    final b = r.f32();
    final c = r.f32();
    final d = r.f32();
    final e = r.f32();
    final f = r.f32();
    _state.applied = _multiply(_state.applied, _matrix4(a, b, c, d, e, f));
    return _matrix4(a, b, c, d, e, f);
  }

  void _applyAbsoluteTransform(CanvasChunkReader r) {
    final a = r.f32();
    final b = r.f32();
    final c = r.f32();
    final d = r.f32();
    final e = r.f32();
    final f = r.f32();
    final target = _matrix4(a, b, c, d, e, f);
    final inverse = _invert(_state.applied);
    if (inverse != null) canvas.transform(_multiply(inverse, target));
    _state.applied = target;
  }

  void _resetTransform() {
    final inverse = _invert(_state.applied);
    if (inverse != null) canvas.transform(inverse);
    _state.applied = Matrix4identity();
  }

  // ---- painting ----------------------------------------------------------

  Paint _paint({required bool fill}) {
    final state = _state;
    final paint = Paint()
      ..isAntiAlias = true
      ..style = fill ? PaintingStyle.fill : PaintingStyle.stroke;
    if (!fill) {
      paint
        ..strokeWidth = state.lineWidth
        ..strokeCap = state.lineCap
        ..strokeJoin = state.lineJoin
        ..strokeMiterLimit = state.miterLimit;
    }
    final source = fill ? state.fillShaderSource : state.strokeShaderSource;
    final color = fill ? state.fillColor : state.strokeColor;
    if (source != null) {
      final shader = _shader(source);
      if (shader != null) paint.shader = shader;
    }
    final alpha = state.globalAlpha.clamp(0.0, 1.0);
    paint.color = color.withValues(alpha: (color.a * alpha).clamp(0.0, 1.0));
    if (source != null && alpha < 1) {
      // a shader ignores the paint colour, so global alpha has to be applied
      // as a colour filter instead
      paint.colorFilter = ColorFilter.mode(
        const Color(0xFFFFFFFF).withValues(alpha: alpha),
        BlendMode.modulate,
      );
    }
    return paint;
  }

  /// Runs [drawWith] with the right paint, adding the shadow pass and the
  /// compositing layer when the state asks for them.
  void _draw(void Function(Paint paint) drawWith, {required bool fill}) {
    final state = _state;
    final blend = _blendModes[state.composite.clamp(0, _blendModes.length - 1)];
    final needsLayer = blend != BlendMode.srcOver;
    if (needsLayer) {
      canvas.saveLayer(null, Paint()..blendMode = blend);
    }
    if (state.shadowColor.a > 0 &&
        (state.shadowBlur > 0 ||
            state.shadowOffsetX != 0 ||
            state.shadowOffsetY != 0)) {
      final shadowPaint = _paint(fill: fill)
        ..color = state.shadowColor
        ..shader = null;
      if (state.shadowBlur > 0) {
        // CSS blur radius is roughly two standard deviations
        shadowPaint.maskFilter = MaskFilter.blur(
          BlurStyle.normal,
          state.shadowBlur / 2,
        );
      }
      canvas.save();
      canvas.translate(state.shadowOffsetX, state.shadowOffsetY);
      drawWith(shadowPaint);
      canvas.restore();
    }
    drawWith(_paint(fill: fill));
    if (needsLayer) canvas.restore();
  }

  Rect _rect(CanvasChunkReader r) {
    final x = r.f32();
    final y = r.f32();
    final w = r.f32();
    final h = r.f32();
    return Rect.fromLTWH(x, y, w, h);
  }

  Path _path(CanvasChunkReader r, bool evenOdd) {
    final len = r.u32();
    final bytes = r.sub(len);
    final path = decodePath(bytes);
    path.fillType = evenOdd ? PathFillType.evenOdd : PathFillType.nonZero;
    return _dashed(path);
  }

  /// Applies the dash pattern by walking the path's metrics. Flutter has no
  /// dashed-stroke paint, and a dash pattern is a stroke property, so it has
  /// to become geometry.
  Path _dashed(Path path) {
    final dash = _state.lineDash;
    if (dash.isEmpty) return path;
    final total = dash.fold<double>(0, (sum, v) => sum + v);
    if (total <= 0) return path;
    final out = Path();
    for (final metric in path.computeMetrics()) {
      var distance = -_state.lineDashOffset % total;
      var index = 0;
      var on = true;
      while (distance < metric.length) {
        final step = dash[index % dash.length];
        final next = distance + step;
        if (on && next > 0) {
          out.addPath(
            metric.extractPath(
              math.max(distance, 0),
              math.min(next, metric.length),
            ),
            Offset.zero,
          );
        }
        distance = next;
        index++;
        on = !on;
      }
    }
    return out;
  }

  // ---- text --------------------------------------------------------------

  void _text(CanvasChunkReader r, {required bool fill}) {
    final text = r.str();
    final x = r.f32();
    final y = r.f32();
    final hasMax = r.u8() == 1;
    final maxWidth = r.f32();
    final painter = textPainterFor(
      text: text,
      family: _state.fontFamily,
      size: _state.fontSize,
      weight: _state.fontWeight,
      italic: _state.fontItalic,
      color: fill ? _state.fillColor : _state.strokeColor,
    );
    var dx = x;
    switch (_state.textAlign) {
      case 3: // right
      case 1: // end (LTR)
        dx -= painter.width;
      case 4: // center
        dx -= painter.width / 2;
      default: // start / left
        break;
    }
    var dy = y;
    switch (_state.textBaseline) {
      case 0: // top
      case 1: // hanging
        break;
      case 2: // middle
        dy -= painter.height / 2;
      case 5: // bottom
      case 4: // ideographic
        dy -= painter.height;
      default: // alphabetic
        dy -= painter.computeDistanceToActualBaseline(TextBaseline.alphabetic);
    }
    canvas.save();
    if (hasMax && maxWidth > 0 && painter.width > maxWidth) {
      // the DOM condenses the glyphs; scaling the paragraph is the closest
      // Flutter gets without re-shaping per glyph
      canvas.translate(dx, dy);
      canvas.scale(maxWidth / painter.width, 1);
      painter.paint(canvas, Offset.zero);
    } else {
      painter.paint(canvas, Offset(dx, dy));
    }
    canvas.restore();
  }

  // ---- images ------------------------------------------------------------

  void _drawImage(CanvasChunkReader r) {
    final handle = r.u32();
    final form = r.u8();
    final count = form == CanvasDrawImageForm.srcDstRect
        ? 8
        : form == CanvasDrawImageForm.dstRect
        ? 4
        : 2;
    final args = [for (var i = 0; i < count; i++) r.f32()];
    final image = FjsCanvasImages.instance.lookup(handle);
    if (image == null) return; // still decoding; the page redraws on load
    final paint = _paint(fill: true)..color = const Color(0xFFFFFFFF);
    paint.color = paint.color.withValues(
      alpha: _state.globalAlpha.clamp(0.0, 1.0),
    );
    paint.shader = null;
    switch (form) {
      case CanvasDrawImageForm.dstPoint:
        canvas.drawImage(image, Offset(args[0], args[1]), paint);
      case CanvasDrawImageForm.dstRect:
        canvas.drawImageRect(
          image,
          Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
          Rect.fromLTWH(args[0], args[1], args[2], args[3]),
          paint,
        );
      default:
        canvas.drawImageRect(
          image,
          Rect.fromLTWH(args[0], args[1], args[2], args[3]),
          Rect.fromLTWH(args[4], args[5], args[6], args[7]),
          paint,
        );
    }
  }

  // ---- resources ---------------------------------------------------------

  void _readGradient(CanvasChunkReader r, {required bool radial}) {
    final handle = r.u32();
    final geometry = [for (var i = 0; i < (radial ? 6 : 4); i++) r.f32()];
    final count = r.u8();
    final offsets = <double>[];
    final colors = <Color>[];
    for (var i = 0; i < count; i++) {
      offsets.add(r.f32());
      colors.add(_color(r.str()));
    }
    _gradients[handle] = _GradientDef(radial, geometry, offsets, colors);
  }

  Object? _shaderSource(int handle) =>
      _gradients[handle] ?? _patterns[handle] ?? handle;

  Shader? _shader(Object source) {
    if (source is _GradientDef) {
      if (source.colors.isEmpty) return null;
      // one stop is legal in CSS but not in Flutter, which needs at least two
      final offsets = source.colors.length == 1
          ? [0.0, 1.0]
          : source.offsets.map((o) => o.clamp(0.0, 1.0)).toList();
      final colors = source.colors.length == 1
          ? [source.colors.first, source.colors.first]
          : source.colors;
      final g = source.geometry;
      if (source.radial) {
        return ui.Gradient.radial(
          Offset(g[3], g[4]),
          g[5] == 0 ? 0.0001 : g[5],
          colors,
          offsets,
          TileMode.clamp,
        );
      }
      return ui.Gradient.linear(
        Offset(g[0], g[1]),
        Offset(g[2], g[3]),
        colors,
        offsets,
        TileMode.clamp,
      );
    }
    if (source is _PatternDef) {
      final image = FjsCanvasImages.instance.lookup(source.imageHandle);
      if (image == null) return null;
      // repeat(0) tiles both axes, repeat-x(1) only x, repeat-y(2) only y,
      // no-repeat(3) neither
      final x = source.repeat == 2 || source.repeat == 3
          ? TileMode.clamp
          : TileMode.repeated;
      final y = source.repeat == 1 || source.repeat == 3
          ? TileMode.clamp
          : TileMode.repeated;
      return ui.ImageShader(
        image,
        x,
        y,
        Matrix4identity(),
        filterQuality: FilterQuality.low,
      );
    }
    return null;
  }

  Color _color(String css) => parseColor(css) ?? const Color(0xFF000000);
}

// ---- small matrix helpers -------------------------------------------------
//
// A 2D canvas transform is six numbers; Matrix4 is the only shape
// Canvas.transform takes. Hand-rolled rather than pulling in vector_math's
// mutable API so the intent (a 2D affine) stays visible.

Float64List Matrix4identity() {
  final m = Float64List(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

Float64List _matrix4(
  double a,
  double b,
  double c,
  double d,
  double e,
  double f,
) {
  final m = Float64List(16);
  m[0] = a;
  m[1] = b;
  m[4] = c;
  m[5] = d;
  m[10] = 1;
  m[12] = e;
  m[13] = f;
  m[15] = 1;
  return m;
}

Float64List _multiply(Float64List m, Float64List n) {
  // only the 2D affine part is ever non-trivial
  final a = m[0] * n[0] + m[4] * n[1];
  final b = m[1] * n[0] + m[5] * n[1];
  final c = m[0] * n[4] + m[4] * n[5];
  final d = m[1] * n[4] + m[5] * n[5];
  final e = m[0] * n[12] + m[4] * n[13] + m[12];
  final f = m[1] * n[12] + m[5] * n[13] + m[13];
  return _matrix4(a, b, c, d, e, f);
}

Float64List? _invert(Float64List m) {
  final a = m[0], b = m[1], c = m[4], d = m[5], e = m[12], f = m[13];
  final det = a * d - b * c;
  if (det == 0) return null;
  final ia = d / det;
  final ib = -b / det;
  final ic = -c / det;
  final id = a / det;
  return _matrix4(ia, ib, ic, id, -(e * ia + f * ic), -(e * ib + f * id));
}

// ---- path decoding --------------------------------------------------------

Path decodePath(Uint8List bytes) {
  final r = CanvasChunkReader(bytes);
  final path = Path();
  while (!r.done) {
    switch (r.u8()) {
      case CanvasPathCmd.moveTo:
        path.moveTo(r.f32(), r.f32());
      case CanvasPathCmd.lineTo:
        path.lineTo(r.f32(), r.f32());
      case CanvasPathCmd.cubicTo:
        path.cubicTo(r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32());
      case CanvasPathCmd.quadTo:
        path.quadraticBezierTo(r.f32(), r.f32(), r.f32(), r.f32());
      case CanvasPathCmd.arc:
        _arc(path, r);
      case CanvasPathCmd.arcTo:
        _arcTo(path, r);
      case CanvasPathCmd.ellipse:
        _ellipse(path, r);
      case CanvasPathCmd.rect:
        path.addRect(Rect.fromLTWH(r.f32(), r.f32(), r.f32(), r.f32()));
      case CanvasPathCmd.close:
        path.close();
      default:
        throw CanvasOpException(
          'unknown canvas path command at ${r.offset - 1}',
        );
    }
  }
  return path;
}

void _arc(Path path, CanvasChunkReader r) {
  final x = r.f32();
  final y = r.f32();
  final radius = r.f32();
  final start = r.f32();
  final end = r.f32();
  final ccw = r.u8() == 1;
  final sweep = _sweep(start, end, ccw);
  final oval = Rect.fromCircle(center: Offset(x, y), radius: radius);
  if (_isFullTurn(sweep)) {
    // A full turn has to be addOval, not arcTo: Skia treats an arc whose
    // start and end angles coincide as empty, so `ctx.arc(x, y, r, 0,
    // Math.PI * 2)` — the way every page draws a circle — would paint
    // nothing at all.
    path.addOval(oval);
    return;
  }
  path.arcTo(
    oval,
    start,
    sweep,
    // the DOM draws a line from the current point to the arc's start; arcTo
    // with forceMoveTo: false is exactly that
    false,
  );
}

/// Within a hair of a whole circle. The tolerance matters because the
/// coordinates arrive as f32: `Math.PI * 2` does not survive the round trip
/// exactly, so an exact comparison would miss most real circles.
bool _isFullTurn(double sweep) => sweep.abs() >= math.pi * 2 - 1e-4;

void _ellipse(Path path, CanvasChunkReader r) {
  final x = r.f32();
  final y = r.f32();
  final rx = r.f32();
  final ry = r.f32();
  final rotation = r.f32();
  final start = r.f32();
  final end = r.f32();
  final ccw = r.u8() == 1;
  final sweep = _sweep(start, end, ccw);
  if (rotation == 0) {
    final oval = Rect.fromCenter(
      center: Offset(x, y),
      width: rx * 2,
      height: ry * 2,
    );
    if (_isFullTurn(sweep)) {
      path.addOval(oval);
      return;
    }
    path.arcTo(oval, start, sweep, false);
    return;
  }
  // a rotated ellipse is the unrotated one under a transform; adding it as a
  // sub-path keeps the caller's current point intact
  final subOval = Rect.fromCenter(
    center: Offset.zero,
    width: rx * 2,
    height: ry * 2,
  );
  final sub = Path();
  if (_isFullTurn(sweep)) {
    sub.addOval(subOval);
  } else {
    sub.arcTo(subOval, start, sweep, true);
  }
  final m = _multiply(
    _matrix4(1, 0, 0, 1, x, y),
    _matrix4(
      math.cos(rotation),
      math.sin(rotation),
      -math.sin(rotation),
      math.cos(rotation),
      0,
      0,
    ),
  );
  path.addPath(sub, Offset.zero, matrix4: m);
}

double _sweep(double start, double end, bool ccw) {
  var sweep = end - start;
  const tau = math.pi * 2;
  if (ccw) {
    if (sweep > 0) sweep -= tau * (sweep / tau).ceil();
    if (sweep < -tau) sweep = -tau;
  } else {
    if (sweep < 0) sweep += tau * (-sweep / tau).ceil();
    if (sweep > tau) sweep = tau;
  }
  return sweep;
}

bool _warnedArcTo = false;

/// Legacy path command — see [CanvasPathCmd.arcTo].
///
/// The DOM's `arcTo` is a corner fillet: an arc tangent to the segment coming
/// in from the current point and to the one going out towards (x2, y2), ending
/// at the tangent point. Flutter has no fillet, and `arcToPoint` — the SVG arc
/// — ends AT the point it is given, so mapping one onto the other drew an arc
/// across a whole side instead of a corner. The fillet needs the path's
/// current point, which `Path` does not expose, so the runtime computes it and
/// sends `lineTo` + `arc` instead (canvas/path2d.ts).
///
/// A bundle older than that still sends this. Draw the corner as a polyline —
/// wrong by a rounded corner, not by half the shape — and say so once.
void _arcTo(Path path, CanvasChunkReader r) {
  final x1 = r.f32();
  final y1 = r.f32();
  final x2 = r.f32();
  final y2 = r.f32();
  r.f32(); // radius: nothing to round with, the corner stays sharp
  if (!_warnedArcTo) {
    _warnedArcTo = true;
    // ignore: avoid_print
    print(
      '[fjs] <canvas> arcTo() came over the wire, which only a JS runtime '
      'older than the one this host expects does. Corners that should be '
      'rounded are drawn sharp — upgrade @ufjs/runtime.',
    );
  }
  path.lineTo(x1, y1);
  path.lineTo(x2, y2);
}

// ---- text painter cache ---------------------------------------------------
//
// Laying a paragraph out is the single most expensive thing this file does,
// and a chart re-draws the same labels every frame with the same style. The
// cache is keyed by everything that changes the layout.

final Map<String, TextPainter> _textPainters = {};
const int _textPainterMax = 512;

TextPainter textPainterFor({
  required String text,
  required String family,
  required double size,
  required int weight,
  required bool italic,
  required Color color,
}) {
  final key = '$family|$size|$weight|$italic|${color.toARGB32()}|$text';
  final cached = _textPainters[key];
  if (cached != null) return cached;
  final painter = TextPainter(
    text: TextSpan(
      text: text,
      style: TextStyle(
        fontFamily: family,
        fontSize: size,
        fontWeight: FontWeight.values[((weight ~/ 100) - 1).clamp(0, 8)],
        fontStyle: italic ? FontStyle.italic : FontStyle.normal,
        color: color,
      ),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  if (_textPainters.length >= _textPainterMax) _textPainters.clear();
  _textPainters[key] = painter;
  return painter;
}
