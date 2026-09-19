// CSS value parsing helpers shared by the widget layer: colors (#hex,
// rgb()/rgba()/hsl()/hsla(), CSS named colors), lengths ("16px" -> 16.0),
// font weights/styles, text decoration, box/text shadows, linear and radial
// gradients, border and border-radius shorthands, and the `transform` list.
//
// Pure functions with no widget imports so they are unit-testable. Values
// arriving from JS are either numbers (inline style API) or strings (CSS
// text from <style> blocks / style="..." attributes).

import 'dart:collection' show HashMap;
import 'dart:math' show cos, pi, sin;

import 'package:flutter/animation.dart';
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, visibleForTesting;
import 'package:flutter/painting.dart';
import 'package:vector_math/vector_math_64.dart' show Matrix4;

import 'length.dart';

export 'length.dart' show FjsLength;

// ---- parse memoization ------------------------------------------------------
//
// These parsers are pure, and they are asked the same question over and over.
// One computed style is shared by every node that resolved to it (the op
// protocol interns them, see mirror_tree.dart), FjsStyle is rebuilt for every
// node on every build, and several of its getters are read more than once per
// build — decorateNode alone asks for `border` three times. So the same
// "#1c1c1e" is parsed thousands of times per theme switch.
//
// Memoizing here rather than on the style map covers the other input too:
// FjsStyle falls back to top-level props (`h('image', {fit: 'cover'})`), which
// no style-keyed cache would see.

/// Counts parser invocations that actually did work. A widget test asserts
/// this stays flat across a rebuild — the durable guard against someone
/// reintroducing per-build parsing.
@visibleForTesting
int fjsParseCalls = 0;

/// Cleared wholesale when full: these are pure functions, so losing the cache
/// costs time and never correctness.
const int _memoMaxEntries = 2048;

/// Bypasses every parse cache. Only the benchmark uses this — measuring the
/// cache by clearing it between builds does not work, because the first node
/// of a build refills it for all the others.
@visibleForTesting
bool fjsDisableParseCache = false;

class _ParseMemo<T> {
  _ParseMemo(this._parse);

  final T Function(Object value) _parse;
  final Map<Object, T> _entries = HashMap<Object, T>();

  T call(Object value) {
    if (fjsDisableParseCache) {
      fjsParseCalls++;
      return _parse(value);
    }
    final hit = _entries[value];
    // a null result is a real answer ("unparseable"), so it has to be cached
    // too — hence the containsKey probe on the null path
    if (hit != null || _entries.containsKey(value)) return hit as T;
    if (_entries.length >= _memoMaxEntries) _entries.clear();
    fjsParseCalls++;
    final computed = _parse(value);
    _entries[value] = computed;
    return computed;
  }

  void clear() => _entries.clear();
}

final List<void Function()> _memoClears = [];

_ParseMemo<T> _memo<T>(T Function(Object value) parse) {
  final memo = _ParseMemo<T>(parse);
  _memoClears.add(memo.clear);
  return memo;
}

/// Drops every parse cache. Only tests need this.
@visibleForTesting
void fjsClearParseCaches() {
  for (final clear in _memoClears) {
    clear();
  }
  fjsParseCalls = 0;
}

class FjsTransitionTrack {
  const FjsTransitionTrack({
    required this.property,
    required this.duration,
    required this.curve,
    this.delay = Duration.zero,
  });

  final String property;
  final Duration duration;
  final Duration delay;
  final Curve curve;

  bool matches(String name) => property == 'all' || property == name;
}

class FjsTransitions {
  const FjsTransitions(this.tracks);

  final List<FjsTransitionTrack> tracks;

  bool get hasAnimatedTrack =>
      tracks.any((track) => track.duration > Duration.zero);

  FjsTransitionTrack? forProperty(String name) {
    FjsTransitionTrack? all;
    for (final track in tracks) {
      if (track.property == name) return track;
      if (track.property == 'all') all = track;
    }
    return all;
  }
}

/// Parses any web color notation into a [Color], null if unrecognized.
Color? _parseColorUncached(Object value) {
  if (value is Color) return value;
  var v = value.toString().trim().toLowerCase();
  if (v.isEmpty) return null;
  // CSS's own keyword, and one that matters: canvas code assigns it to
  // fillStyle to mean "paint nothing", and a null here would send the caller
  // to its own fallback — which for the canvas replay is opaque black. That
  // is how ECharts' legend came out as two black boxes.
  if (v == 'transparent') return const Color(0x00000000);
  if (v.startsWith('#')) return _parseHex(v.substring(1));
  if (v.endsWith(')')) {
    final open = v.indexOf('(');
    if (open > 0) {
      final fn = v.substring(0, open).trim();
      final args = v.substring(open + 1, v.length - 1);
      if (fn == 'rgb' || fn == 'rgba') return _parseRgbArgs(args);
      if (fn == 'hsl' || fn == 'hsla') return _parseHslArgs(args);
    }
  }
  final named = _namedColors[v];
  return named == null ? null : Color(0xFF000000 | named);
}

Color? _parseHex(String hex) {
  String expand(String nibble) => nibble + nibble;
  // #RGB #RGBA #RRGGBB #RRGGBBAA (web: last pair is alpha)
  String r, g, b, a;
  switch (hex.length) {
    case 3:
      r = expand(hex[0]);
      g = expand(hex[1]);
      b = expand(hex[2]);
      a = 'ff';
    case 4:
      r = expand(hex[0]);
      g = expand(hex[1]);
      b = expand(hex[2]);
      a = expand(hex[3]);
    case 6:
      r = hex.substring(0, 2);
      g = hex.substring(2, 4);
      b = hex.substring(4, 6);
      a = 'ff';
    case 8:
      r = hex.substring(0, 2);
      g = hex.substring(2, 4);
      b = hex.substring(4, 6);
      a = hex.substring(6, 8);
    default:
      return null;
  }
  final argb = int.tryParse('$a$r$g$b', radix: 16);
  return argb == null ? null : Color(argb);
}

