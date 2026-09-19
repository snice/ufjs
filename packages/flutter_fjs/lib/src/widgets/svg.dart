// Inline `<svg>`: the element and its shape children, painted on one canvas.
//
// Vue creates `<svg>` / `<circle>` / `<path>` … as ordinary nodes, so the
// whole drawing arrives as a mirror subtree: attributes as props, CSS as the
// computed style the JS engine matched (`.van-loading__circular circle
// { stroke: currentColor; stroke-width: 3 }`). The `svg` node owns the
// subtree — its children are never built as widgets; [FjsSvg] walks them
// and paints.
//
// Supported: svg (viewBox, preserveAspectRatio), g, path (every command,
// arcs included), circle, ellipse, rect (rx/ry), line, polyline, polygon;
// fill / stroke / *-opacity / stroke-width / linecap / linejoin /
// miterlimit / dasharray / dashoffset / fill-rule, inherited down the tree
// as SVG does; `currentColor`; `transform` attributes and CSS transforms;
// `@keyframes` on any shape (render/animation.dart). Not supported, and
// skipped: text, use, gradients / patterns (`url(#…)` paints nothing),
// clip paths, masks, filters.
import 'dart:collection' show LinkedHashMap;
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart' show Ticker;

import '../mirror_tree.dart';
import '../render/animation.dart';
import '../render/style_parse.dart';
import 'control_scope.dart' show fjsWarnOnce;

class FjsSvg extends StatefulWidget {
  const FjsSvg({super.key, required this.tree, required this.nodeId});

  final MirrorTree tree;
  final int nodeId;

  @override
  State<FjsSvg> createState() => _FjsSvgState();
}

class _FjsSvgState extends State<FjsSvg> with SingleTickerProviderStateMixin {
  late final Ticker _ticker = createTicker(_onTick);
  final ValueNotifier<Duration> _clock = ValueNotifier(Duration.zero);

  /// When each animated shape's current animation list started, on [_clock].
  final Map<int, (String, Duration)> _starts = {};

  void _onTick(Duration elapsed) => _clock.value = elapsed;

  @override
  void dispose() {
    _ticker.dispose();
    _clock.dispose();
    super.dispose();
  }

  /// Every node under the svg (itself included): the painter reads them all,
  /// so a change to any of them must repaint.
  List<MirrorNode> _subtree() {
    final out = <MirrorNode>[];
    void walk(int id) {
      final n = widget.tree.node(id);
      if (n == null) return;
      out.add(n);
      for (final c in n.children) {
        walk(c);
      }
    }

    walk(widget.nodeId);
    return out;
  }

  Duration _elapsedFor(MirrorNode node, FjsAnimations animations) {
    final start = _starts[node.id];
    if (start == null || start.$1 != animations.signature) {
      _starts[node.id] = (animations.signature, _clock.value);
      return Duration.zero;
    }
    return _clock.value - start.$2;
  }

  @override
  Widget build(BuildContext context) {
    final nodes = _subtree();
    final signals = [for (final n in nodes) widget.tree.listenableFor(n.id)];
    return ListenableBuilder(
      // a structural change (a shape added under a `g`) fires that `g`'s
      // signal; rebuilding here re-collects the subtree and its signals
      listenable: Listenable.merge(signals),
      builder: (context, _) {
        final nodes = _subtree();
        final animated = nodes.any((n) => FjsAnimations.of(n.styleMap) != null);
        if (animated && !_ticker.isActive) _ticker.start();
        if (!animated && _ticker.isActive) _ticker.stop();
        final root = nodes.isEmpty ? null : nodes.first;
        if (root == null) return const SizedBox.shrink();
        final viewBox = _parseViewBox(root.props['viewBox']);
        return LayoutBuilder(
          builder: (context, constraints) {
            final size = _svgSize(root, viewBox, constraints);
            return CustomPaint(
              size: size,
              painter: _SvgPainter(
                tree: widget.tree,
                rootId: widget.nodeId,
                viewBox: viewBox,
                elapsedFor: _elapsedFor,
                repaint: animated ? _clock : null,
              ),
            );
          },
        );
      },
    );
  }
}

