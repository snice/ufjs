// CSS `@keyframes` animations, run on this side.
//
// The JS style engine resolves the cascade and ships, per node, the
// animation longhands plus `animationKeyframes: {name: [{offset, style}]}`
// (fjs-runtime css/animation.ts). Everything time-based happens here: a
// ticker per animated node, no bridge traffic per frame.
//
// Two consumers:
//   * [keyframeNode] wraps any node and applies the animated `transform` /
//     `opacity` — vant's `van-rotate` on the loading spinner, fades, slides;
//   * the svg painter (widgets/svg.dart) samples its shapes' animations for
//     stroke/fill properties — `van-circular` animates stroke dashes.
//
// Semantics follow CSS Animations 1: per-keyframe easing (the timing
// function applies to each segment, and a keyframe may override it),
// implicit 0%/100% frames from the element's own value, iteration count,
// direction, fill-mode, delay. Several comma-separated animations compose
// with the later one winning per property.
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart' show Ticker;

import 'style_parse.dart';

/// One keyframe: its offset (0..1) and the declarations at that point.
class FjsKeyframe {
  const FjsKeyframe(this.offset, this.style);

  final double offset;
  final Map<String, Object?> style;
}

/// One entry of the node's animation list.
class FjsAnimation {
  const FjsAnimation({
    required this.name,
    required this.frames,
    required this.duration,
    required this.curve,
    required this.delay,
    required this.iterations,
    required this.direction,
    required this.fill,
    required this.paused,
  });

  final String name;
  final List<FjsKeyframe> frames;
  final Duration duration;
  final Curve curve;
  final Duration delay;

  /// `infinite` is [double.infinity].
  final double iterations;
  final String direction;
  final String fill;
  final bool paused;

  bool get _fillsForwards => fill == 'forwards' || fill == 'both';
  bool get _fillsBackwards => fill == 'backwards' || fill == 'both';

  /// Every property some keyframe sets.
  Iterable<String> get properties sync* {
    final seen = <String>{};
    for (final f in frames) {
      for (final k in f.style.keys) {
        if (k == 'animationTimingFunction') continue;
        if (seen.add(k)) yield k;
      }
    }
  }

  /// Iteration progress (0..1, direction applied) at [elapsed], or null when
  /// the animation has no effect then (before a delay without backwards
  /// fill, after the end without forwards fill).
  double? progressAt(Duration elapsed) {
    final local = (paused ? Duration.zero : elapsed) - delay;
    final dur = duration.inMicroseconds.toDouble();
    int iteration;
    double p;
    if (local.isNegative) {
      if (!_fillsBackwards) return null;
      iteration = 0;
      p = 0;
    } else if (dur <= 0) {
      if (!_fillsForwards) return null;
      iteration = iterations.isFinite ? math.max(0, iterations.ceil() - 1) : 0;
      p = 1;
    } else {
      final t = local.inMicroseconds / dur;
      if (iterations.isFinite && t >= iterations) {
        if (!_fillsForwards) return null;
        // a fractional count ends mid-iteration and holds that point
        final whole = iterations.floor();
        final frac = iterations - whole;
        iteration = frac == 0 ? math.max(0, whole - 1) : whole;
        p = frac == 0 ? 1 : frac;
      } else {
        iteration = t.floor();
        p = t - iteration;
      }
    }
    final reversed = switch (direction) {
      'reverse' => true,
      'alternate' => iteration.isOdd,
      'alternate-reverse' => iteration.isEven,
      _ => false,
    };
    return reversed ? 1 - p : p;
  }

  /// Whether nothing changes after [elapsed] any more — the ticker can stop.
  bool isSettled(Duration elapsed) {
    if (paused) return true;
    if (!iterations.isFinite) return false;
    final end =
        delay +
        Duration(
          microseconds: (duration.inMicroseconds * iterations).round(),
        );
    return elapsed >= end;
  }