/// Parses "255,0,0" / "255 0 0 / 0.5" style component lists; percentages
/// (50%) and 0-255 numbers are both accepted.
Color? _parseRgbArgs(String args) {
  final parts = _splitColorArgs(args);
  if (parts.length < 3) return null;
  final r = _channel(parts[0]);
  final g = _channel(parts[1]);
  final b = _channel(parts[2]);
  final a = parts.length > 3 ? _alpha(parts[3]) : 1.0;
  if (r == null || g == null || b == null || a == null) return null;
  return Color.fromARGB((a * 255).round(), r, g, b);
}

Color? _parseHslArgs(String args) {
  final parts = _splitColorArgs(args);
  if (parts.length < 3) return null;
  final h = double.tryParse(parts[0].replaceAll(RegExp(r'deg$'), '').trim());
  final s = _percent(parts[1]);
  final l = _percent(parts[2]);
  final a = parts.length > 3 ? _alpha(parts[3]) : 1.0;
  if (h == null || s == null || l == null || a == null) return null;
  return HSLColor.fromAHSL(a, h % 360, s.clamp(0, 1), l.clamp(0, 1)).toColor();
}

List<String> _splitColorArgs(String args) => args
    .split('/')
    .expand((seg) => seg.split(RegExp(r'[,\s]+')))
    .map((s) => s.trim())
    .where((s) => s.isNotEmpty)
    .toList();

int? _channel(String v) {
  if (v.endsWith('%')) {
    final p = double.tryParse(v.substring(0, v.length - 1));
    return p == null ? null : (p * 255 / 100).round().clamp(0, 255);
  }
  final n = double.tryParse(v);
  return n == null ? null : n.round().clamp(0, 255);
}

double? _percent(String v) {
  if (v.endsWith('%'))
    return double.tryParse(v.substring(0, v.length - 1))! / 100;
  return double.tryParse(v);
}

double? _alpha(String v) {
  if (v.endsWith('%')) return _percent(v);
  return double.tryParse(v);
}

/// Parses a length: num, "12", "12px" -> double. Other units are not
/// supported (rem/em are normalized to px on the JS side).
double? _parseLengthUncached(Object value) {
  if (value is num) return value.toDouble();
  if (value is! String) return null;
  var v = value.trim();
  if (v.endsWith('px')) v = v.substring(0, v.length - 2).trim();
  return double.tryParse(v);
}

FontWeight? _parseFontWeightUncached(Object value) {
  if (value is num) return _weightFor(value.round());
  final v = value.toString().trim();
  final n = int.tryParse(v);
  if (n != null) return _weightFor(n);
  switch (v) {
    case 'normal':
      return FontWeight.w400;
    case 'bold':
      return FontWeight.w700;
    default:
      return null; // bolder/lighter need the parent's weight — unsupported
  }
}

FontWeight _weightFor(int n) {
  const weights = [
    FontWeight.w100,
    FontWeight.w200,
    FontWeight.w300,
    FontWeight.w400,
    FontWeight.w500,
    FontWeight.w600,
    FontWeight.w700,
    FontWeight.w800,
    FontWeight.w900,
  ];
  return weights[(n.clamp(100, 900) - 100) ~/ 100];
}

FontStyle? _parseFontStyleUncached(Object value) {
  final v = value.toString();
  if (v == 'italic' || v == 'oblique') return FontStyle.italic;
  return null;
}

TextDecoration? _parseTextDecorationUncached(Object value) {
  final v = value.toString().trim();
  if (v.isEmpty) return null;
  if (v == 'none') return TextDecoration.none;
  TextDecoration? out;
  for (final part in v.split(RegExp(r'\s+'))) {
    final d = switch (part) {
      'underline' => TextDecoration.underline,
      'line-through' => TextDecoration.lineThrough,
      'overline' => TextDecoration.overline,
      _ => null,
    };
    if (d != null) out = out == null ? d : TextDecoration.combine([out, d]);
  }
  return out;
}

/// Parses one shadow ("0 2px 8px rgba(0,0,0,.2)") or a comma-separated
/// list. `inset` is ignored (no inset shadows in Flutter).
List<BoxShadow>? _parseBoxShadowsUncached(Object value) {
  final List<Object?> items;
  if (value is List) {
    items = value;
  } else {
    items = _splitTopLevel(value.toString(), ',');
  }
  final shadows = <BoxShadow>[];
  for (final item in items) {
    final shadow = _parseShadow(item.toString().trim());
    if (shadow != null) shadows.add(shadow);
  }
  return shadows.isEmpty ? null : shadows;
}

BoxShadow? _parseShadow(String s) {
  if (s.isEmpty) return null;
  final tokens = _splitTopLevel(s, ' ').where((t) => t.isNotEmpty).toList();
  tokens.removeWhere((t) => t == 'inset');
  if (tokens.length < 2) return null;
  final dx = parseLength(tokens[0]);
  final dy = parseLength(tokens[1]);
  if (dx == null || dy == null) return null;
  var idx = 2;
  var blur = 0.0;
  var spread = 0.0;
  if (idx < tokens.length && parseLength(tokens[idx]) != null) {
    blur = parseLength(tokens[idx])!;
    idx++;
  }
  if (idx < tokens.length && parseLength(tokens[idx]) != null) {
    spread = parseLength(tokens[idx])!;
    idx++;
  }
  var color = const Color(0xFF000000);
  if (idx < tokens.length) {
    final c = parseColor(tokens[idx]);
    if (c != null) color = c;
  }
  return BoxShadow(
    offset: Offset(dx, dy),
    blurRadius: blur,
    spreadRadius: spread,
    color: color,
  );
}

/// Splits on [sep] occurrences that are not inside parentheses.
List<String> _splitTopLevel(String text, String sep) {
  final parts = <String>[];
  var depth = 0;
  var start = 0;
  for (var i = 0; i < text.length; i++) {
    final ch = text[i];
    if (ch == '(') {
      depth++;
    } else if (ch == ')') {
      if (depth > 0) depth--;
    } else if (ch == sep && depth == 0) {
      parts.add(text.substring(start, i));
      start = i + 1;
    }
  }
  parts.add(text.substring(start));
  return parts;
}