/// The svg's box: a tight constraint (a CSS width/height the decoration
/// applied) wins, then the width/height attributes, then the viewBox's
/// aspect ratio, then the browser default 300×150.
Size _svgSize(MirrorNode root, Rect? viewBox, BoxConstraints constraints) {
  final fontSize = _num(root.styleMap['fontSize']) ?? 14;
  double? attr(String key) {
    final v = root.props[key]?.toString().trim();
    if (v == null || v.endsWith('%')) return null;
    if (v.endsWith('em')) {
      final n = double.tryParse(v.substring(0, v.length - 2));
      return n == null ? null : n * fontSize;
    }
    return _num(v);
  }

  var w = constraints.hasTightWidth ? constraints.maxWidth : attr('width');
  var h = constraints.hasTightHeight ? constraints.maxHeight : attr('height');
  final ratio = viewBox != null && viewBox.height > 0
      ? viewBox.width / viewBox.height
      : null;
  if (w == null && h != null && ratio != null) w = h * ratio;
  if (h == null && w != null && ratio != null) h = w / ratio;
  if (w == null && h == null && ratio != null && constraints.hasBoundedWidth) {
    w = constraints.maxWidth;
    h = w / ratio;
  }
  return constraints.constrain(Size(w ?? 300, h ?? 150));
}

Rect? _parseViewBox(Object? value) {
  if (value == null) return null;
  final n = _numbers(value.toString());
  if (n.length != 4 || n[2] <= 0 || n[3] <= 0) return null;
  return Rect.fromLTWH(n[0], n[1], n[2], n[3]);
}

/// The viewBox → viewport mapping of `preserveAspectRatio`.
Matrix4 _viewBoxTransform(Rect viewBox, Size size, Object? preserve) {
  final text = (preserve?.toString() ?? 'xMidYMid meet').trim();
  final sx = size.width / viewBox.width;
  final sy = size.height / viewBox.height;
  if (text.startsWith('none')) {
    return Matrix4.diagonal3Values(sx, sy, 1)
      ..translateByDouble(-viewBox.left, -viewBox.top, 0, 1);
  }
  final slice = text.contains('slice');
  final s = slice ? math.max(sx, sy) : math.min(sx, sy);
  final align = text.split(RegExp(r'\s+')).first;
  double factor(String axis) {
    if (align.contains('${axis}Min')) return 0;
    if (align.contains('${axis}Max')) return 1;
    return 0.5;
  }

  final dx = (size.width - viewBox.width * s) * factor('x');
  final dy = (size.height - viewBox.height * s) * factor('Y');
  return Matrix4.translationValues(dx, dy, 0)
    ..scaleByDouble(s, s, 1, 1)
    ..translateByDouble(-viewBox.left, -viewBox.top, 0, 1);
}

/// Inherited painting state, SVG's property inheritance.
class _Paint {
  const _Paint({
    this.fill = 'black',
    this.stroke = 'none',
    this.strokeWidth = 1,
    this.cap = StrokeCap.butt,
    this.join = StrokeJoin.miter,
    this.miter = 4,
    this.fillOpacity = 1,
    this.strokeOpacity = 1,
    this.evenOdd = false,
    this.dashes = const [],
    this.dashOffset = 0,
  });

  final Object fill;
  final Object stroke;
  final double strokeWidth;
  final StrokeCap cap;
  final StrokeJoin join;
  final double miter;
  final double fillOpacity;
  final double strokeOpacity;
  final bool evenOdd;
  final List<double> dashes;
  final double dashOffset;
}

class _SvgPainter extends CustomPainter {
  _SvgPainter({
    required this.tree,
    required this.rootId,
    required this.viewBox,
    required this.elapsedFor,
    Listenable? repaint,
  }) : super(repaint: repaint);

  final MirrorTree tree;
  final int rootId;
  final Rect? viewBox;
  final Duration Function(MirrorNode, FjsAnimations) elapsedFor;

  @override
  void paint(Canvas canvas, Size size) {
    final root = tree.node(rootId);
    if (root == null) return;
    canvas.save();
    canvas.clipRect(Offset.zero & size);
    final vb = viewBox;
    if (vb != null) {
      canvas.transform(
        _viewBoxTransform(vb, size, root.props['preserveAspectRatio']).storage,
      );
    }
    final ref = vb?.size ?? size;
    _paintNode(canvas, root, const _Paint(), ref, isRoot: true);
    canvas.restore();
  }

