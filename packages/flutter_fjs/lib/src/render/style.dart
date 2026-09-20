// Style resolution for the widget layer. Property reference: docs/ui-api.md.
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import 'length.dart';
import 'style_parse.dart';

/// Splits a shorthand value into components at top-level whitespace —
/// whitespace inside parentheses (a `calc(50% - 8px)` component) does not
/// split. Bare `String.split` cut calc() into pieces and silently dropped
/// the whole declaration.
List<String> _splitShorthand(String v) {
  final parts = <String>[];
  final buf = StringBuffer();
  var depth = 0;
  for (var i = 0; i < v.length; i++) {
    final c = v[i];
    if (c == '(') depth++;
    if (c == ')') depth = depth > 0 ? depth - 1 : 0;
    if (depth == 0 && RegExp(r'\s').hasMatch(c)) {
      if (buf.isNotEmpty) parts.add(buf.toString());
      buf.clear();
      continue;
    }
    buf.write(c);
  }
  if (buf.isNotEmpty) parts.add(buf.toString());
  return parts;
}

/// `border-color`'s fallback when only a width is given.
const _defaultBorderColor = Color(0xFFDDDDDD);

/// The single-side border keys, shorthands and longhands.
const _borderSideKeys = [
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
];

/// One resolved side (`border-bottom: 1px solid #eee`).
typedef FjsBorderSide = ({double width, Color color, FjsBorderStyle kind});

/// The four sides of a box's border, [FjsStyle.boxBorders]' output. `null`
/// sides have no border; a `null` [FjsBoxBorders] itself means the box said
/// nothing and nothing is painted.
class FjsBoxBorders {
  const FjsBoxBorders({this.top, this.right, this.bottom, this.left});

  final FjsBorderSide? top;
  final FjsBorderSide? right;
  final FjsBorderSide? bottom;
  final FjsBorderSide? left;

  bool get isNone =>
      top == null && right == null && bottom == null && left == null;

  /// All four sides present and identical — the only shape [Border.all] can
  /// draw. A missing side is a real difference: the other three may not use
  /// the decoration route with a radius (a non-uniform [Border] asserts).
  bool get isUniform {
    if (top == null) return isNone;
    bool same(FjsBorderSide? s) =>
        s != null &&
        s.width == top!.width &&
        s.color == top!.color &&
        s.kind == top!.kind;
    return same(right) && same(bottom) && same(left);
  }

  bool get hasDashed => [
    top,
    right,
    bottom,
    left,
  ].any((s) => s != null && s.kind != FjsBorderStyle.solid);

  /// The uniform sides as Flutter's `Border.all`, or null when not uniform.
  Border? get uniformBorder => !isUniform || isNone
      ? null
      : Border.all(color: top!.color, width: top!.width);

  @override
  bool operator ==(Object other) =>
      other is FjsBoxBorders &&
      other.top == top &&
      other.right == right &&
      other.bottom == bottom &&
      other.left == left;

  @override
  int get hashCode => Object.hash(top, right, bottom, left);
}

/// Reads the merged `style` map (plus legacy top-level props) of a node and
/// maps CSS properties onto Flutter values. Parsing of raw CSS values lives
/// in style_parse.dart; this class only resolves which value to use.
class FjsStyle {
  /// Reads a raw props map. Kept for hand-built props (tests, Dart-registered
  /// components); prefer [FjsStyle.of], which picks up the interned style the
  /// op protocol delivers instead of a copy inside `props`.
  FjsStyle(this.props) {
    final s = props['style'];
    if (s is Map<String, Object?>) style = s;
  }

  /// The node's computed style, taken from the interned entry when there is
  /// one. Nodes that resolved to the same style share one map instance.
  FjsStyle.of(MirrorNode node) : props = node.props {
    style = node.styleMap;
  }

  /// The style this node has while pressed: its computed style with the
  /// `:active` one the JS style engine sent alongside it laid over the top.
  /// Same map as [FjsStyle] when the node matched no `:active` rule.
  FjsStyle.pressed(this.props) {
    final s = props['style'];
    final base = s is Map<String, Object?> ? s : const <String, Object?>{};
    final active = props['activeStyle'];
    style = active is Map<String, Object?> ? {...base, ...active} : base;
  }

  /// [FjsStyle.pressed] over a node's interned styles.
  FjsStyle.pressedOf(MirrorNode node) : props = node.props {
    final base = node.styleMap;
    final active = node.activeStyleMap;
    style = active == null ? base : {...base, ...active};
  }

  /// The style for the node's current interaction state, layering
  /// `:hover` (op 12) under `:active`: while pressed the pointer is still
  /// over the node on desktop, and the pressed state wins on both ends
  /// (css-compat.md §4). Touch press does not set [hovered], matching
  /// browsers that keep `:hover` off touch input.
  FjsStyle.stateOf(
    MirrorNode node, {
    bool pressed = false,
    bool hovered = false,
  }) : props = node.props {
    final base = node.styleMap;
    final hover = hovered ? node.hoverStyleMap : null;
    final active = pressed ? node.activeStyleMap : null;
    style = hover == null && active == null
        ? base
        : {...base, ...?hover, ...?active};
    keepsBox = true;
  }