/// Parses `linear-gradient(...)` / `radial-gradient(...)` from a
/// `background` or `background-image` value; plain colors return null
/// (handled by the color getters).
Gradient? _parseGradientUncached(Object value) {
  final v = value.toString().trim().toLowerCase();
  final open = v.indexOf('(');
  if (open <= 0 || !v.endsWith(')')) return null;
  final fn = v.substring(0, open).trim();
  final args = _splitTopLevel(
    v.substring(open + 1, v.length - 1),
    ',',
  ).map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
  if (fn == 'linear-gradient') return _parseLinear(args);
  if (fn == 'radial-gradient') return _parseRadial(args);
  return null;
}

Gradient? _parseLinear(List<String> args) {
  var begin = Alignment.topLeft;
  var end = Alignment.bottomRight;
  var colors = args;
  if (args.isNotEmpty && !_isColorStop(args.first)) {
    final dir = _parseDirection(args.first);
    if (dir == null) return null;
    begin = dir.$1;
    end = dir.$2;
    colors = args.sublist(1);
  }
  return _buildGradient(
    colors,
    (stops) => LinearGradient(
      begin: begin,
      end: end,
      colors: stops.$1,
      stops: stops.$2,
    ),
  );
}

Gradient? _parseRadial(List<String> args) {
  var colors = args;
  // skip "circle", "ellipse", "closest-side at ...", position prefixes
  while (colors.isNotEmpty && !_isColorStop(colors.first)) {
    colors = colors.sublist(1);
  }
  if (colors.isEmpty) return null;
  return _buildGradient(
    colors,
    (stops) => RadialGradient(colors: stops.$1, stops: stops.$2),
  );
}

Gradient? _buildGradient(
  List<String> args,
  Gradient Function((List<Color>, List<double>?)) build,
) {
  final colors = <Color>[];
  final stops = <double>[];
  var hasStops = false;
  for (final arg in args) {
    final parts = _splitTopLevel(arg, ' ').where((s) => s.isNotEmpty).toList();
    final color = parseColor(parts.first);
    if (color == null) return null;
    colors.add(color);
    if (parts.length > 1) {
      final stop = _stopFraction(parts[1]);
      if (stop == null) return null;
      stops.add(stop);
      hasStops = true;
    }
  }
  if (colors.length < 2) return null;
  return build((colors, hasStops ? stops : null));
}

bool _isColorStop(String arg) =>
    parseColor(arg.trim().split(' ').first) != null;

double? _stopFraction(String v) {
  if (v.endsWith('%')) {
    final p = double.tryParse(v.substring(0, v.length - 1));
    return p == null ? null : p / 100;
  }
  return double.tryParse(v);
}

/// CSS gradient direction: "180deg" / "to bottom right" -> (begin, end).
(Alignment, Alignment)? _parseDirection(String spec) {
  final s = spec.trim();
  if (s.endsWith('deg')) {
    final deg = double.tryParse(s.substring(0, s.length - 3));
    if (deg == null) return null;
    // CSS: 0deg points up, clockwise. 90deg = to right.
    final rad = deg * 3.141592653589793 / 180;
    final x = _snap(sin(rad));
    final y = _snap(-cos(rad));
    return (Alignment(-x, -y), Alignment(x, y));
  }
  if (s.startsWith('to ')) {
    final parts = s.substring(3).split(RegExp(r'\s+'));
    var x = 0.0;
    var y = 0.0;
    for (final p in parts) {
      if (p == 'left') x = -1;
      if (p == 'right') x = 1;
      if (p == 'top') y = -1;
      if (p == 'bottom') y = 1;
    }
    return (Alignment(-x, -y), Alignment(x, y));
  }
  return null;
}

double _snap(double v) =>
    v.abs() < 1e-6 ? 0 : (v.abs() > 1 - 1e-6 ? v.sign : v);

/// How a border is stroked. `double`/`groove`/`ridge` and friends parse as
/// [solid] — the shapes CSS draws for them need two strokes.
enum FjsBorderStyle { solid, dashed, dotted }

FjsBorderStyle? _parseBorderStyleUncached(Object value) {
  switch (value.toString().trim().toLowerCase()) {
    case 'dashed':
      return FjsBorderStyle.dashed;
    case 'dotted':
      return FjsBorderStyle.dotted;
    case '':
      return null;
    default:
      return FjsBorderStyle.solid;
  }
}

/// Parses the `border` shorthand: `1px solid rgba(0, 0, 0, .16)` -> width,
/// color and stroke style. Null means *no* border — `none`, `hidden`, or a
/// zero width — which is what lets a page turn off a border a tag default
/// gave it.
({double width, Color? color, FjsBorderStyle kind})? _parseBorderUncached(
  Object value,
) {
  if (value is num) {
    if (value <= 0) return null;
    return (
      width: value.toDouble(),
      color: null,
      kind: FjsBorderStyle.solid,
    );
  }
  final tokens = splitOutsideParens(value.toString());
  var width = 1.0;
  // null = no color in the shorthand: CSS's initial border-color is
  // currentColor, which only the style (it knows `color`) can resolve
  Color? color;
  var kind = FjsBorderStyle.solid;
  for (final t in tokens) {
    final word = t.toLowerCase();
    if (word == 'none' || word == 'hidden') return null;
    final len = parseLength(t);
    if (len != null) {
      width = len;
      continue;
    }
    final c = parseColor(t);
    if (c != null) {
      color = c;
      continue;
    }
    if (word == 'dashed' || word == 'dotted') kind = parseBorderStyle(word)!;
    // other style keywords (solid, double, groove...) render solid
  }
  return width <= 0 ? null : (width: width, color: color, kind: kind);
}

/// Splits on whitespace that is not inside parentheses, so a functional
/// color survives as one token: `1px solid rgba(0, 0, 0, .16)` is three.
List<String> splitOutsideParens(String value) {
  final out = <String>[];
  final buffer = StringBuffer();
  var depth = 0;
  for (final rune in value.trim().runes) {
    final ch = String.fromCharCode(rune);
    if (ch == '(') depth++;
    if (ch == ')') depth = depth > 0 ? depth - 1 : 0;
    if (depth == 0 && ch.trim().isEmpty) {
      if (buffer.isNotEmpty) out.add(buffer.toString());
      buffer.clear();
      continue;
    }
    buffer.write(ch);
  }
  if (buffer.isNotEmpty) out.add(buffer.toString());
  return out;
}