  /// The value of [property] at iteration progress [p]. [base] is the
  /// element's own value, which stands in for a missing 0% / 100% frame.
  Object? valueAt(String property, double p, Object? base) {
    FjsKeyframe? before;
    FjsKeyframe? after;
    for (final f in frames) {
      if (!f.style.containsKey(property)) continue;
      if (f.offset <= p) before = f;
      if (f.offset >= p && after == null) after = f;
    }
    final from = before ?? FjsKeyframe(0, {property: base});
    final to = after ?? FjsKeyframe(1, {property: base});
    final span = to.offset - from.offset;
    // an exact keyframe hit (the first and last frame of every run) still
    // goes through the interpolator: it is what turns the raw CSS value into
    // the sampled shape the node reads — a JSON `opacity: 0` arrives as an
    // int, a transform as a string, and neither is what the builder expects
    if (span <= 0) {
      return interpolateCssValue(property, from.style[property], from.style[property], 0);
    }
    final local = ((p - from.offset) / span).clamp(0.0, 1.0);
    final curve =
        parseTimingFunction(from.style['animationTimingFunction']) ?? this.curve;
    return interpolateCssValue(
      property,
      from.style[property],
      to.style[property],
      curve.transform(local),
    );
  }
}

/// A node's animations, parsed once per style map.
class FjsAnimations {
  const FjsAnimations(this.list);

  final List<FjsAnimation> list;

  /// Identity of the running set: CSS restarts an animation only when its
  /// name list changes, not when a duration or a sibling property does.
  String get signature => list.map((a) => a.name).join(',');

  bool get animatesTransform => list.any((a) => a.properties.contains('transform'));
  bool get animatesOpacity => list.any((a) => a.properties.contains('opacity'));

  bool isSettled(Duration elapsed) => list.every((a) => a.isSettled(elapsed));

  /// Animated values at [elapsed]; a property absent from the result is not
  /// animated at that moment. [base] reads the element's own value.
  Map<String, Object?> sample(
    Duration elapsed,
    Object? Function(String property) base,
  ) {
    final out = <String, Object?>{};
    for (final a in list) {
      final p = a.progressAt(elapsed);
      if (p == null) continue;
      for (final prop in a.properties) {
        out[prop] = a.valueAt(prop, p, base(prop) ?? _initialValues[prop]);
      }
    }
    return out;
  }

  static final Expando<Object> _memo = Expando('fjsAnimations');
  static const Object _none = Object();

  /// The animations a computed style runs, or null. Memoized per style map:
  /// interned styles are shared and immutable.
  static FjsAnimations? of(Map<String, Object?> style) {
    final cached = _memo[style];
    if (cached != null) return identical(cached, _none) ? null : cached as FjsAnimations;
    final parsed = _parse(style);
    _memo[style] = parsed ?? _none;
    return parsed;
  }

  static FjsAnimations? _parse(Map<String, Object?> style) {
    final keyframes = style['animationKeyframes'];
    final names = style['animationName'];
    if (keyframes is! Map || names == null) return null;
    List<String> list(String key) =>
        splitCssList(style[key]?.toString() ?? '').map((s) => s.trim()).toList();
    T at<T>(List<String> values, int i, T Function(String) parse, T fallback) =>
        values.isEmpty ? fallback : parse(values[i % values.length]);

    final nameList = list('animationName');
    final durations = list('animationDuration');
    final timings = list('animationTimingFunction');
    final delays = list('animationDelay');
    final counts = list('animationIterationCount');
    final directions = list('animationDirection');
    final fills = list('animationFillMode');
    final plays = list('animationPlayState');
    final out = <FjsAnimation>[];
    for (var i = 0; i < nameList.length; i++) {
      final name = nameList[i];
      final raw = keyframes[name];
      if (raw is! List || raw.isEmpty) continue;
      final frames = <FjsKeyframe>[
        for (final f in raw)
          if (f is Map && f['style'] is Map)
            FjsKeyframe(
              (f['offset'] as num?)?.toDouble() ?? 0,
              Map<String, Object?>.from(f['style'] as Map),
            ),
      ]..sort((a, b) => a.offset.compareTo(b.offset));
      out.add(
        FjsAnimation(
          name: name,
          frames: frames,
          duration: at(durations, i, (s) => parseDuration(s) ?? Duration.zero, Duration.zero),
          curve: at(timings, i, (s) => parseTimingFunction(s) ?? Curves.ease, Curves.ease),
          delay: at(delays, i, (s) => parseDuration(s) ?? Duration.zero, Duration.zero),
          iterations: at(
            counts,
            i,
            (s) => s == 'infinite' ? double.infinity : (double.tryParse(s) ?? 1),
            1.0,
          ),
          direction: at(directions, i, (s) => s, 'normal'),
          fill: at(fills, i, (s) => s, 'none'),
          paused: at(plays, i, (s) => s == 'paused', false),
        ),
      );
    }
    return out.isEmpty ? null : FjsAnimations(out);
  }
}