  /// A press/hover-tracking node's style: its decoration layer keeps the
  /// same widget shape whether or not the current state paints anything.
  /// A `:active` background that comes and goes would otherwise add and drop
  /// the decorated box ABOVE the children, remounting the whole subtree on
  /// release — vant's collapse arrow lost its rotate transition to that
  /// (the release and the expand land in one frame).
  bool keepsBox = false;

  /// Whether the node carries a page-authored `:active` style. Buttons also
  /// track press for the default WeUI mask, even when this is false.
  static bool hasPressedStyle(Map<String, Object?> props) =>
      props['activeStyle'] is Map;

  /// [hasPressedStyle] for a node, covering the interned path.
  static bool nodeHasPressedStyle(MirrorNode node) =>
      node.activeStyle != null || node.props['activeStyle'] is Map;

  /// Whether the node carries a page-authored `:hover` style (op 12). Only
  /// these nodes get a MouseRegion — wrapping every node would cost a
  /// widget layer per element for a state most pages never use.
  static bool nodeHasHoverStyle(MirrorNode node) => node.hoverStyle != null;

  final Map<String, Object?> props;
  late Map<String, Object?> style = const {};

  Object? _v(String key) => style[key] ?? props[key];

  double? _num(String key) => parseLength(_v(key));

  double get borderWidth => _num('borderWidth') ?? 0;
  Color get borderColor => _color('borderColor') ?? _defaultBorderColor;

  /// The declared border width / color, or null when the node never set one
  /// — lets a widget tell `border-color` alone (which implies a 1px border
  /// in CSS) apart from its own default, and tell `border-width: 0` apart
  /// from "no border-width at all". See [border].
  double? get declaredBorderWidth => _num('borderWidth');
  Color? get declaredBorderColor => _color('borderColor');

  /// Absolute width/height, in logical pixels. A relative one (`50%`,
  /// `calc(...)`) reads as null here — it cannot be known before layout, and
  /// null is what every consumer already treats as "auto". Use
  /// [widthLength] / [heightLength] to pick those up.
  double? get width => _num('width');
  double? get height => _num('height');

  /// Width/height as declared, keeping a percentage relative. Null when the
  /// property is absent or unparseable.
  FjsLength? get widthLength => parseLengthValue(_v('width'));
  FjsLength? get heightLength => parseLengthValue(_v('height'));

  /// Per-corner border-radius parts, percentages KEPT (`50%` → fraction
  /// 0.5). Null when no border-radius is declared. A fraction references
  /// the box's own size, which only exists at layout time — decoration.dart
  /// resolves it there.
  List<BorderRadiusPart>? get borderRadiusParts => _v('borderRadius') == null
      ? null
      : parseBorderRadiusParts(_v('borderRadius'));
  double? get fontSize => _num('fontSize');
  int? get maxLines => _v('maxLines') is int ? _v('maxLines') as int : null;
  TextOverflow? get overflow {
    final v = _v('overflow')?.toString();
    if (v == 'ellipsis') return TextOverflow.ellipsis;
    if (v == 'clip') return TextOverflow.clip;
    return null;
  }

  /// The border to paint, or null for none. `kind` is how it is stroked —
  /// a dashed or dotted one is painted by [FjsDashedBorderPainter] instead
  /// of a [Border], which only knows solid.
  ///
  /// The longhands win over the `border` shorthand: a tag default sets the
  /// shorthand (see the H table in the runtime's vue/renderer.ts) and a
  /// stylesheet usually sets one longhand — `border-color: #007aff` on a
  /// button means "the default hairline, in blue". Setting the shorthand
  /// itself replaces the default outright, so `border: none` and
  /// `border-width: 0` both leave nothing.
  ({double width, Color color, FjsBorderStyle kind})? get border {
    final shorthand = borderShorthand;
    final declaredWidth = declaredBorderWidth;
    final declaredColor = declaredBorderColor;
    final declaredKind = _v('borderStyle');
    // `border-style: none` is CSS's other way of saying there is no border
    if (declaredKind != null) {
      final word = declaredKind.toString().trim().toLowerCase();
      if (word == 'none' || word == 'hidden') return null;
    }
    final width =
        declaredWidth ??
        shorthand?.width ??
        (declaredColor != null || declaredKind != null ? 1.0 : null);
    if (width == null || width <= 0) return null;
    return (
      width: width,
      color:
          declaredColor ??
          (shorthand != null ? shorthand.color ?? currentColor : null) ??
          _defaultBorderColor,
      kind:
          parseBorderStyle(declaredKind) ??
          shorthand?.kind ??
          FjsBorderStyle.solid,
    );
  }