/// Parses a border-radius shorthand: one to four lengths
/// ("8px", "8px 16px", "8px 8px 0 0"). Percentage radii are not supported
/// here (they need the box's size — see [parseBorderRadiusParts]).
BorderRadius? _parseBorderRadiusUncached(Object value) {
  if (value is num) return BorderRadius.circular(value.toDouble());
  final tokens = value
      .toString()
      .trim()
      .split(RegExp(r'\s+'))
      .where((t) => t.isNotEmpty)
      .toList();
  if (tokens.isEmpty) return null;
  final radii = [for (final t in tokens) parseLength(t)];
  if (radii.any((r) => r == null)) return null;
  Radius r(int i) => Radius.circular(radii[i.clamp(0, radii.length - 1)]!);
  return switch (radii.length) {
    1 => BorderRadius.all(Radius.circular(radii[0]!)),
    2 => BorderRadius.only(
      topLeft: r(0),
      topRight: r(1),
      bottomRight: r(0),
      bottomLeft: r(1),
    ),
    3 => BorderRadius.only(
      topLeft: r(0),
      topRight: r(1),
      bottomRight: r(2),
      bottomLeft: r(1),
    ),
    4 => BorderRadius.only(
      topLeft: r(0),
      topRight: r(1),
      bottomRight: r(2),
      bottomLeft: r(3),
    ),
    _ => null,
  };
}

/// One parsed border-radius corner: an absolute px part plus a fraction of
/// the box's width/height (`50%` → fraction 0.5).
typedef BorderRadiusPart = ({double px, double fraction});

final _parseBorderRadiusPartsMemo = _memo<List<BorderRadiusPart>?>(
  _parseBorderRadiusPartsUncached,
);

/// Per-corner radius parts in Flutter corner order (top-left, top-right,
/// bottom-right, bottom-left), shorthand-expanded from 1–4 values. Null when
/// the value is absent or unsupported. Unlike [parseBorderRadius], this
/// KEEPS percentages, because a percentage references the box's own size —
// a quantity only a layout pass knows (decoration.dart resolves it there).
/// The elliptical `a / b` form is outside the subset and nulls the value.
List<BorderRadiusPart>? parseBorderRadiusParts(Object? value) {
  if (value == null) return null;
  return _parseBorderRadiusPartsMemo(value);
}

List<BorderRadiusPart>? _parseBorderRadiusPartsUncached(Object value) {
  if (value is num) {
    final p = (px: value.toDouble(), fraction: 0.0);
    return [p, p, p, p];
  }
  final v = value.toString().trim();
  if (v.isEmpty) return null;
  if (v.contains('/')) return null; // elliptical `a / b`: not supported
  final tokens = v.split(RegExp(r'\s+')).where((t) => t.isNotEmpty).toList();
  if (tokens.isEmpty || tokens.length > 4) return null;
  BorderRadiusPart? part(String t) {
    if (t.endsWith('%')) {
      final n = double.tryParse(t.substring(0, t.length - 1).trim());
      return n == null ? null : (px: 0.0, fraction: n / 100);
    }
    final n = _parseLengthUncached(t);
    return n == null ? null : (px: n, fraction: 0.0);
  }

  final parts = [for (final t in tokens) part(t)];
  if (parts.any((p) => p == null)) return null;
  BorderRadiusPart g(int i) => parts[i.clamp(0, parts.length - 1)]!;
  return switch (parts.length) {
    1 => [g(0), g(0), g(0), g(0)],
    2 => [g(0), g(1), g(0), g(1)],
    3 => [g(0), g(1), g(2), g(1)],
    4 => [g(0), g(1), g(2), g(3)],
    _ => null,
  };
}

/// Applies a CSS text-transform to [text]. Returns null when the property
/// is absent/unset so callers keep the original string.
String? transformText(Object? value, String text) {
  switch (value?.toString()) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replaceAllMapped(RegExp(r'\b\w'), (m) => m[0]!.toUpperCase());
    default:
      return null;
  }
}

