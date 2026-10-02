// specs/193 — what the flat display surface understands of a computed style.
//
// One immutable [FlatStyle] per interned style (an Expando on the style entry,
// so every node that resolved to the same style shares it — specs/084). The
// gate and the layout engine read the SAME object, which is the point: a key
// is in [_supportedKeys] if and only if the engine implements it and a parity
// test pins it against the ordinary renderer (plan §3.2). Anything else makes
// the style [FlatVerdict.rejected] with the key named, and the gate sends the
// subtree down the ordinary path — never an approximation (constitution V).
//
// Why a whitelist and not "everything the engine ignores is harmless": the
// ordinary path wraps a node in a different widget chain for almost every
// layout-affecting key (Align, Flexible, FjsUncappedCross, LayoutBuilder…), so
// "ignored" silently means "laid out differently".
import 'package:flutter/rendering.dart';
import 'package:flutter/painting.dart';

import '../mirror_tree.dart';
import '../render/style.dart';

/// Keys the flat surface implements. Text keys are read by the shared-painter
/// path (`fjsPlainTextSpec`), box keys by [FlatStyle].
const Set<String> _supportedKeys = {
  // layout
  'flexDirection', 'flexGrow', 'flexShrink', 'flex', 'width', 'height',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'gap', 'rowGap', 'columnGap', 'alignItems', 'justifyContent', 'display',
  'boxSizing',
  // paint
  'backgroundColor', 'borderRadius',
  // text (also inherited onto boxes by the style engine; no effect there)
  'fontSize', 'color', 'fontWeight', 'fontStyle', 'fontFamily', 'lineHeight',
  'letterSpacing', 'textDecoration', 'textShadow', 'textTransform',
  'whiteSpace', 'textOverflow', 'textAlign', 'maxLines',
};

enum FlatAlign { stretch, start, center, end }

enum FlatJustify { start, center, end, between, around, evenly }

class FlatStyle {
  const FlatStyle({
    required this.row,
    required this.align,
    required this.justify,
    required this.grow,
    required this.width,
    required this.height,
    required this.margin,
    required this.padding,
    required this.gap,
    required this.background,
    required this.radius,
    required this.style,
  });

  final bool row;

  /// `align-items` as the ordinary path declares it: explicit, else a row
  /// centres and a column stretches (flex.dart `crossAlignment`).
  final FlatAlign align;
  final FlatJustify justify;
  final double grow;
  final double? width;
  final double? height;
  final EdgeInsets margin;
  final EdgeInsets padding;
  /// Declared gap in px, or null when none: the ordinary path inserts a
  /// spacer item between children only when a gap is declared (even 0px),
  /// and spacers count as items for `justify-content: space-*`.
  final double? gap;
  final Color? background;
  final BorderRadius? radius;
  final FjsStyle style;

  bool get hasSize => width != null || height != null;
  bool get hasMargin => margin != EdgeInsets.zero;
  bool get hasPadding => padding != EdgeInsets.zero;
}

/// A style the surface can lay out, or the first key that says it cannot.
class FlatVerdict {
  const FlatVerdict.ok(FlatStyle this.style) : rejected = null;
  const FlatVerdict.rejected(String this.rejected) : style = null;

  final FlatStyle? style;

  /// The offending key (or `key=value` for value-level rejections).
  final String? rejected;
}

final Expando<FlatVerdict> _verdicts = Expando('flatVerdict');
FlatVerdict? _noStyleVerdict;

/// The verdict for [node]'s computed style. Cached on the interned entry;
/// nodes without one (hand-built props, an unstyled node) get a shared
/// default verdict when their style map is empty.
FlatVerdict flatVerdictOf(MirrorNode node) {
  final entry = node.style;
  if (entry == null) {
    if (node.styleMap.isEmpty) {
      return _noStyleVerdict ??= _compute(node);
    }
    return _compute(node);
  }
  return _verdicts[entry] ??= _compute(node);
}