  /// Whether the page said anything at all about the border, including the
  /// single-side shorthands and longhands.
  ///
  /// A built-in tag's default hairline (button) applies only to sides the
  /// page said nothing about — otherwise `border: none`, which resolves to
  /// "no side painted" the same way "never set" does, could not turn the
  /// default off.
  bool get hasBorderDeclaration =>
      _v('border') != null ||
      _v('borderWidth') != null ||
      _v('borderColor') != null ||
      _v('borderStyle') != null ||
      _borderSideKeys.any((k) => _v(k) != null);

  /// Whether any single-side border key was declared. An inline `<text>`
  /// span warns about ignored box properties, and these are box properties.
  bool get hasSideBorderDeclaration =>
      _borderSideKeys.any((k) => _v(k) != null);

  /// The four CSS sides, each resolved through
  /// `border-<side>-width/color/style` > `border-<side>` >
  /// `border-width/color/style` > `border`. Sides the page said nothing
  /// about fall to [defaultBorderColor] (a built-in's hairline fills only
  /// the undeclared sides, so `border-bottom: none` on a button keeps the
  /// other three). Null when nothing ends up painted anywhere.
  ///
  /// CSS orders these by source order, which a merged style map cannot
  /// express — the fixed precedence above is the same approximation the
  /// global `border` / `border-width` pair already makes.
  FjsBoxBorders? boxBorders({Color? defaultBorderColor}) {
    final gShort = borderShorthand;

    FjsBorderSide? resolve(String s) {
      // `border-width` / `-color` / `-style` take 1–4 values like margin
      // does (`border-width: 1px 0 0` is vant's divider line); read this
      // side's component. A single value is every side's.
      final i = const {'Top': 0, 'Right': 1, 'Bottom': 2, 'Left': 3}[s]!;
      final gWidth = parseLength(_boxSideValue(_v('borderWidth'), i));
      final gColor = parseColor(_boxSideValue(_v('borderColor'), i));
      final gKindRaw = _boxSideValue(_v('borderStyle'), i);
      final gKind = parseBorderStyle(gKindRaw);
      final sWidth = _num('border${s}Width');
      final sColor = _color('border${s}Color');
      final sKindRaw = _v('border${s}Style');
      final sKind = parseBorderStyle(sKindRaw);
      final sShortRaw = _v('border$s');
      final sShort = parseBorder(sShortRaw);

      double? width;
      if (sWidth != null) {
        // a longhand width of 0 is the page turning THIS side off
        width = sWidth > 0 ? sWidth : 0;
      } else if (sShortRaw != null) {
        // `border-bottom: none` / `hidden` parse to null — declared, and off
        width = sShort?.width ?? 0;
      } else if (sColor != null || sKindRaw != null) {
        width =
            1; // a lone color or style means the default hairline, as in CSS
      } else if (gWidth != null) {
        width = gWidth > 0 ? gWidth : 0;
      } else if (_v('border') != null) {
        width = gShort?.width ?? 0;
      } else if (gColor != null || gKindRaw != null) {
        width = 1;
      } else {
        // nothing declared anywhere: only here does a built-in default fill in
        return defaultBorderColor == null
            ? null
            : (
                width: 1.0,
                color: defaultBorderColor,
                kind: FjsBorderStyle.solid,
              );
      }
      if (width <= 0) return null;
      final kind = sKindRaw != null
          ? sKind
          : sShortRaw != null
          ? sShort?.kind
          : gKindRaw != null
          ? gKind
          : gShort?.kind ?? FjsBorderStyle.solid;
      if (kind == null) return null; // a `none` / `hidden` style, per side
      return (
        width: width,
        color:
            sColor ??
            (sShort != null ? sShort.color ?? currentColor : null) ??
            gColor ??
            (gShort != null ? gShort.color ?? currentColor : null) ??
            _defaultBorderColor,
        kind: kind,
      );
    }

    final top = resolve('Top');
    final right = resolve('Right');
    final bottom = resolve('Bottom');
    final left = resolve('Left');
    if (top == null && right == null && bottom == null && left == null)
      return null;
    return FjsBoxBorders(top: top, right: right, bottom: bottom, left: left);
  }

  bool get hasDecoration =>
      backgroundColor != null ||
      gradient != null ||
      boxShadows != null ||
      (borderRadius?.bottomRight.x ?? 0) > 0 ||
      border != null;

  /// The axis a scroller scrolls along.
  ///
  /// `scroll-x` / `scroll-y` are PROPS (the mini program's spelling) and win
  /// over the `direction` style key fjs shipped first — they live in
  /// different layers, so both stay valid; see docs/ui-api.md. Only the style
  /// key is visible from here; the props are read by the widget, which passes
  /// the answer in via [scrollDirectionFor].
  Axis get scrollDirection => (_v('direction')?.toString() == 'horizontal')
      ? Axis.horizontal
      : Axis.vertical;