/// CSS extended named colors (hex RRGGBB, alpha always ff).
const Map<String, int> _namedColors = {
  'aliceblue': 0xF0F8FF,
  'antiquewhite': 0xFAEBD7,
  'aqua': 0x00FFFF,
  'aquamarine': 0x7FFFD4,
  'azure': 0xF0FFFF,
  'beige': 0xF5F5DC,
  'bisque': 0xFFE4C4,
  'black': 0x000000,
  'blanchedalmond': 0xFFEBCD,
  'blue': 0x0000FF,
  'blueviolet': 0x8A2BE2,
  'brown': 0xA52A2A,
  'burlywood': 0xDEB887,
  'cadetblue': 0x5F9EA0,
  'chartreuse': 0x7FFF00,
  'chocolate': 0xD2691E,
  'coral': 0xFF7F50,
  'cornflowerblue': 0x6495ED,
  'cornsilk': 0xFFF8DC,
  'crimson': 0xDC143C,
  'cyan': 0x00FFFF,
  'darkblue': 0x00008B,
  'darkcyan': 0x008B8B,
  'darkgoldenrod': 0xB8860B,
  'darkgray': 0xA9A9A9,
  'darkgreen': 0x006400,
  'darkgrey': 0xA9A9A9,
  'darkkhaki': 0xBDB76B,
  'darkmagenta': 0x8B008B,
  'darkolivegreen': 0x556B2F,
  'darkorange': 0xFF8C00,
  'darkorchid': 0x9932CC,
  'darkred': 0x8B0000,
  'darksalmon': 0xE9967A,
  'darkseagreen': 0x8FBC8F,
  'darkslateblue': 0x483D8B,
  'darkslategray': 0x2F4F4F,
  'darkslategrey': 0x2F4F4F,
  'darkturquoise': 0x00CED1,
  'darkviolet': 0x9400D3,
  'deeppink': 0xFF1493,
  'deepskyblue': 0x00BFFF,
  'dimgray': 0x696969,
  'dimgrey': 0x696969,
  'dodgerblue': 0x1E90FF,
  'firebrick': 0xB22222,
  'floralwhite': 0xFFFAF0,
  'forestgreen': 0x228B22,
  'fuchsia': 0xFF00FF,
  'gainsboro': 0xDCDCDC,
  'ghostwhite': 0xF8F8FF,
  'gold': 0xFFD700,
  'goldenrod': 0xDAA520,
  'gray': 0x808080,
  'green': 0x008000,
  'greenyellow': 0xADFF2F,
  'honeydew': 0xF0FFF0,
  'hotpink': 0xFF69B4,
  'indianred': 0xCD5C5C,
  'indigo': 0x4B0082,
  'ivory': 0xFFFFF0,
  'khaki': 0xF0E68C,
  'lavender': 0xE6E6FA,
  'lavenderblush': 0xFFF0F5,
  'lawngreen': 0x7CFC00,
  'lemonchiffon': 0xFFFACD,
  'lightblue': 0xADD8E6,
  'lightcoral': 0xF08080,
  'lightcyan': 0xE0FFFF,
  'lightgoldenrodyellow': 0xFAFAD2,
  'lightgray': 0xD3D3D3,
  'lightgreen': 0x90EE90,
  'lightgrey': 0xD3D3D3,
  'lightpink': 0xFFB6C1,
  'lightsalmon': 0xFFA07A,
  'lightseagreen': 0x20B2AA,
  'lightskyblue': 0x87CEFA,
  'lightslategray': 0x778899,
  'lightslategrey': 0x778899,
  'lightsteelblue': 0xB0C4DE,
  'lightyellow': 0xFFFFE0,
  'lime': 0x00FF00,
  'limegreen': 0x32CD32,
  'linen': 0xFAF0E6,
  'magenta': 0xFF00FF,
  'maroon': 0x800000,
  'mediumaquamarine': 0x66CDAA,
  'mediumblue': 0x0000CD,
  'mediumorchid': 0xBA55D3,
  'mediumpurple': 0x9370DB,
  'mediumseagreen': 0x3CB371,
  'mediumslateblue': 0x7B68EE,
  'mediumspringgreen': 0x00FA9A,
  'mediumturquoise': 0x48D1CC,
  'mediumvioletred': 0xC71585,
  'midnightblue': 0x191970,
  'mintcream': 0xF5FFFA,
  'mistyrose': 0xFFE4E1,
  'moccasin': 0xFFE4B5,
  'navajowhite': 0xFFDEAD,
  'navy': 0x000080,
  'oldlace': 0xFDF5E6,
  'olive': 0x808000,
  'olivedrab': 0x6B8E23,
  'orange': 0xFFA500,
  'orangered': 0xFF4500,
  'orchid': 0xDA70D6,
  'palegoldenrod': 0xEEE8AA,
  'palegreen': 0x98FB98,
  'paleturquoise': 0xAFEEEE,
  'palevioletred': 0xDB7093,
  'papayawhip': 0xFFEFD5,
  'peachpuff': 0xFFDAB9,
  'peru': 0xCD853F,
  'pink': 0xFFC0CB,
  'plum': 0xDDA0DD,
  'powderblue': 0xB0E0E6,
  'purple': 0x800080,
  'rebeccapurple': 0x663399,
  'red': 0xFF0000,
  'rosybrown': 0xBC8F8F,
  'royalblue': 0x4169E1,
  'saddlebrown': 0x8B4513,
  'salmon': 0xFA8072,
  'sandybrown': 0xF4A460,
  'seagreen': 0x2E8B57,
  'seashell': 0xFFF5EE,
  'sienna': 0xA0522D,
  'silver': 0xC0C0C0,
  'skyblue': 0x87CEEB,
  'slateblue': 0x6A5ACD,
  'slategray': 0x708090,
  'slategrey': 0x708090,
  'snow': 0xFFFAFA,
  'springgreen': 0x00FF7F,
  'steelblue': 0x4682B4,
  'tan': 0xD2B48C,
  'teal': 0x008080,
  'thistle': 0xD8BFD8,
  'tomato': 0xFF6347,
  'turquoise': 0x40E0D0,
  'violet': 0xEE82EE,
  'wheat': 0xF5DEB3,
  'white': 0xFFFFFF,
  'whitesmoke': 0xF5F5F5,
  'yellow': 0xFFFF00,
  'yellowgreen': 0x9ACD32,
};

/// Parses a CSS `transform` list into a matrix: `translate(12px, -4px)`,
/// `translateX/Y`, `translate3d`, `scale`/`scaleX`/`scaleY`, `rotate`
/// (deg/rad/turn/grad) and the `matrix(a,b,c,d,e,f)` 2D form. Functions
/// compose left to right, as in CSS. Returns null for `none`, an empty
/// value, or a list with nothing recognizable in it.
Matrix4? parseTransform(Object? value) {
  if (value == null) return null;
  final text = value.toString().trim();
  if (text.isEmpty || text == 'none') return null;
  final result = Matrix4.identity();
  var matched = false;
  for (final m in _transformFn.allMatches(text)) {
    final name = m.group(1)!.toLowerCase();
    final args = m
        .group(2)!
        .split(',')
        .map((a) => a.trim())
        .where((a) => a.isNotEmpty)
        .toList();
    if (args.isEmpty) continue;
    double len(int i) => (i < args.length ? parseLength(args[i]) : null) ?? 0;
    double num_(int i, double fallback) =>
        (i < args.length ? double.tryParse(args[i]) : null) ?? fallback;
    switch (name) {
      case 'translate':
      case 'translate3d':
        result.multiply(Matrix4.translationValues(len(0), len(1), 0));
      case 'translatex':
        result.multiply(Matrix4.translationValues(len(0), 0, 0));
      case 'translatey':
        result.multiply(Matrix4.translationValues(0, len(0), 0));
      case 'scale':
        final sx = num_(0, 1);
        result.multiply(Matrix4.diagonal3Values(sx, num_(1, sx), 1));
      case 'scalex':
        result.multiply(Matrix4.diagonal3Values(num_(0, 1), 1, 1));
      case 'scaley':
        result.multiply(Matrix4.diagonal3Values(1, num_(0, 1), 1));
      case 'rotate':
      case 'rotatez':
        final angle = parseAngle(args[0]);
        if (angle == null) continue;
        result.multiply(Matrix4.rotationZ(angle));
      case 'matrix':
        if (args.length < 6) continue;
        final v = [for (var i = 0; i < 6; i++) num_(i, 0)];
        result.multiply(
          Matrix4(
            v[0],
            v[1],
            0,
            0, //
            v[2],
            v[3],
            0,
            0, //
            0,
            0,
            1,
            0, //
            v[4],
            v[5],
            0,
            1,
          ),
        );
      default:
        continue;
    }
    matched = true;
  }
  return matched ? result : null;
}