FlatVerdict _compute(MirrorNode node) {
  final map = node.styleMap;
  for (final k in map.keys) {
    if (!_supportedKeys.contains(k)) return FlatVerdict.rejected(k);
  }
  final s = FjsStyle.of(node);

  String? raw(String k) => map[k]?.toString();

  // value-level checks: the key is understood, this value is not
  final direction = raw('flexDirection');
  if (direction != null && direction != 'row' && direction != 'column') {
    return FlatVerdict.rejected('flexDirection=$direction');
  }
  final display = raw('display');
  if (display != null && display != 'flex' && display != 'block') {
    return FlatVerdict.rejected('display=$display');
  }
  final boxSizing = raw('boxSizing');
  if (boxSizing != null && boxSizing != 'border-box') {
    return FlatVerdict.rejected('boxSizing=$boxSizing');
  }
  final alignRaw = raw('alignItems');
  final align = switch (alignRaw) {
    null => (direction == 'row') ? FlatAlign.center : FlatAlign.stretch,
    'center' => FlatAlign.center,
    'flex-start' || 'start' => FlatAlign.start,
    'flex-end' || 'end' => FlatAlign.end,
    'stretch' => FlatAlign.stretch,
    _ => null,
  };
  if (align == null) return FlatVerdict.rejected('alignItems=$alignRaw');
  final justifyRaw = raw('justifyContent');
  final justify = switch (justifyRaw) {
    null || 'flex-start' || 'start' => FlatJustify.start,
    'center' => FlatJustify.center,
    'flex-end' || 'end' => FlatJustify.end,
    'space-between' => FlatJustify.between,
    'space-around' => FlatJustify.around,
    'space-evenly' => FlatJustify.evenly,
    _ => null,
  };
  if (justify == null) return FlatVerdict.rejected('justifyContent=$justifyRaw');

  // `flex` is only understood as a bare grow factor: the ordinary path reads
  // its basis and shrink tokens elsewhere (`flexBasisLength`)
  final flex = map['flex'];
  if (flex != null && flex is! num) {
    final t = flex.toString().trim();
    if (double.tryParse(t) == null) return FlatVerdict.rejected('flex=$t');
  }

  // lengths: px only (percent / calc / fit-content change the wrapper chain)
  final w = s.widthLength, h = s.heightLength;
  if (w?.isRelative == true || s.widthFitContent) {
    return const FlatVerdict.rejected('width=relative');
  }
  if (h?.isRelative == true) return const FlatVerdict.rejected('height=relative');
  if (s.hasRelativeSpacing) return const FlatVerdict.rejected('spacing=relative');
  final auto = s.marginAutoSides;
  if (auto.top || auto.right || auto.bottom || auto.left) {
    return const FlatVerdict.rejected('margin=auto');
  }
  final gapLength = (direction == 'row') ? s.columnGapLength : s.rowGapLength;
  if (gapLength?.isRelative == true) return const FlatVerdict.rejected('gap=relative');
  if (s.flexBasisLength != null) return const FlatVerdict.rejected('flexBasis');
  if (s.position != null && s.position != 'static') {
    return FlatVerdict.rejected('position=${s.position}');
  }
  final parts = s.borderRadiusParts;
  if (parts != null && parts.any((p) => p.fraction != 0)) {
    return const FlatVerdict.rejected('borderRadius=%');
  }

  return FlatVerdict.ok(
    FlatStyle(
      row: direction == 'row',
      align: align,
      justify: justify,
      grow: (s.flexGrow ?? 0).clamp(0, 9999).toDouble(),
      width: w?.px,
      height: h?.px,
      margin: s.margin ?? EdgeInsets.zero,
      padding: s.padding ?? EdgeInsets.zero,
      gap: gapLength?.px,
      background: s.backgroundColor,
      radius: s.borderRadius,
      style: s,
    ),
  );
}