  Color? _color(String key) => parseColor(_v(key));

  /// Side [i] (top, right, bottom, left) of a 1–4 value box shorthand
  /// string; anything else (a number, a single value) is returned as is.
  static Object? _boxSideValue(Object? v, int i) {
    if (v is! String) return v;
    final parts = _splitShorthand(v.trim());
    return switch (parts.length) {
      0 || 1 => v,
      2 => parts[i % 2],
      3 => parts[i == 3 ? 1 : i],
      _ => parts[i],
    };
  }

  Color? get backgroundColor =>
      _color('backgroundColor') ?? _color('background');
  Color? get color => _color('color');

  /// CSS `currentColor`: the element's (inherited, already resolved) text
  /// color — what a border shorthand without a color paints with (vant's
  /// plain tag: `border: 1px solid` on a `::before` inheriting the tag's
  /// blue). Black when no color reached the element.
  Color get currentColor => color ?? const Color(0xFF000000);

  FontWeight? get fontWeight => parseFontWeight(_v('fontWeight'));
  FontStyle? get fontStyle => parseFontStyle(_v('fontStyle'));

  /// The primary family of the declared `font-family` stack, with the
  /// generic `monospace` turned into a font this platform actually has.
  /// Flutter resolves a family by NAME, and no iOS font is called
  /// "monospace": the lookup fails quietly and the text falls back to the
  /// system font — a `<pre>` that looks like a `<p>` on the app while the
  /// browser shows it monospaced. rich-text's `pre` / `code` / `tt` defaults
  /// are what need it.
  ///
  /// The stack is read the CSS way (specs/071): quotes stripped, split at
  /// commas — `"vant-icon"` used to reach Flutter WITH its quotes and match
  /// nothing. A system or generic name (`-apple-system`, `system-ui`,
  /// `sans-serif`, …) ends the stack: it means "the platform's default",
  /// which is what Flutter draws without a family. Stopping there keeps
  /// vant's `-apple-system-font, helvetica neue, arial, sans-serif` on the
  /// system font, as Safari shows it, instead of dropping to Helvetica Neue.
  String? get fontFamily {
    final stack = fontFamilyStack;
    return stack.isEmpty ? null : stack.first;
  }

  /// The rest of [fontFamily]'s stack, for glyphs the primary lacks.
  List<String>? get fontFamilyFallback {
    final stack = fontFamilyStack;
    return stack.length < 2 ? null : stack.sublist(1);
  }

  List<String> get fontFamilyStack => parseFontFamilyStack(_v('fontFamily'));

  /// `sub` / `super` on a span nested in a text (widgets/text.dart); any
  /// other value is ignored.
  String? get verticalAlign => _v('verticalAlign')?.toString();
  double? get letterSpacing => _num('letterSpacing');

  /// Unitless numbers are line-height multipliers; "24px" is absolute.
  double? get lineHeightMultiplier {
    final v = _v('lineHeight');
    if (v is num) return v.toDouble();
    if (v is String) {
      final s = v.trim();
      if (s.endsWith('px')) return null;
      return double.tryParse(s);
    }
    return null;
  }

  double? get lineHeightAbsolute {
    final v = _v('lineHeight');
    if (v is String && v.trim().endsWith('px')) return parseLength(v);
    return null;
  }

  TextDecoration? get textDecoration =>
      parseTextDecoration(_v('textDecoration'));
  String? get textTransform => _v('textTransform')?.toString();
  List<BoxShadow>? get textShadows => parseBoxShadows(_v('textShadow'));
  bool get whiteSpaceNowrap => _v('whiteSpace')?.toString() == 'nowrap';
  bool get textOverflowEllipsis => _v('textOverflow')?.toString() == 'ellipsis';

  TextAlign? get textAlign {
    final v = _v('textAlign')?.toString();
    if (v == 'center') return TextAlign.center;
    if (v == 'right' || v == 'end') return TextAlign.right;
    if (v == 'left' || v == 'start') return TextAlign.left;
    return null;
  }

  BoxFit? get fit {
    final v = _v('fit')?.toString();
    if (v == 'contain') return BoxFit.contain;
    if (v == 'fill') return BoxFit.fill;
    if (v == 'cover') return BoxFit.cover;
    return null;
  }

  EdgeInsets? get padding => _edge('padding');
  EdgeInsets? get margin => _edge('margin');

  /// The same shorthand+longhand merge as [_edge], but each side stays an
  /// [FjsLength] so a `%` or `calc()` survives to the layout pass
  /// (spec 044). Null when the property is not declared at all.
  FjsEdgeLengths? get paddingLengths => _edgeLengths('padding');
  FjsEdgeLengths? get marginLengths => _edgeLengths('margin');