final RegExp _transformFn = RegExp(r'([a-zA-Z0-9]+)\(([^)]*)\)');

/// The percentage components of a transform's translations, as fractions of
/// the box's own size (`translate(-50%, -50%)` → `Offset(-0.5, -0.5)`).
/// [parseTransform] treats these as 0 — a matrix is built at parse time,
/// before any size exists — and the renderer applies this part with
/// [FractionalTranslation] outside the matrix. That ordering is exact when
/// the `%` translations come first in the list (the centring idiom every
/// component library uses); a `%` translation after a rotate/scale would
/// be applied unrotated, the registered approximation.
Offset? parseTransformFraction(Object? value) {
  if (value == null) return null;
  final text = value.toString();
  if (!text.contains('%')) return null;
  var dx = 0.0, dy = 0.0;
  double pct(String? arg) {
    if (arg == null) return 0;
    final a = arg.trim();
    if (!a.endsWith('%')) return 0;
    return (double.tryParse(a.substring(0, a.length - 1)) ?? 0) / 100;
  }

  for (final m in _transformFn.allMatches(text)) {
    final name = m.group(1)!.toLowerCase();
    final args = m.group(2)!.split(',');
    switch (name) {
      case 'translate':
      case 'translate3d':
        dx += pct(args[0]);
        dy += pct(args.length > 1 ? args[1] : null);
      case 'translatex':
        dx += pct(args[0]);
      case 'translatey':
        dy += pct(args[0]);
    }
  }
  return dx == 0 && dy == 0 ? null : Offset(dx, dy);
}

FjsTransitions? parseTransitions(Map<String, Object?> style) {
  final shorthand = style['transition'];
  final propertyValue = style['transitionProperty'];
  final durationValue = style['transitionDuration'];
  final timingValue = style['transitionTimingFunction'];
  final delayValue = style['transitionDelay'];

  List<FjsTransitionTrack>? fromShorthand;
  if (shorthand != null) {
    final tracks = <FjsTransitionTrack>[];
    for (final part in splitCssList(shorthand.toString())) {
      final track = _parseTransitionShorthand(part);
      if (track != null) tracks.add(track);
    }
    if (tracks.isNotEmpty) fromShorthand = tracks;
  }

  if (propertyValue == null &&
      durationValue == null &&
      timingValue == null &&
      delayValue == null) {
    return fromShorthand == null ? null : FjsTransitions(fromShorthand);
  }
  if (fromShorthand != null) {
    return FjsTransitions(
      _overrideLonghands(
        fromShorthand,
        propertyValue,
        durationValue,
        timingValue,
        delayValue,
      ),
    );
  }
  final properties = _cssValueList(propertyValue)
      .map(_normalizeTransitionProperty)
      .where((property) => property != 'none')
      .toList();
  final durations = _cssValueList(
    durationValue,
  ).map(parseDuration).whereType<Duration>().toList();
  final timings = _cssValueList(
    timingValue,
  ).map(parseTimingFunction).whereType<Curve>().toList();
  final delays = _cssValueList(
    delayValue,
  ).map(parseDuration).whereType<Duration>().toList();
  final count = [
    properties.length,
    durations.length,
    timings.length,
    delays.length,
    1,
  ].reduce((a, b) => a > b ? a : b);
  final tracks = <FjsTransitionTrack>[];
  for (var i = 0; i < count; i++) {
    tracks.add(
      FjsTransitionTrack(
        property: properties.isEmpty
            ? 'all'
            : properties[i % properties.length],
        duration: durations.isEmpty
            ? Duration.zero
            : durations[i % durations.length],
        curve: timings.isEmpty ? Curves.ease : timings[i % timings.length],
        delay: delays.isEmpty ? Duration.zero : delays[i % delays.length],
      ),
    );
  }
  return FjsTransitions(tracks);
}

/// A `transition` shorthand refined by `transition-*` longhands. The computed
/// map keeps both as declared, and the idioms that mix them declare the
/// longhand AFTER the shorthand — vant's `.van-dialog { transition: .3s;
/// transition-property: transform, opacity }`, and its enter/leave classes
/// that swap only `transition-timing-function` (ease-out in, ease-in out).
/// As in CSS, the property list sets the layer count and the other lists
/// repeat to fill it.
List<FjsTransitionTrack> _overrideLonghands(
  List<FjsTransitionTrack> base,
  Object? propertyValue,
  Object? durationValue,
  Object? timingValue,
  Object? delayValue,
) {
  final properties = propertyValue == null
      ? null
      : _cssValueList(propertyValue)
            .map(_normalizeTransitionProperty)
            .where((property) => property != 'none')
            .toList();
  final durations = durationValue == null
      ? null
      : _cssValueList(durationValue)
            .map(parseDuration)
            .whereType<Duration>()
            .toList();
  final timings = timingValue == null
      ? null
      : _cssValueList(timingValue)
            .map(parseTimingFunction)
            .whereType<Curve>()
            .toList();
  final delays = delayValue == null
      ? null
      : _cssValueList(delayValue)
            .map(parseDuration)
            .whereType<Duration>()
            .toList();
  final count = properties != null && properties.isNotEmpty
      ? properties.length
      : base.length;
  T pick<T>(List<T>? list, int i, T fallback) =>
      list == null || list.isEmpty ? fallback : list[i % list.length];
  return [
    for (var i = 0; i < count; i++)
      FjsTransitionTrack(
        property: pick(properties, i, base[i % base.length].property),
        duration: pick(durations, i, base[i % base.length].duration),
        curve: pick(timings, i, base[i % base.length].curve),
        delay: pick(delays, i, base[i % base.length].delay),
      ),
  ];
}