// ---- value interpolation -----------------------------------------------------

/// CSS initial values of the animatable properties an element most often
/// leaves unset — what a missing 0% / 100% frame interpolates from.
const _initialValues = <String, Object?>{
  'opacity': 1.0,
  'transform': 'none',
  'strokeDashoffset': 0.0,
  'strokeWidth': 1.0,
  'strokeOpacity': 1.0,
  'fillOpacity': 1.0,
};

/// A sampled `transform`: the matrix, plus the `%` part of its translations
/// as fractions of the box (applied with [FractionalTranslation], the same
/// split [parseTransformFraction] makes for static transforms).
class FjsAnimatedTransform {
  const FjsAnimatedTransform(this.matrix, this.fraction);

  final Matrix4 matrix;
  final Offset fraction;
}

const _colorProps = {'color', 'backgroundColor', 'fill', 'stroke', 'borderColor'};

/// Interpolates one property between two raw CSS values. Numbers, number
/// lists (stroke-dasharray), colors and transform lists interpolate; any
/// other value flips at the midpoint, CSS's discrete animation type.
Object? interpolateCssValue(String property, Object? a, Object? b, double t) {
  if (property == 'transform') return _lerpTransform(a, b, t);
  if (property == 'strokeDasharray') {
    final la = parseNumberList(a);
    final lb = parseNumberList(b);
    if (la != null && lb != null && la.isNotEmpty && lb.isNotEmpty) {
      // CSS repeats both lists to their least common multiple
      final n = _lcm(la.length, lb.length);
      return [
        for (var i = 0; i < n; i++) la[i % la.length] + (lb[i % lb.length] - la[i % la.length]) * t,
      ];
    }
  }
  if (_colorProps.contains(property)) {
    final ca = parseColor(a);
    final cb = parseColor(b);
    if (ca != null && cb != null) return Color.lerp(ca, cb, t);
  }
  final na = _number(a);
  final nb = _number(b);
  if (na != null && nb != null) return na + (nb - na) * t;
  return t < 0.5 ? a : b;
}

double? _number(Object? v) {
  if (v is num) return v.toDouble();
  if (v == null) return null;
  final s = v.toString().trim();
  return double.tryParse(s) ?? (s.endsWith('px') ? double.tryParse(s.substring(0, s.length - 2)) : null);
}

/// `1,200` / `1 200` / `4` → numbers; `none` → empty. Null when unparsable.
List<double>? parseNumberList(Object? v) {
  if (v == null) return null;
  if (v is num) return [v.toDouble()];
  if (v is List) {
    final out = v.map(_number).toList();
    return out.contains(null) ? null : out.cast<double>();
  }
  final s = v.toString().trim();
  if (s == 'none' || s.isEmpty) return const [];
  final out = s.split(RegExp(r'[\s,]+')).where((p) => p.isNotEmpty).map(_number).toList();
  return out.contains(null) ? null : out.cast<double>();
}