  void _paintNode(
    Canvas canvas,
    MirrorNode node,
    _Paint inherited,
    Size ref, {
    bool isRoot = false,
  }) {
    final tag = node.tag;
    if (_skipped.contains(tag)) return;
    if (!isRoot && !_shapes.contains(tag) && !_groups.contains(tag)) {
      fjsWarnOnce('svg-tag-$tag', '[fjs svg] <$tag> is not supported, skipped');
      return;
    }
    final style = node.styleMap;
    if (style['display']?.toString() == 'none') return;
    if (style['visibility']?.toString() == 'hidden') return;
    final animations = FjsAnimations.of(style);
    final animated = animations == null
        ? const <String, Object?>{}
        : animations.sample(
            elapsedFor(node, animations),
            (p) => style[p] ?? node.props[p],
          );
    // CSS beats the presentation attribute; a running animation beats both
    Object? read(String key) => animated[key] ?? style[key] ?? node.props[key];

    final paint = _resolvePaint(inherited, read, style['color']);
    final opacity = (_num(read('opacity')) ?? 1).clamp(0.0, 1.0);
    if (opacity == 0) return;

    canvas.save();
    if (!isRoot) {
      final attrTransform = node.props['transform'];
      if (attrTransform != null) {
        canvas.transform(parseSvgTransform(attrTransform.toString()).storage);
      }
    }
    // a CSS transform on an svg element has its origin at (0, 0)
    final cssTransform = animated['transform'];
    if (cssTransform is FjsAnimatedTransform) {
      canvas.transform(cssTransform.matrix.storage);
    } else if (!isRoot && style['transform'] != null) {
      final m = parseTransform(style['transform']);
      if (m != null) canvas.transform(m.storage);
    }
    if (opacity < 1) {
      canvas.saveLayer(
        null,
        Paint()..color = Color.fromRGBO(0, 0, 0, opacity),
      );
    }

    if (_shapes.contains(tag)) {
      final path = _shapePath(tag, read, ref);
      if (path != null) _paintShape(canvas, path, paint);
    } else {
      for (final id in node.children) {
        final child = tree.node(id);
        if (child != null) _paintNode(canvas, child, paint, ref);
      }
    }
    if (opacity < 1) canvas.restore();
    canvas.restore();
  }

  _Paint _resolvePaint(
    _Paint p,
    Object? Function(String) read,
    Object? color,
  ) {
    Object paintValue(Object? v, Object fallback) {
      if (v == null) return fallback;
      if (v is Color) return v;
      final s = v.toString().trim();
      if (s == 'inherit' || s.isEmpty) return fallback;
      if (s.toLowerCase() == 'currentcolor') return parseColor(color) ?? const Color(0xFF000000);
      return s;
    }

    final cap = read('strokeLinecap')?.toString();
    final join = read('strokeLinejoin')?.toString();
    final dashes = read('strokeDasharray');
    return _Paint(
      fill: paintValue(read('fill'), p.fill),
      stroke: paintValue(read('stroke'), p.stroke),
      strokeWidth: _num(read('strokeWidth')) ?? p.strokeWidth,
      cap: switch (cap) {
        'round' => StrokeCap.round,
        'square' => StrokeCap.square,
        'butt' => StrokeCap.butt,
        _ => p.cap,
      },
      join: switch (join) {
        'round' => StrokeJoin.round,
        'bevel' => StrokeJoin.bevel,
        'miter' => StrokeJoin.miter,
        _ => p.join,
      },
      miter: _num(read('strokeMiterlimit')) ?? p.miter,
      fillOpacity: _num(read('fillOpacity')) ?? p.fillOpacity,
      strokeOpacity: _num(read('strokeOpacity')) ?? p.strokeOpacity,
      evenOdd: switch (read('fillRule')?.toString()) {
        'evenodd' => true,
        'nonzero' => false,
        _ => p.evenOdd,
      },
      dashes: dashes == null ? p.dashes : (parseNumberList(dashes) ?? p.dashes),
      dashOffset: _num(read('strokeDashoffset')) ?? p.dashOffset,
    );
  }