  /// True when any padding/margin side is a `%`/calc value — the gate that
  /// decides whether the box's build wraps a [LayoutBuilder] to resolve
  /// them. Absolute-only spacing takes the plain `Padding` path.
  bool get hasRelativeSpacing =>
      paddingLengths?.hasRelative == true || marginLengths?.hasRelative == true;

  FjsEdgeLengths? _edgeLengths(String key) {
    final base = _edgeShorthandLengths(_v(key));
    final top = parseLengthValue(_v('${key}Top'));
    final right = parseLengthValue(_v('${key}Right'));
    final bottom = parseLengthValue(_v('${key}Bottom'));
    final left = parseLengthValue(_v('${key}Left'));
    if (base == null &&
        top == null &&
        right == null &&
        bottom == null &&
        left == null) {
      return null;
    }
    return (
      top: top ?? base?.top,
      right: right ?? base?.right,
      bottom: bottom ?? base?.bottom,
      left: left ?? base?.left,
    );
  }

  FjsEdgeLengths? _edgeShorthandLengths(Object? v) {
    if (v is num) {
      final all = FjsLength.px(v.toDouble());
      return (top: all, right: all, bottom: all, left: all);
    }
    if (v is String) {
      final parts = _splitShorthand(v);
      final nums = parts.map(parseFjsLength).toList();
      // a component this engine cannot parse ('auto', a unit it does not
      // know) drops the whole shorthand, exactly like [_edgeShorthand] —
      // partial application would silently change which sides get spacing
      if (nums.any((n) => n == null)) return null;
      return switch (nums.length) {
        1 => (top: nums[0]!, right: nums[0]!, bottom: nums[0]!, left: nums[0]!),
        2 => (top: nums[0]!, right: nums[1]!, bottom: nums[0]!, left: nums[1]!),
        // top | horizontal | bottom
        3 => (top: nums[0]!, right: nums[1]!, bottom: nums[2]!, left: nums[1]!),
        // CSS order: top right bottom left -> Flutter: left top right bottom
        4 => (top: nums[0]!, right: nums[1]!, bottom: nums[2]!, left: nums[3]!),
        _ => null,
      };
    }
    if (v is Map) {
      FjsLength? g(String k) => parseFjsLength(v[k]);
      final t = g('top');
      final r = g('right');
      final b = g('bottom');
      final l = g('left');
      if (t == null && r == null && b == null && l == null) return null;
      return (top: t, right: r, bottom: b, left: l);
    }
    return null;
  }

  /// The shorthand (`margin: 8px 0`) plus the longhands (`margin-top`), with
  /// a longhand overriding the side the shorthand set — the common authoring
  /// pattern `margin: 8px; margin-left: 0`. Declaration order within a block
  /// is lost by the time the style map arrives here, so that precedence is
  /// fixed rather than positional; a shorthand written *after* a longhand is
  /// the one case CSS would resolve the other way.
  EdgeInsets? _edge(String key) {
    final base = _edgeShorthand(_v(key));
    final top = _num('${key}Top');
    final right = _num('${key}Right');
    final bottom = _num('${key}Bottom');
    final left = _num('${key}Left');
    if (top == null && right == null && bottom == null && left == null) {
      return base;
    }
    final b = base ?? EdgeInsets.zero;
    return EdgeInsets.fromLTRB(
      left ?? b.left,
      top ?? b.top,
      right ?? b.right,
      bottom ?? b.bottom,
    );
  }

  EdgeInsets? _edgeShorthand(Object? v) {
    if (v is num) return EdgeInsets.all(v.toDouble());
    if (v is String) {
      final parts = _splitShorthand(v);
      final nums = parts.map(parseLength).toList();
      if (nums.length == 1 && nums[0] != null) return EdgeInsets.all(nums[0]!);
      if (nums.length == 2 && nums[0] != null && nums[1] != null) {
        return EdgeInsets.symmetric(vertical: nums[0]!, horizontal: nums[1]!);
      }
      if (nums.length == 3 && nums.every((n) => n != null)) {
        // top | horizontal | bottom
        return EdgeInsets.fromLTRB(nums[1]!, nums[0]!, nums[1]!, nums[2]!);
      }
      if (nums.length == 4 && nums.every((n) => n != null)) {
        // CSS order: top right bottom left -> Flutter: left top right bottom
        return EdgeInsets.fromLTRB(nums[3]!, nums[0]!, nums[1]!, nums[2]!);
      }
      return null;
    }
    if (v is Map) {
      double? g(String k) {
        final x = v[k];
        return x is num ? x.toDouble() : null;
      }

      return EdgeInsets.fromLTRB(
        g('left') ?? 0,
        g('top') ?? 0,
        g('right') ?? 0,
        g('bottom') ?? 0,
      );
    }
    return null;
  }

  BorderRadius? get borderRadius => parseBorderRadius(_v('borderRadius'));

