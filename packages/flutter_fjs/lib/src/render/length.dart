// Lengths that only a layout pass can turn into pixels: `50%` and `calc()`.
//
// Everything else in style_parse.dart resolves to a number at build time,
// because it can: `12px` is 12 wherever it lands. A percentage cannot — it
// needs the box it is a percentage OF, and that box's size is not known
// until the parent lays this one out. So a relative length stays a pair,
//
//     px + percent * reference
//
// and the widget layer resolves it inside a LayoutBuilder (see
// decoration.dart). One pair covers `calc()` too: every expression CSS
// allows on a length reduces to one absolute term plus one relative term,
// so `calc(100% - 32px)` is (px: -32, percent: 1) and needs no tree kept
// around, no re-parse per frame, and no arithmetic at layout time beyond a
// multiply and an add.
//
// The reference is the incoming constraint — the space the parent offers on
// that axis, which for a block in a Column (or a row item in a Row) is the
// parent's content box, the same thing CSS resolves against. When that
// constraint is unbounded there is nothing to be a percentage of, and CSS
// says the same: the size falls back to auto.
/// A CSS length, possibly relative to the box that contains it.
class FjsLength {
  const FjsLength(this.px, this.percent);

  const FjsLength.px(this.px) : percent = 0;

  /// The absolute part, in logical pixels.
  final double px;

  /// The relative part as a fraction: `50%` is 0.5, `calc(100% - 8px)` is 1.
  final double percent;

  /// Whether resolving this needs the containing box's size.
  bool get isRelative => percent != 0;

  /// Pixels, given the size of the box this length is relative to. Callers
  /// with an unbounded reference must not call this — see [resolveOrNull].
  double resolve(double reference) => px + percent * reference;

  /// Pixels, or null when this length cannot be resolved against
  /// [reference] (a percentage of an unbounded box is `auto`, per CSS).
  double? resolveOrNull(double reference) {
    if (!isRelative) return px;
    if (!reference.isFinite) return null;
    return px + percent * reference;
  }

  @override
  bool operator ==(Object other) =>
      other is FjsLength && other.px == px && other.percent == percent;

  @override
  int get hashCode => Object.hash(px, percent);

  @override
  String toString() => isRelative
      ? 'FjsLength(${px}px + ${percent * 100}%)'
      : 'FjsLength(${px}px)';
}

/// One padding/margin declaration after the shorthand+longhand merge, with
/// each side kept as an [FjsLength] so `%`/calc values reach the layout
/// pass (spec 044). Absent sides are null — the resolver falls back to the
/// absolute-only value or the tag's default.
typedef FjsEdgeLengths = ({
  FjsLength? top,
  FjsLength? right,
  FjsLength? bottom,
  FjsLength? left,
});

extension FjsEdgeLengthsX on FjsEdgeLengths {
  /// Whether any side needs a containing box to resolve against.
  bool get hasRelative =>
      top?.isRelative == true ||
      right?.isRelative == true ||
      bottom?.isRelative == true ||
      left?.isRelative == true;
}

/// Parses a length that may be relative: a number, `12px`, `50%`, or a
/// `calc()` expression over those. Null when the value is not a length.
FjsLength? parseFjsLength(Object? value) {
  if (value == null) return null;
  if (value is num) return FjsLength.px(value.toDouble());
  if (value is! String) return null;
  final v = value.trim();
  if (v.isEmpty) return null;
  final lower = v.toLowerCase();
  if (lower.startsWith('calc(') && lower.endsWith(')')) {
    return _evalCalc(v.substring(5, v.length - 1));
  }
  return _term(v);
}

/// One `calc()` term: `12`, `12px`, `50%`. Null when it is anything else —
/// including units this runtime does not resolve (em/vw/…), which must fail
/// the whole expression rather than silently count as pixels.
FjsLength? _term(String raw) {
  final v = raw.trim();
  if (v.isEmpty) return null;
  if (v.endsWith('%')) {
    final n = double.tryParse(v.substring(0, v.length - 1).trim());
    return n == null ? null : FjsLength(0, n / 100);
  }
  if (v.toLowerCase().endsWith('px')) {
    final n = double.tryParse(v.substring(0, v.length - 2).trim());
    return n == null ? null : FjsLength.px(n);
  }
  final n = double.tryParse(v);
  return n == null ? null : FjsLength.px(n);
}

// ---- calc() ---------------------------------------------------------------
//
// A recursive-descent parser over `+ - * /` and parentheses. It stays this
// small because the result type does: adding two lengths adds both parts,
// and CSS only allows multiplying or dividing by a plain number, so one
// side of a `*` or `/` is always relative-free.

FjsLength? _evalCalc(String source) {
  final tokens = _tokenize(source);
  if (tokens == null || tokens.isEmpty) return null;
  final parser = _CalcParser(tokens);
  final value = parser.sum();
  if (value == null || !parser.done) return null;
  return value;
}

List<String>? _tokenize(String source) {
  final out = <String>[];
  final buf = StringBuffer();
  void flush() {
    if (buf.isEmpty) return;
    out.add(buf.toString());
    buf.clear();
  }

  for (var i = 0; i < source.length; i++) {
    final c = source[i];
    if (c == ' ' || c == '\t' || c == '\n') {
      flush();
      continue;
    }
    if (c == '(' || c == ')' || c == '*' || c == '/') {
      flush();
      out.add(c);
      continue;
    }
    if (c == '+' || c == '-') {
      // A sign glued to a number is part of it (`calc(-8px + 50%)`); an
      // operator is what CSS requires to be surrounded by spaces, which is
      // exactly the case where the buffer already holds a term.
      if (buf.isEmpty &&
          (out.isEmpty || _isOperator(out.last) || out.last == '(')) {
        buf.write(c);
        continue;
      }
      flush();
      out.add(c);
      continue;
    }
    buf.write(c);
  }
  flush();
  return out;
}

bool _isOperator(String token) =>
    token == '+' || token == '-' || token == '*' || token == '/';

class _CalcParser {
  _CalcParser(this.tokens);

  final List<String> tokens;
  int _at = 0;

  bool get done => _at == tokens.length;

  String? get _peek => _at < tokens.length ? tokens[_at] : null;

  FjsLength? sum() {
    var left = product();
    if (left == null) return null;
    while (_peek == '+' || _peek == '-') {
      final op = tokens[_at++];
      final right = product();
      if (right == null) return null;
      left = op == '+'
          ? FjsLength(left!.px + right.px, left.percent + right.percent)
          : FjsLength(left!.px - right.px, left.percent - right.percent);
    }
    return left;
  }

  FjsLength? product() {
    var left = atom();
    if (left == null) return null;
    while (_peek == '*' || _peek == '/') {
      final op = tokens[_at++];
      final right = atom();
      if (right == null) return null;
      if (op == '*') {
        // one side has to be a plain number; `50% * 50%` is not a length
        if (!right.isRelative) {
          left = FjsLength(left!.px * right.px, left.percent * right.px);
        } else if (!left!.isRelative) {
          left = FjsLength(right.px * left.px, right.percent * left.px);
        } else {
          return null;
        }
      } else {
        if (right.isRelative || right.px == 0) return null;
        left = FjsLength(left!.px / right.px, left.percent / right.px);
      }
    }
    return left;
  }

  FjsLength? atom() {
    final token = _peek;
    if (token == null) return null;
    if (token == '(') {
      _at++;
      final inner = sum();
      if (inner == null || _peek != ')') return null;
      _at++;
      return inner;
    }
    if (_isOperator(token)) return null;
    _at++;
    return _term(token);
  }
}