  void _paintShape(Canvas canvas, Path path, _Paint p) {
    final fill = _color(p.fill, p.fillOpacity);
    if (fill != null) {
      path.fillType = p.evenOdd ? PathFillType.evenOdd : PathFillType.nonZero;
      canvas.drawPath(path, Paint()..color = fill);
    }
    final stroke = _color(p.stroke, p.strokeOpacity);
    if (stroke != null && p.strokeWidth > 0) {
      canvas.drawPath(
        dashSvgPath(path, p.dashes, p.dashOffset),
        Paint()
          ..style = PaintingStyle.stroke
          ..color = stroke
          ..strokeWidth = p.strokeWidth
          ..strokeCap = p.cap
          ..strokeJoin = p.join
          ..strokeMiterLimit = p.miter,
      );
    }
  }

  Color? _color(Object value, double opacity) {
    Color? c;
    if (value is Color) {
      c = value;
    } else {
      final s = value.toString();
      if (s == 'none' || s == 'transparent') return null;
      if (s.startsWith('url(')) {
        fjsWarnOnce('svg-paint-url', '[fjs svg] paint servers (url(#…)) are not supported; painted nothing');
        return null;
      }
      c = parseColor(s);
    }
    if (c == null) return null;
    return opacity >= 1 ? c : c.withValues(alpha: c.a * opacity.clamp(0.0, 1.0));
  }

  @override
  bool shouldRepaint(covariant _SvgPainter old) => true;
}

const _shapes = {'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'};
const _groups = {'g', 'svg', 'a'};
const _skipped = {
  'defs', 'title', 'desc', 'metadata', 'style', 'symbol', 'clipPath', 'mask',
  'linearGradient', 'radialGradient', 'pattern', 'filter', 'marker',
};

/// A shape element's geometry as a path, in user units. [ref] is the
/// viewport the `%` lengths resolve against.
Path? _shapePath(String tag, Object? Function(String) read, Size ref) {
  double len(String key, double basis) {
    final v = read(key);
    if (v == null) return 0;
    final s = v.toString().trim();
    if (s.endsWith('%')) return (double.tryParse(s.substring(0, s.length - 1)) ?? 0) / 100 * basis;
    return _num(v) ?? 0;
  }

  final w = ref.width, h = ref.height;
  final diag = math.sqrt(w * w + h * h) / math.sqrt2;
  switch (tag) {
    case 'path':
      final d = read('d');
      return d == null ? null : parseSvgPathData(d.toString());
    case 'circle':
      final r = len('r', diag);
      if (r <= 0) return null;
      return _ellipsePath(len('cx', w), len('cy', h), r, r);
    case 'ellipse':
      final rx = len('rx', w), ry = len('ry', h);
      if (rx <= 0 || ry <= 0) return null;
      return _ellipsePath(len('cx', w), len('cy', h), rx, ry);
    case 'rect':
      final rw = len('width', w), rh = len('height', h);
      if (rw <= 0 || rh <= 0) return null;
      final rect = Rect.fromLTWH(len('x', w), len('y', h), rw, rh);
      var rx = read('rx') == null ? null : len('rx', w);
      var ry = read('ry') == null ? null : len('ry', h);
      rx ??= ry ?? 0;
      ry ??= rx;
      if (rx <= 0 && ry <= 0) return Path()..addRect(rect);
      return Path()
        ..addRRect(
          RRect.fromRectAndRadius(
            rect,
            Radius.elliptical(math.min(rx, rw / 2), math.min(ry, rh / 2)),
          ),
        );
    case 'line':
      return Path()
        ..moveTo(len('x1', w), len('y1', h))
        ..lineTo(len('x2', w), len('y2', h));
    case 'polyline':
    case 'polygon':
      final pts = _numbers(read('points')?.toString() ?? '');
      if (pts.length < 4) return null;
      final path = Path()..moveTo(pts[0], pts[1]);
      for (var i = 2; i + 1 < pts.length; i += 2) {
        path.lineTo(pts[i], pts[i + 1]);
      }
      if (tag == 'polygon') path.close();
      return path;
  }
  return null;
}

/// An ellipse starting at its rightmost point and running clockwise — where
/// SVG starts a circle's outline, which is where its dash pattern begins.
Path _ellipsePath(double cx, double cy, double rx, double ry) {
  final rect = Rect.fromLTRB(cx - rx, cy - ry, cx + rx, cy + ry);
  return Path()
    ..moveTo(cx + rx, cy)
    ..arcTo(rect, 0, math.pi, false)
    ..arcTo(rect, math.pi, math.pi, false)
    ..close();
}