int _lcm(int a, int b) {
  int gcd(int x, int y) => y == 0 ? x : gcd(y, x % y);
  return a * b ~/ gcd(a, b);
}

/// One transform function, normalized: translate carries (px x, px y,
/// fraction x, fraction y), scale (x, y), rotate (radians).
class _Fn {
  const _Fn(this.kind, this.args);

  final String kind;
  final List<double> args;
}

final RegExp _fnPattern = RegExp(r'([a-zA-Z0-9]+)\(([^)]*)\)');

/// Parses a transform into interpolable functions; null when it holds one
/// this list cannot express (matrix, skew…), which falls back to matrices.
List<_Fn>? _functions(Object? value) {
  if (value == null) return const [];
  final text = value.toString().trim();
  if (text.isEmpty || text == 'none') return const [];
  final out = <_Fn>[];
  (double, double) len(String? a) {
    if (a == null) return (0, 0);
    final s = a.trim();
    if (s.endsWith('%')) return (0, (double.tryParse(s.substring(0, s.length - 1)) ?? 0) / 100);
    return (parseLength(s) ?? double.tryParse(s) ?? 0, 0);
  }

  for (final m in _fnPattern.allMatches(text)) {
    final name = m.group(1)!.toLowerCase();
    final args = m.group(2)!.split(RegExp(r'[\s,]+')).where((a) => a.isNotEmpty).toList();
    if (args.isEmpty) return null;
    switch (name) {
      case 'translate' || 'translate3d':
        final x = len(args[0]);
        final y = len(args.length > 1 ? args[1] : null);
        out.add(_Fn('translate', [x.$1, y.$1, x.$2, y.$2]));
      case 'translatex':
        final x = len(args[0]);
        out.add(_Fn('translate', [x.$1, 0, x.$2, 0]));
      case 'translatey':
        final y = len(args[0]);
        out.add(_Fn('translate', [0, y.$1, 0, y.$2]));
      case 'scale' || 'scale3d':
        final sx = double.tryParse(args[0]) ?? 1;
        out.add(_Fn('scale', [sx, args.length > 1 ? double.tryParse(args[1]) ?? sx : sx]));
      case 'scalex':
        out.add(_Fn('scale', [double.tryParse(args[0]) ?? 1, 1]));
      case 'scaley':
        out.add(_Fn('scale', [1, double.tryParse(args[0]) ?? 1]));
      case 'rotate' || 'rotatez':
        out.add(_Fn('rotate', [parseAngle(args[0]) ?? 0]));
      default:
        return null;
    }
  }
  return out;
}

_Fn _identity(String kind) => switch (kind) {
  'translate' => const _Fn('translate', [0, 0, 0, 0]),
  'scale' => const _Fn('scale', [1, 1]),
  _ => const _Fn('rotate', [0]),
};

FjsAnimatedTransform _compose(List<_Fn> fns) {
  final m = Matrix4.identity();
  var fraction = Offset.zero;
  for (final f in fns) {
    switch (f.kind) {
      case 'translate':
        m.multiply(Matrix4.translationValues(f.args[0], f.args[1], 0));
        fraction += Offset(f.args[2], f.args[3]);
      case 'scale':
        m.multiply(Matrix4.diagonal3Values(f.args[0], f.args[1], 1));
      case 'rotate':
        m.multiply(Matrix4.rotationZ(f.args[0]));
    }
  }
  return FjsAnimatedTransform(m, fraction);
}