  /// `border: 1px solid #ccc` shorthand fills in width/color when the
  /// longhand props are absent.
  ({double width, Color? color, FjsBorderStyle kind})? get borderShorthand =>
      parseBorder(_v('border'));

  Gradient? get gradient => backgroundLayers != null
      ? null
      : parseGradient(_v('backgroundImage')) ?? parseGradient(_v('background'));

  /// Layered background images (see [FjsBackgroundLayer]); null for the
  /// single full-box gradient [gradient] paints.
  List<FjsBackgroundLayer>? get backgroundLayers => parseBackgroundLayers(
    _v('backgroundImage'),
    _v('backgroundSize'),
    _v('backgroundPosition'),
  );

  List<BoxShadow>? get boxShadows => parseBoxShadows(_v('boxShadow'));

  double? get opacity {
    final v = _num('opacity');
    return v == null ? null : v.clamp(0.0, 1.0);
  }

  /// `transform` — translate/scale/rotate, composed left to right as in
  /// CSS. A translated node repaints instead of relaying out, which is what
  /// makes a drag cheap.
  Matrix4? get transform => parseTransform(_v('transform'));

  /// The `%` part of `transform`'s translations, as a fraction of the box's
  /// own size — CSS resolves `translate(-50%, -50%)` against the element
  /// itself, which the matrix above cannot know at parse time (it drops
  /// these components). Null when there is none.
  Offset? get transformFraction => parseTransformFraction(_v('transform'));

  /// Which axes have BOTH margins `auto` (`margin: 0 auto`). An
  /// out-of-flow box acts on it: with both edges and a size declared, CSS
  /// splits the leftover space between the auto margins — how vant centres
  /// its dialog (`left: 0; right: 0; width: 320px; margin: 0 auto`).
  ({bool horizontal, bool vertical}) get marginAuto {
    final a = marginAutoSides;
    return (horizontal: a.left && a.right, vertical: a.top && a.bottom);
  }

  /// Which individual margins are `auto`. A flex item acts on each side
  /// (see buildFlex): main-axis auto margins soak up the free space, so
  /// `margin-left: auto` pushes an item to the end and `margin: 0 auto`
  /// centres it (vant's nav-bar title). The edge-inset getters drop a
  /// shorthand containing `auto`, so this reads the raw values.
  ({bool top, bool right, bool bottom, bool left}) get marginAutoSides {
    bool isAuto(Object? v) => v is String && v.trim() == 'auto';
    var top = false, right = false, bottom = false, left = false;
    final m = _v('margin');
    if (m is String) {
      final p = _splitShorthand(m).map((s) => s == 'auto').toList();
      switch (p.length) {
        case 1:
          top = right = bottom = left = p[0];
        case 2:
          top = bottom = p[0];
          right = left = p[1];
        case 3:
          top = p[0];
          right = left = p[1];
          bottom = p[2];
        case 4:
          top = p[0];
          right = p[1];
          bottom = p[2];
          left = p[3];
      }
    }
    // a longhand overrides the side the shorthand set (see [_edge])
    final t = _v('marginTop'), r = _v('marginRight');
    final b = _v('marginBottom'), l = _v('marginLeft');
    if (t != null) top = isAuto(t);
    if (r != null) right = isAuto(r);
    if (b != null) bottom = isAuto(b);
    if (l != null) left = isAuto(l);
    return (top: top, right: right, bottom: bottom, left: left);
  }

  /// CSS transition support for paint-only wrappers. The native renderer
  /// currently animates `transform` and `opacity`; layout properties still
  /// jump to their new value.
  FjsTransitions? get transitions => parseTransitions(style);

  /// `touch-action`: which gestures this node takes away from whatever
  /// would otherwise handle them (a scrollable, usually). Parsed in
  /// touch.dart, which owns the arena side of it.
  Object? get touchAction => _v('touchAction');

  String? get display => _v('display')?.toString();

  /// `pointer-events: none` — the node never takes a hit (see the renderer).
  bool get pointerEventsNone => _v('pointerEvents') == 'none';

  /// Whether the box clips its content: any `overflow` other than visible
  /// does in CSS, on either axis — `hidden`, and `auto`/`scroll` too (a
  /// scroll container clips even when it has nothing to scroll: vant's
  /// bottom popup is `overflow-y: auto`, and its rounded corners showed the
  /// picker's square white background until it clipped).
  bool get overflowHidden =>
      _clips(_v('overflow')) ||
      _clips(_v('overflowX')) ||
      _clips(_v('overflowY'));

  static bool _clips(Object? v) {
    final s = v?.toString();
    return s == 'hidden' || s == 'auto' || s == 'scroll' || s == 'clip';
  }

  double? get gap => _num('gap');

  /// `row-gap` / `column-gap`, each falling back to the `gap` shorthand.
  double? get rowGap => _num('rowGap') ?? gap;
  double? get columnGap => _num('columnGap') ?? gap;