/// Applies `stroke-dasharray` / `stroke-dashoffset`: the pattern restarts
/// on every subpath, and a positive offset starts that far into it. An odd
/// list repeats once to become even, as SVG specifies.
Path dashSvgPath(Path source, List<double> dashes, double offset) {
  if (dashes.isEmpty || dashes.any((d) => d < 0)) return source;
  final pattern = dashes.length.isOdd ? [...dashes, ...dashes] : dashes;
  final total = pattern.fold<double>(0, (a, b) => a + b);
  if (total <= 0) return source;
  final out = Path();
  for (final metric in source.computeMetrics()) {
    var pos = offset % total;
    if (pos < 0) pos += total;
    var i = 0;
    while (pos >= pattern[i]) {
      pos -= pattern[i];
      i = (i + 1) % pattern.length;
    }
    var remaining = pattern[i] - pos;
    var distance = 0.0;
    var guard = 0;
    while (distance < metric.length && guard++ < 100000) {
      final end = math.min(distance + remaining, metric.length);
      if (i.isEven && end > distance) {
        out.addPath(metric.extractPath(distance, end), Offset.zero);
      }
      distance = end;
      i = (i + 1) % pattern.length;
      remaining = pattern[i];
    }
  }
  return out;
}

// ---- parsing -----------------------------------------------------------------

double? _num(Object? v) {
  if (v is num) return v.toDouble();
  if (v == null) return null;
  var s = v.toString().trim();
  if (s.endsWith('px')) s = s.substring(0, s.length - 2);
  return double.tryParse(s);
}