/// CSS transform interpolation: function lists of the same shape interpolate
/// argument by argument — so `rotate(0)` → `rotate(360deg)` is a full turn,
/// which a matrix interpolation would flatten to "no change". A `none` side
/// takes the other side's identity functions. Mismatched lists fall back to
/// interpolating the composed matrices.
FjsAnimatedTransform _lerpTransform(Object? a, Object? b, double t) {
  var fa = _functions(a);
  var fb = _functions(b);
  if (fa != null && fb != null) {
    if (fa.isEmpty) fa = [for (final f in fb) _identity(f.kind)];
    if (fb.isEmpty) fb = [for (final f in fa) _identity(f.kind)];
    var same = fa.length == fb.length;
    for (var i = 0; same && i < fa.length; i++) {
      same = fa[i].kind == fb[i].kind;
    }
    if (same) {
      return _compose([
        for (var i = 0; i < fa.length; i++)
          _Fn(fa[i].kind, [
            for (var j = 0; j < fa[i].args.length; j++)
              fa[i].args[j] + (fb[i].args[j] - fa[i].args[j]) * t,
          ]),
      ]);
    }
  }
  final ma = parseTransform(a) ?? Matrix4.identity();
  final mb = parseTransform(b) ?? Matrix4.identity();
  final fra = parseTransformFraction(a) ?? Offset.zero;
  final frb = parseTransformFraction(b) ?? Offset.zero;
  return FjsAnimatedTransform(
    Matrix4Tween(begin: ma, end: mb).transform(t),
    Offset.lerp(fra, frb, t)!,
  );
}

// ---- the node wrapper --------------------------------------------------------

/// Runs [style]'s animations over [content]: the animated `transform` and
/// `opacity` are applied here, per frame, without rebuilding the subtree.
/// Returns [content] untouched when the node animates neither.
Widget keyframeNode(
  Map<String, Object?> style,
  Widget content, {
  required Object key,
}) {
  final animations = FjsAnimations.of(style);
  if (animations == null ||
      (!animations.animatesTransform && !animations.animatesOpacity)) {
    return content;
  }
  return _KeyframeNode(
    key: ValueKey<Object>(key),
    animations: animations,
    style: style,
    child: content,
  );
}

class _KeyframeNode extends StatefulWidget {
  const _KeyframeNode({
    super.key,
    required this.animations,
    required this.style,
    required this.child,
  });

  final FjsAnimations animations;
  final Map<String, Object?> style;
  final Widget child;

  @override
  State<_KeyframeNode> createState() => _KeyframeNodeState();
}

class _KeyframeNodeState extends State<_KeyframeNode>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker = createTicker(_onTick);
  final ValueNotifier<Duration> _elapsed = ValueNotifier(Duration.zero);

  @override
  void initState() {
    super.initState();
    _ticker.start();
  }

  @override
  void didUpdateWidget(covariant _KeyframeNode oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.animations.signature != oldWidget.animations.signature) {
      // a new name list restarts from zero, as in CSS
      _ticker.stop();
      _elapsed.value = Duration.zero;
      _ticker.start();
    } else if (!_ticker.isActive && !widget.animations.isSettled(_elapsed.value)) {
      _ticker.start();
    }
  }

  void _onTick(Duration elapsed) {
    _elapsed.value = elapsed;
    if (widget.animations.isSettled(elapsed)) _ticker.stop();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _elapsed.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<Duration>(
      valueListenable: _elapsed,
      child: widget.child,
      builder: (context, elapsed, child) {
        final values = widget.animations.sample(elapsed, (p) => widget.style[p]);
        // The wrappers stay in place for the animation's whole life, idle or
        // not: adding one mid-way changes the widget chain above the node
        // and remounts it (its state, its gesture recognizers).
        Widget w = child!;
        if (widget.animations.animatesTransform) {
          final transform = values['transform'];
          final t = transform is FjsAnimatedTransform ? transform : null;
          w = FractionalTranslation(
            translation: t?.fraction ?? Offset.zero,
            child: Transform(
              transform: t?.matrix ?? Matrix4.identity(),
              alignment: Alignment.center,
              child: w,
            ),
          );
        }
        if (widget.animations.animatesOpacity) {
          final opacity = values['opacity'];
          w = Opacity(
            opacity: opacity is num ? opacity.toDouble().clamp(0.0, 1.0) : 1.0,
            child: w,
          );
        }
        return w;
      },
    );
  }
}