FjsTransitionTrack? _parseTransitionShorthand(String value) {
  final tokens = _splitWhitespace(value);
  if (tokens.isEmpty) return null;
  var property = 'all';
  var duration = Duration.zero;
  var delay = Duration.zero;
  Curve curve = Curves.ease;
  var sawDuration = false;

  for (final token in tokens) {
    final time = parseDuration(token);
    if (time != null) {
      if (!sawDuration) {
        duration = time;
        sawDuration = true;
      } else {
        delay = time;
      }
      continue;
    }
    final timing = parseTimingFunction(token);
    if (timing != null) {
      curve = timing;
      continue;
    }
    final normalized = _normalizeTransitionProperty(token);
    if (normalized == 'none') return null;
    property = normalized;
  }

  return FjsTransitionTrack(
    property: property,
    duration: duration,
    curve: curve,
    delay: delay,
  );
}

Duration? _parseDurationUncached(Object value) {
  if (value is Duration) return value;
  if (value is num) return Duration(milliseconds: value.round());
  final text = value.toString().trim().toLowerCase();
  if (text.isEmpty) return null;
  double? n(String suffix) =>
      double.tryParse(text.substring(0, text.length - suffix.length).trim());
  if (text.endsWith('ms')) {
    final v = n('ms');
    return v == null ? null : Duration(microseconds: (v * 1000).round());
  }
  if (text.endsWith('s')) {
    final v = n('s');
    return v == null ? null : Duration(microseconds: (v * 1000000).round());
  }
  final v = double.tryParse(text);
  return v == null ? null : Duration(milliseconds: v.round());
}

Curve? _parseTimingFunctionUncached(Object value) {
  if (value is Curve) return value;
  final text = value.toString().trim().toLowerCase();
  switch (text) {
    case 'linear':
      return Curves.linear;
    case 'ease':
      return Curves.ease;
    case 'ease-in':
      return Curves.easeIn;
    case 'ease-out':
      return Curves.easeOut;
    case 'ease-in-out':
      return Curves.easeInOut;
    case 'step-start':
      return const FjsStepsCurve(1, jumpStart: true);
    case 'step-end':
      return const FjsStepsCurve(1);
    default:
      return _parseSteps(text) ?? _parseCubicBezier(text);
  }
}

/// `steps(n[, jump-start | start | jump-end | end])`. The other two jump
/// terms (none / both) change the step count's meaning and fall back to end.
Curve? _parseSteps(String text) {
  if (!text.startsWith('steps(') || !text.endsWith(')')) return null;
  final args = text.substring(6, text.length - 1).split(',');
  final n = int.tryParse(args[0].trim());
  if (n == null || n < 1) return null;
  final term = args.length > 1 ? args[1].trim() : 'end';
  return FjsStepsCurve(n, jumpStart: term == 'start' || term == 'jump-start');
}

/// CSS `steps()`: holds each of [steps] levels for an equal share of the
/// interval — the spinner's twelve spokes advance one notch at a time.
class FjsStepsCurve extends Curve {
  const FjsStepsCurve(this.steps, {this.jumpStart = false});

  final int steps;
  final bool jumpStart;

  @override
  double transformInternal(double t) {
    final step = (t * steps).floor() + (jumpStart ? 1 : 0);
    return (step / steps).clamp(0.0, 1.0);
  }
}

Curve? _parseCubicBezier(String text) {
  if (!text.startsWith('cubic-bezier(') || !text.endsWith(')')) return null;
  final args = text.substring(13, text.length - 1).split(',');
  if (args.length != 4) return null;
  final values = args.map((arg) => double.tryParse(arg.trim())).toList();
  if (values.any((v) => v == null)) return null;
  final x1 = values[0]!.clamp(0.0, 1.0);
  final x2 = values[2]!.clamp(0.0, 1.0);
  return Cubic(x1, values[1]!, x2, values[3]!);
}

List<String> _cssValueList(Object? value) {
  if (value == null) return const [];
  if (value is Iterable) {
    return [
      for (final item in value)
        if (item != null) ...splitCssList(item.toString()),
    ];
  }
  return splitCssList(value.toString());
}

List<String> splitCssList(String text) {
  final parts = <String>[];
  var depth = 0;
  var start = 0;
  for (var i = 0; i < text.length; i++) {
    final ch = text[i];
    if (ch == '(') {
      depth++;
    } else if (ch == ')') {
      depth = depth > 0 ? depth - 1 : 0;
    } else if (ch == ',' && depth == 0) {
      final part = text.substring(start, i).trim();
      if (part.isNotEmpty) parts.add(part);
      start = i + 1;
    }
  }
  final last = text.substring(start).trim();
  if (last.isNotEmpty) parts.add(last);
  return parts;
}

List<String> _splitWhitespace(String text) {
  final parts = <String>[];
  final b = StringBuffer();
  var depth = 0;
  for (var i = 0; i < text.length; i++) {
    final ch = text[i];
    if (ch == '(') depth++;
    if (ch == ')') depth = depth > 0 ? depth - 1 : 0;
    if (depth == 0 && ch.trim().isEmpty) {
      if (b.isNotEmpty) {
        parts.add(b.toString());
        b.clear();
      }
    } else {
      b.write(ch);
    }
  }
  if (b.isNotEmpty) parts.add(b.toString());
  return parts;
}

String _normalizeTransitionProperty(String value) {
  final text = value.trim();
  if (text.isEmpty) return 'all';
  return text.replaceAllMapped(
    RegExp(r'-+([a-zA-Z])'),
    (m) => m.group(1)!.toUpperCase(),
  );
}