final RegExp _numberPattern = RegExp(r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?');

List<double> _numbers(String text) => [
  for (final m in _numberPattern.allMatches(text)) double.parse(m.group(0)!),
];

/// The SVG `transform` attribute: matrix / translate / scale / rotate (with
/// an optional centre) / skewX / skewY, whitespace or comma separated,
/// composed left to right.
Matrix4 parseSvgTransform(String text) {
  final m = Matrix4.identity();
  for (final match in RegExp(r'([a-zA-Z]+)\s*\(([^)]*)\)').allMatches(text)) {
    final a = _numbers(match.group(2)!);
    switch (match.group(1)) {
      case 'matrix' when a.length == 6:
        m.multiply(Matrix4(a[0], a[1], 0, 0, a[2], a[3], 0, 0, 0, 0, 1, 0, a[4], a[5], 0, 1));
      case 'translate' when a.isNotEmpty:
        m.multiply(Matrix4.translationValues(a[0], a.length > 1 ? a[1] : 0, 0));
      case 'scale' when a.isNotEmpty:
        m.multiply(Matrix4.diagonal3Values(a[0], a.length > 1 ? a[1] : a[0], 1));
      case 'rotate' when a.isNotEmpty:
        final angle = a[0] * math.pi / 180;
        if (a.length >= 3) {
          m
            ..multiply(Matrix4.translationValues(a[1], a[2], 0))
            ..multiply(Matrix4.rotationZ(angle))
            ..multiply(Matrix4.translationValues(-a[1], -a[2], 0));
        } else {
          m.multiply(Matrix4.rotationZ(angle));
        }
      case 'skewX' when a.isNotEmpty:
        m.multiply(Matrix4.skewX(a[0] * math.pi / 180));
      case 'skewY' when a.isNotEmpty:
        m.multiply(Matrix4.skewY(a[0] * math.pi / 180));
    }
  }
  return m;
}

final LinkedHashMap<String, Path> _pathCache = LinkedHashMap();

/// Path data (`d`) to a [Path]. Memoized — icon sets repeat the same few
/// strings, and an animated svg repaints every frame.
Path parseSvgPathData(String d) {
  final hit = _pathCache.remove(d);
  if (hit != null) {
    _pathCache[d] = hit;
    return hit;
  }
  final path = _PathParser(d).parse();
  _pathCache[d] = path;
  if (_pathCache.length > 256) _pathCache.remove(_pathCache.keys.first);
  return path;
}

const _commands = 'MmLlHhVvCcSsQqTtAaZz';

class _PathParser {
  _PathParser(this.s);

  final String s;
  int i = 0;

  void _skip() {
    while (i < s.length) {
      final c = s.codeUnitAt(i);
      // whitespace and commas separate everything
      if (c == 0x20 || c == 0x2C || c == 0x09 || c == 0x0A || c == 0x0D) {
        i++;
      } else {
        break;
      }
    }
  }

  bool get _atNumber {
    _skip();
    if (i >= s.length) return false;
    final c = s[i];
    return '0123456789.-+'.contains(c);
  }

  double _number() {
    _skip();
    final m = _numberPattern.matchAsPrefix(s, i);
    if (m == null) throw FormatException('number expected', s, i);
    i = m.end;
    return double.parse(m.group(0)!);
  }

  /// Arc flags are single characters and may run together (`a1 1 0 01 1 1`).
  bool _flag() {
    _skip();
    if (i >= s.length) throw FormatException('flag expected', s, i);
    final c = s[i++];
    if (c != '0' && c != '1') throw FormatException('flag expected', s, i - 1);
    return c == '1';
  }

  Path parse() {
    final path = Path();
    var x = 0.0, y = 0.0; // current point
    var sx = 0.0, sy = 0.0; // subpath start
    double? cx, cy; // last cubic control (S)
    double? qx, qy; // last quadratic control (T)
    String? cmd;
    try {
      while (true) {
        _skip();
        if (i >= s.length) break;
        final c = s[i];
        if (_commands.contains(c)) {
          cmd = c;
          i++;
        } else if (cmd == null) {
          break; // data must open with a command
        }
        final rel = cmd.toLowerCase() == cmd && cmd != 'z';
        final ox = rel ? x : 0.0, oy = rel ? y : 0.0;
        var keepCubic = false, keepQuad = false;
        switch (cmd.toUpperCase()) {
          case 'M':
            x = ox + _number();
            y = oy + _number();
            path.moveTo(x, y);
            sx = x;
            sy = y;
            // further pairs are implicit lineto
            cmd = rel ? 'l' : 'L';
          case 'L':
            x = ox + _number();
            y = oy + _number();
            path.lineTo(x, y);
          case 'H':
            x = ox + _number();
            path.lineTo(x, y);
          case 'V':
            y = oy + _number();
            path.lineTo(x, y);
          case 'C':
            final x1 = ox + _number(), y1 = oy + _number();
            final x2 = ox + _number(), y2 = oy + _number();
            x = ox + _number();
            y = oy + _number();
            path.cubicTo(x1, y1, x2, y2, x, y);
            cx = x2;
            cy = y2;
            keepCubic = true;
          case 'S':
            final x1 = cx == null ? x : 2 * x - cx;
            final y1 = cy == null ? y : 2 * y - cy;
            final x2 = ox + _number(), y2 = oy + _number();
            x = ox + _number();
            y = oy + _number();
            path.cubicTo(x1, y1, x2, y2, x, y);
            cx = x2;
            cy = y2;
            keepCubic = true;
          case 'Q':
            final x1 = ox + _number(), y1 = oy + _number();
            x = ox + _number();
            y = oy + _number();
            path.quadraticBezierTo(x1, y1, x, y);
            qx = x1;
            qy = y1;
            keepQuad = true;
          case 'T':
            final x1 = qx == null ? x : 2 * x - qx;
            final y1 = qy == null ? y : 2 * y - qy;
            x = ox + _number();
            y = oy + _number();
            path.quadraticBezierTo(x1, y1, x, y);
            qx = x1;
            qy = y1;
            keepQuad = true;
          case 'A':
            final rx = _number().abs(), ry = _number().abs();
            final rotation = _number();
            final large = _flag(), sweep = _flag();
            x = ox + _number();
            y = oy + _number();
            if (rx == 0 || ry == 0) {
              path.lineTo(x, y);
            } else {
              path.arcToPoint(
                Offset(x, y),
                radius: Radius.elliptical(rx, ry),
                rotation: rotation,
                largeArc: large,
                clockwise: sweep,
              );
            }
          case 'Z':
            path.close();
            x = sx;
            y = sy;
        }
        if (!keepCubic) cx = cy = null;
        if (!keepQuad) qx = qy = null;
        // a command letter followed by no numbers (Z) must not loop forever
        if (cmd.toUpperCase() == 'Z' && !_atNumber) continue;
        if (cmd.toUpperCase() == 'Z') break;
      }
    } on FormatException {
      // SVG renders the path up to the first error
    }
    return path;
  }
}