  /// The same three, kept as [FjsLength] so `gap: 5%` reaches the layout
  /// pass (spec 079). A percentage gap is a fraction of the container's own
  /// size along the gap's axis (CSS gap semantics: column-gap against the
  /// width, row-gap against the height), which only the flex layout pass
  /// knows — flex.dart resolves it inside its LayoutBuilder.
  FjsLength? get gapLength => parseLengthValue(_v('gap'));

  /// `row-gap` / `column-gap`, each falling back to the `gap` shorthand.
  FjsLength? get rowGapLength => parseLengthValue(_v('rowGap')) ?? gapLength;
  FjsLength? get columnGapLength =>
      parseLengthValue(_v('columnGap')) ?? gapLength;

  /// `flex-wrap`. `wrap-reverse` wraps without reversing the run order
  /// (Flutter's Wrap can do it, but nothing needs it yet).
  bool get flexWrap {
    final v = _v('flexWrap')?.toString();
    return v == 'wrap' || v == 'wrap-reverse';
  }

  /// justify-content / align-items for the wrapped variant. Flutter models
  /// Wrap with its own enums, so the same CSS values map twice.
  WrapAlignment get wrapAlignment {
    switch (_v('justifyContent')?.toString()) {
      case 'center':
        return WrapAlignment.center;
      case 'flex-end':
      case 'end':
        return WrapAlignment.end;
      case 'space-between':
        return WrapAlignment.spaceBetween;
      case 'space-around':
        return WrapAlignment.spaceAround;
      case 'space-evenly':
        return WrapAlignment.spaceEvenly;
      default:
        return WrapAlignment.start;
    }
  }

  WrapCrossAlignment get wrapCrossAlignment {
    switch (_v('alignItems')?.toString()) {
      case 'center':
        return WrapCrossAlignment.center;
      case 'flex-end':
      case 'end':
        return WrapCrossAlignment.end;
      default:
        return WrapCrossAlignment.start;
    }
  }

  /// flexGrow; also accepts the `flex` shorthand (`flex: 1`).
  double? get flexGrow {
    final v = _v('flexGrow');
    if (v is num) return v.toDouble();
    final f = _v('flex');
    if (f is num) return f.toDouble();
    if (f is String) {
      final first = f.trim().split(RegExp(r'\s+')).first;
      final n = double.tryParse(first);
      if (n != null) return n;
    }
    return null;
  }

  /// `flex-shrink` as declared, from the longhand or the `flex` shorthand
  /// (`flex: none` is 0; a one-number `flex: 2` does not say). Null when
  /// neither says — the default is per tag, see flex.dart.
  double? get flexShrink {
    final v = _v('flexShrink');
    if (v is num) return v.toDouble();
    if (v is String) {
      final n = double.tryParse(v.trim());
      if (n != null) return n;
    }
    final f = _v('flex');
    if (f is String) {
      final parts = f.trim().split(RegExp(r'\s+'));
      if (parts.length == 1 && parts[0] == 'none') return 0;
      if (parts.length >= 2) {
        final n = double.tryParse(parts[1]);
        if (n != null) return n;
      }
    }
    return null;
  }

  /// min/max sizes -> box constraints for the widget subtree. Relative
  /// values (`max-width: 100%`) read as absent here; [constraintsIn] is the
  /// one that resolves them, and [hasRelativeConstraints] says which to ask.
  BoxConstraints? get constraints => _constraints(null);

  /// [constraints] with percentages resolved against [outer] — the space the
  /// parent offers, the same reference `width: 50%` uses.
  BoxConstraints? constraintsIn(BoxConstraints outer) => _constraints(outer);

  bool get hasRelativeConstraints =>
      _lengthOf('minWidth')?.isRelative == true ||
      _lengthOf('minHeight')?.isRelative == true ||
      _lengthOf('maxWidth')?.isRelative == true ||
      _lengthOf('maxHeight')?.isRelative == true;

  FjsLength? _lengthOf(String key) => parseLengthValue(_v(key));

  /// `flex-basis` as declared (a percentage stays relative to the flex
  /// container's main size); null for `auto`/`content` or when absent.
  FjsLength? get flexBasisLength => parseLengthValue(_v('flexBasis'));

  /// `max-width` / `max-height` as declared, keeping a percentage relative.
  FjsLength? get maxWidthLength => _lengthOf('maxWidth');
  FjsLength? get maxHeightLength => _lengthOf('maxHeight');

  BoxConstraints? _constraints(BoxConstraints? outer) {
    double? side(String key, double reference) {
      final length = _lengthOf(key);
      if (length == null) return null;
      if (!length.isRelative) return length.px;
      return outer == null ? null : length.resolveOrNull(reference);
    }

    final width = outer?.maxWidth ?? double.infinity;
    final height = outer?.maxHeight ?? double.infinity;
    final minWidth = side('minWidth', width);
    final minHeight = side('minHeight', height);
    final maxWidth = side('maxWidth', width);
    final maxHeight = side('maxHeight', height);
    if (minWidth == null &&
        minHeight == null &&
        maxWidth == null &&
        maxHeight == null) {
      return null;
    }
    return BoxConstraints(
      minWidth: minWidth ?? 0,
      minHeight: minHeight ?? 0,
      maxWidth: maxWidth ?? double.infinity,
      maxHeight: maxHeight ?? double.infinity,
    );
  }