/// `45deg` / `0.5turn` / `1.2rad` / `50grad`, and a bare number as degrees
/// (which CSS does not allow, but the inline style API hands over).
double? _parseAngleUncached(Object value) {
  if (value is num) return value * pi / 180;
  final text = value.toString().trim().toLowerCase();
  if (text.isEmpty) return null;
  double? n(String suffix) =>
      double.tryParse(text.substring(0, text.length - suffix.length).trim());
  if (text.endsWith('deg')) return n('deg')?.let((v) => v * pi / 180);
  if (text.endsWith('grad')) return n('grad')?.let((v) => v * pi / 200);
  if (text.endsWith('turn')) return n('turn')?.let((v) => v * 2 * pi);
  if (text.endsWith('rad')) return n('rad');
  return double.tryParse(text)?.let((v) => v * pi / 180);
}

extension _Let<T> on T {
  R let<R>(R Function(T) f) => f(this);
}

// ---- memoized front doors ---------------------------------------------------
//
// Each of these keeps its real implementation under a private name and is
// reached through a cache. Null in / null out short-circuits before the
// lookup, since null is by far the most common argument (most nodes declare
// only a handful of the ~60 properties FjsStyle can read).

final _parseColorMemo = _memo<Color?>(_parseColorUncached);
Color? parseColor(Object? value) =>
    value == null ? null : _parseColorMemo(value);

final _parseLengthMemo = _memo<double?>(_parseLengthUncached);
double? parseLength(Object? value) =>
    value == null ? null : _parseLengthMemo(value);

/// A length that may be relative (`50%`, `calc(100% - 32px)`); see
/// [FjsLength]. Properties that cannot wait for a layout pass keep using
/// [parseLength], which reads a relative value as "not a number" and so
/// falls back to the same auto behaviour it had before percentages existed.
final _parseFjsLengthMemo = _memo<FjsLength?>(parseFjsLength);
FjsLength? parseLengthValue(Object? value) =>
    value == null ? null : _parseFjsLengthMemo(value);

final _parseFontWeightMemo = _memo<FontWeight?>(_parseFontWeightUncached);
FontWeight? parseFontWeight(Object? value) =>
    value == null ? null : _parseFontWeightMemo(value);

final _parseFontStyleMemo = _memo<FontStyle?>(_parseFontStyleUncached);
FontStyle? parseFontStyle(Object? value) =>
    value == null ? null : _parseFontStyleMemo(value);

final _parseTextDecorationMemo = _memo<TextDecoration?>(
  _parseTextDecorationUncached,
);
TextDecoration? parseTextDecoration(Object? value) =>
    value == null ? null : _parseTextDecorationMemo(value);

final _parseGradientMemo = _memo<Gradient?>(_parseGradientUncached);
Gradient? parseGradient(Object? value) =>
    value == null ? null : _parseGradientMemo(value);

final _parseBorderStyleMemo = _memo<FjsBorderStyle?>(_parseBorderStyleUncached);
FjsBorderStyle? parseBorderStyle(Object? value) =>
    value == null ? null : _parseBorderStyleMemo(value);

final _parseBorderMemo =
    _memo<({double width, Color? color, FjsBorderStyle kind})?>(
      _parseBorderUncached,
    );
({double width, Color? color, FjsBorderStyle kind})? parseBorder(
  Object? value,
) => value == null ? null : _parseBorderMemo(value);

final _parseBorderRadiusMemo = _memo<BorderRadius?>(_parseBorderRadiusUncached);
BorderRadius? parseBorderRadius(Object? value) =>
    value == null ? null : _parseBorderRadiusMemo(value);

final _parseDurationMemo = _memo<Duration?>(_parseDurationUncached);
Duration? parseDuration(Object? value) =>
    value == null ? null : _parseDurationMemo(value);

final _parseTimingFunctionMemo = _memo<Curve?>(_parseTimingFunctionUncached);
Curve? parseTimingFunction(Object? value) =>
    value == null ? null : _parseTimingFunctionMemo(value);

final _parseAngleMemo = _memo<double?>(_parseAngleUncached);
double? parseAngle(Object? value) =>
    value == null ? null : _parseAngleMemo(value);

final _parseBoxShadowsMemo = _memo<List<BoxShadow>?>((value) {
  final parsed = _parseBoxShadowsUncached(value);
  // shared across every node with this style, so freeze it
  return parsed == null ? null : List<BoxShadow>.unmodifiable(parsed);
});
List<BoxShadow>? parseBoxShadows(Object? value) =>
    value == null ? null : _parseBoxShadowsMemo(value);

// parseTransform is deliberately NOT memoized: a transform string is usually
// a per-frame animated value, so the hit rate would be near zero while the
// cache churned.


/// Names meaning "the platform's default" — Flutter's own behavior with no
/// family, so a stack stops at the first one (see FjsStyle.fontFamily).
const _systemFamilies = {
  '-apple-system',
  '-apple-system-font',
  'blinkmacsystemfont',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-rounded',
  'sans-serif',
  'serif',
  'cursive',
  'fantasy',
  'emoji',
  'math',
  'fangsong',
};

/// A CSS `font-family` value as the family names Flutter should try, in
/// order: quotes stripped, cut at the first system/generic name, the
/// generic `monospace` mapped to this platform's monospaced font.
List<String> parseFontFamilyStack(Object? value) {
  if (value == null) return const [];
  final out = <String>[];
  for (final raw in value.toString().split(',')) {
    var name = raw.trim();
    if (name.length >= 2 &&
        (name[0] == '"' || name[0] == "'") &&
        name[name.length - 1] == name[0]) {
      name = name.substring(1, name.length - 1).trim();
    }
    if (name.isEmpty) continue;
    final low = name.toLowerCase();
    if (low == 'monospace' || low == 'ui-monospace') {
      out.add(switch (defaultTargetPlatform) {
        TargetPlatform.iOS || TargetPlatform.macOS => 'Menlo',
        TargetPlatform.windows => 'Courier New',
        _ => 'monospace',
      });
      break;
    }
    if (_systemFamilies.contains(low)) break;
    out.add(name);
  }
  return out;
}