  MainAxisAlignment? get justifyContent {
    switch (_v('justifyContent')?.toString()) {
      case 'center':
        return MainAxisAlignment.center;
      case 'flex-end':
      case 'end':
        return MainAxisAlignment.end;
      case 'space-between':
        return MainAxisAlignment.spaceBetween;
      case 'space-around':
        return MainAxisAlignment.spaceAround;
      case 'space-evenly':
        return MainAxisAlignment.spaceEvenly;
      default:
        return null;
    }
  }

  CrossAxisAlignment? get alignItems {
    switch (_v('alignItems')?.toString()) {
      case 'center':
        return CrossAxisAlignment.center;
      case 'flex-start':
      case 'start':
        return CrossAxisAlignment.start;
      case 'flex-end':
      case 'end':
        return CrossAxisAlignment.end;
      case 'stretch':
        return CrossAxisAlignment.stretch;
      default:
        return null;
    }
  }

  /// `align-self`, or null for `auto` / unset (the parent's align-items).
  CrossAxisAlignment? get alignSelf {
    switch (_v('alignSelf')?.toString()) {
      case 'center':
        return CrossAxisAlignment.center;
      case 'flex-start':
      case 'start':
      case 'self-start':
        return CrossAxisAlignment.start;
      case 'flex-end':
      case 'end':
      case 'self-end':
        return CrossAxisAlignment.end;
      case 'stretch':
        return CrossAxisAlignment.stretch;
      default:
        return null;
    }
  }

  String? get flexDirection {
    final v = _v('flexDirection')?.toString();
    if (v == 'row') return 'row';
    if (v == 'column' || v == null) return 'column';
    return 'column';
  }

  // ---- absolute positioning (inside stack) ----------------------------------
  String? get position => _v('position')?.toString();

  /// Whether this box is a containing block for absolutely-positioned
  /// children — CSS's rule, and what lets `view` + `position: relative`
  /// do everything `stack` does.
  bool get isPositioningContext {
    final value = position;
    return value == 'relative' || value == 'absolute' || value == 'fixed';
  }

  /// `position: relative` offsets the box in paint without touching layout
  /// (its siblings stay where they were), so it is a translate and not a
  /// change of the box's slot. `right` / `bottom` are the same shift the
  /// other way, as in CSS.
  Offset get relativeOffset {
    if (position != 'relative') return Offset.zero;
    final dx = left ?? (right != null ? -right! : 0.0);
    final dy = top ?? (bottom != null ? -bottom! : 0.0);
    return Offset(dx, dy);
  }

  /// True when a `position: relative` node offsets itself with a `%`/calc
  /// side — the gate for the LayoutBuilder branch in the decoration build.
  bool get hasRelativeOffset =>
      position == 'relative' &&
      (leftLength?.isRelative == true ||
          topLength?.isRelative == true ||
          rightLength?.isRelative == true ||
          bottomLength?.isRelative == true);

  /// The relative-position offset with `%` support (spec 044): CSS measures
  /// left/right against the containing block's WIDTH and top/bottom against
  /// its HEIGHT. A relative side whose reference is unbounded resolves to 0
  /// — there is no box to be a percentage of, which is the CSS fallback.
  Offset relativeOffsetIn(double refWidth, double refHeight) {
    if (position != 'relative') return Offset.zero;
    return Offset(
      _offsetAxis(leftLength, rightLength, refWidth),
      _offsetAxis(topLength, bottomLength, refHeight),
    );
  }

  static double _offsetAxis(FjsLength? pos, FjsLength? neg, double reference) {
    if (pos != null) {
      return pos.isRelative ? (pos.resolveOrNull(reference) ?? 0) : pos.px;
    }
    if (neg != null) {
      final v = neg.isRelative ? (neg.resolveOrNull(reference) ?? 0) : neg.px;
      return -v;
    }
    return 0.0;
  }

  double? get left => _num('left');
  double? get top => _num('top');
  double? get right => _num('right');
  double? get bottom => _num('bottom');

  /// The same offsets as [left]/[top]/[right]/[bottom], keeping `%`/calc
  /// values as [FjsLength] for the layout-time resolvers (spec 044).
  FjsLength? get leftLength => parseLengthValue(_v('left'));
  FjsLength? get topLength => parseLengthValue(_v('top'));
  FjsLength? get rightLength => parseLengthValue(_v('right'));
  FjsLength? get bottomLength => parseLengthValue(_v('bottom'));
}
