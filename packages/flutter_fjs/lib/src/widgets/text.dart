// `text` tag -> Text. Resolves the CSS text properties that need the node's
// own font size to make sense (a unitless line-height is a multiplier, an
// absolute one has to be divided by the font size for Flutter's `height`).
//
// A `text` nested in a `text` is a SPAN of the outer one, laid out inline in
// the same paragraph (specs/034-rich-text §3.5) — the web adapter's twin is
// base-css.ts's `text text { display: inline }`. Anything else nested in a
// text (an image, a view) is an inline-block box on the same line.
//
// rich-text can also hand a whole paragraph over as ONE node: its runs as the
// internal `richSpans` prop (specs/035, fjs-runtime/src/rich-text/spans.ts).
// Same paragraph, a fraction of the nodes; the web twin is FjsText in
// web/components/basic.ts.
import 'package:flutter/gestures.dart' show TapGestureRecognizer;
import 'package:flutter/material.dart';

import '../geometry.dart' show lastTapPosition;
import '../mirror_tree.dart';
import '../render/renderer.dart';
import '../render/style.dart';
import '../render/flex.dart' show isOutOfFlowPosition, stackOutOfFlow;
import '../render/gesture.dart' show dispatchTap, hasTapEvent;
import '../render/style_parse.dart';
import 'dispatch.dart';

// Default line height. Flutter would otherwise use the font's own metrics
// and CSS its `normal` — two different numbers, so a two-line row came out
// noticeably taller here than on the web adapter. Both sides now pin the
// same multiplier (see BASE_CSS's `text` rule).
const _defaultLineHeight = 1.4;
const _defaultFontSize = 14.0;

/// What `font-size: 0` becomes. CSS allows it — vant's `.van-loading` sets it
/// to swallow inline whitespace between the spinner and its text — and the
/// glyphs and line collapse to nothing. Flutter's StrutStyle asserts a
/// positive size (the loading Toast painted a red error box), so the one
/// exit every text style goes through clamps to a size nothing can see.
const _zeroFontSize = 0.001;

/// The TextStyle of one text node. [span] adds what only an inline box
/// paints with its text (a background behind the glyphs); a paragraph's own
/// background is its box decoration, drawn by decorateNode. [color] is the
/// interpolated colour an active `transition: color` hands down each tick
/// (spec 078); null means take the style's own.
TextStyle fjsTextStyle(FjsStyle style, {bool span = false, Color? color}) {
  final lineHeight =
      style.lineHeightMultiplier ??
      () {
        final abs = style.lineHeightAbsolute;
        if (abs == null) return null;
        final fs = style.fontSize;
        return fs != null && fs > 0 ? abs / fs : null;
      }();
  return TextStyle(
    // Unstyled text is the web adapter's `body` rule — 14px #333333 —
    // not Flutter's inherited DefaultTextStyle. Anything the cascade did
    // resolve (including a color inherited from an ancestor, which the JS
    // style engine folds into this node's own style) still wins.
    color: color ?? style.color ?? const Color(0xFF333333),
    fontSize: switch (style.fontSize) {
      null => _defaultFontSize,
      final fs when fs <= 0 => _zeroFontSize,
      final fs => fs,
    },
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontFamily: style.fontFamily,
    fontFamilyFallback: style.fontFamilyFallback,
    height: lineHeight ?? _defaultLineHeight,
    // CSS puts the extra leading half above / half below the text; Flutter
    // puts all of it above unless told otherwise.
    leadingDistribution: TextLeadingDistribution.even,
    letterSpacing: style.letterSpacing,
    decoration: style.textDecoration,
    shadows: style.textShadows,
    backgroundColor: span ? style.backgroundColor : null,
  );
}

/// `transition: color` on the paragraph itself (spec 078): the colour
/// interpolates through a TweenAnimationBuilder, whose semantics are the CSS
/// transition's — the first frame takes the value as-is, a changed target
/// interpolates from wherever the previous animation was (decorateNode's
/// decorationTrack makes the same trade). The paragraph rebuilds each tick
/// with the interpolated colour; a nested span that declares its own `color`
/// keeps snapping — per-run tweens would need paragraph-state machinery for
/// a case vant does not exercise (css-compat.md). The builder stays in the
/// tree whenever the track is declared, not only while a colour is set.
Widget _animatedParagraphColor(
  FjsStyle style,
  Widget Function(Color? color) build,
) {
  final track = style.transitions?.forProperty('color');
  if (track == null || track.duration <= Duration.zero) return build(null);
  return TweenAnimationBuilder<Color>(
    tween: _ParagraphColorTween(end: style.color ?? const Color(0xFF333333)),
    duration: track.duration,
    curve: track.curve,
    builder: (_, color, __) => build(color),
  );
}

/// The colour tween: [Tween<Color>] has no arithmetic on its own, so the
/// interpolation is [Color.lerp] — begin is always set by
/// [TweenAnimationBuilder] before the first lerp (it starts at the end).
class _ParagraphColorTween extends Tween<Color> {
  _ParagraphColorTween({required super.end});

  @override
  Color lerp(double t) => Color.lerp(begin, end, t)!;
}

/// The TextStyle of one `richSpans` run: ONLY what the run itself declares.
///
/// Not [fjsTextStyle]: that one fills an unset colour and size with the
/// 14px / #333333 defaults, which is right for a node the style engine
/// resolved (inherited values are already folded into its style) and wrong
/// for a run, whose style carries nothing inherited — every run would paint
/// grey over a paragraph a page coloured. Null fields here inherit from the
/// paragraph's TextSpan, the way CSS inheritance does on the web.
TextStyle fjsSpanStyle(FjsStyle style) {
  final fontSize = style.fontSize;
  final lineHeight =
      style.lineHeightMultiplier ??
      () {
        final abs = style.lineHeightAbsolute;
        return abs != null && fontSize != null && fontSize > 0
            ? abs / fontSize
            : null;
      }();
  return TextStyle(
    color: style.color,
    fontSize: fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontFamily: style.fontFamily,
    fontFamilyFallback: style.fontFamilyFallback,
    height: lineHeight,
    letterSpacing: style.letterSpacing,
    // `underline line-through` is parsed into a combined decoration already
    // (style_parse.dart), which is how nested <u><s> reach here
    decoration: style.textDecoration,
    shadows: style.textShadows,
    backgroundColor: style.backgroundColor,
  );
}

/// [childNodes] are the visible children the renderer already collected;
/// [tree] resolves deeper spans; [buildNode] builds a non-text child as a
/// regular node view (its own decoration, press state and signals).
Widget buildText(
  MirrorNode node,
  FjsStyle style, {
  MirrorTree? tree,
  List<MirrorNode> childNodes = const [],
  Widget Function(MirrorNode node)? buildNode,
  FjsDispatch? dispatch,
}) {
  final textAlign = style.textAlign;
  final maxLines = style.whiteSpaceNowrap ? 1 : style.maxLines;
  // CSS text-overflow only acts on a single-line run (nowrap); Flutter's
  // ellipsis without maxLines would cut wrapped text to one line
  final overflow =
      style.overflow ??
      (maxLines != null && style.textOverflowEllipsis
          ? TextOverflow.ellipsis
          : null);

  final richSpans = node.props['richSpans'];
  if (richSpans != null) {
    assert(() {
      _warnRichSpansOnce(node, richSpans, childNodes);
      return true;
    }());
    // The prop wins over element text and children: rich-text never sends
    // both, and when Vue swaps one for the other the order of the two ops
    // must not decide what shows.
    final runs = <InlineSpan>[];
    if (richSpans is List) {
      for (final run in richSpans) {
        final span = _richSpan(run, style);
        if (span != null) runs.add(span);
      }
    }
    return _animatedParagraphColor(style, (color) {
      final paragraphStyle = fjsTextStyle(style, color: color);
      return Text.rich(
        TextSpan(style: paragraphStyle, children: runs),
        style: paragraphStyle,
        textAlign: textAlign,
        maxLines: maxLines,
        overflow: overflow,
      );
    });
  }

  // An absolutely positioned child (a `::before` decoration box: vant's
  // plain-tag border is `position: absolute; inset: 0` on a span) is not
  // part of the paragraph — as an inline span it drew a dot before the
  // text. Build the paragraph from the in-flow children and lay the rest
  // over it, the containing block a positioned box is on web.
  if (buildNode != null &&
      style.isPositioningContext &&
      childNodes.any((k) => isOutOfFlowPosition(FjsStyle.of(k).position))) {
    final inFlow = <MirrorNode>[];
    final over = <(MirrorNode?, Widget)>[];
    for (final k in childNodes) {
      if (isOutOfFlowPosition(FjsStyle.of(k).position)) {
        over.add((k, buildNode(k)));
      } else {
        inFlow.add(k);
      }
    }
    return stackOutOfFlow(
      style,
      buildText(
        node,
        style,
        tree: tree,
        childNodes: inFlow,
        buildNode: buildNode,
        dispatch: dispatch,
      ),
      over,
    );
  }

  // The common case — `<text>{{ x }}</text>` compiles to element text, no
  // child nodes — stays a plain Text.
  //
  // The strut pins every line to the paragraph's own line-height, laid out
  // with the primary font. CSS sizes a line box from the element's first
  // available font only; a glyph the primary lacks (`∅`, CJK under a Latin
  // system font) borrows the fallback's outline but not its metrics. In
  // Flutter each fallback run brings its own ascent/descent split of the
  // same 1.4em, and the line took the max of both sides — `选中 = ∅` stood
  // 2px taller than `选中 = a`, shifting the whole card. Only the single-run
  // paragraph gets it: a nested span with a larger size must still grow its
  // line, as its inline box does on the web.
  if (childNodes.isEmpty || tree == null) {
    // An empty paragraph with declared dimensions is still a CSS box — vant's
    // skeleton title is an empty <h3> with width/height/background. Flutter's
    // Text('') has no extent for the decoration to paint, so hand it a box:
    // percentages resolve against the incoming constraints (auto where those
    // are unbounded — a percentage height in a scroller, as CSS says).
    if ((node.text == null || node.text!.isEmpty) &&
        (style.widthLength != null || style.heightLength != null)) {
      return LayoutBuilder(
        builder: (context, constraints) => SizedBox(
          width: style.widthLength?.resolveOrNull(constraints.maxWidth),
          height: style.heightLength?.resolveOrNull(constraints.maxHeight),
        ),
      );
    }
    return _animatedParagraphColor(style, (color) {
      final textStyle = fjsTextStyle(style, color: color);
      return Text(
        _transformed(style, node.text ?? ''),
        style: textStyle,
        strutStyle: StrutStyle.fromTextStyle(textStyle, forceStrutHeight: true),
        textAlign: textAlign,
        maxLines: maxLines,
        overflow: overflow,
      );
    });
  }

  final placeholdersOnly = _placeholdersOnly(node, childNodes);
  final spans = <InlineSpan>[
    if (node.text != null && node.text!.isNotEmpty)
      TextSpan(text: _transformed(style, node.text!)),
    for (final kid in childNodes) _span(tree, kid, style, buildNode, dispatch),
    // see [_placeholdersOnly]
    if (placeholdersOnly) const TextSpan(text: '\u2060', style: _noMetrics),
  ];
  // Paragraph-level properties (align, line clamp, nowrap) come from this
  // node only: a span has no box to align or clamp.
  return _animatedParagraphColor(style, (color) {
    final paragraphStyle = fjsTextStyle(style, color: color);
    return Text.rich(
      TextSpan(style: paragraphStyle, children: spans),
      strutStyle: placeholdersOnly
          ? StrutStyle.fromTextStyle(paragraphStyle)
          : null,
      // the paragraph's own style too, not only the root span's: Flutter takes
      // the line metrics of a line with no glyph of its own (an icon font's
      // `::before` box alone in its <i>) from the WIDGET style, which was the
      // ambient Material body text — 14px × 1.43 made vant's 12px step icon a
      // 20px line
      style: paragraphStyle,
      textAlign: textAlign,
      maxLines: maxLines,
      overflow: overflow,
    );
  });
}

/// A near-zero font: runs in it contribute no line metrics of their own.
const _noMetrics = TextStyle(fontSize: 0.01);

/// No glyph of the paragraph's own, only inline boxes (Vue's empty text
/// anchors do not count) — an icon font's `::before` box alone in its <i>.
///
/// CSS gives every line a strut: the paragraph's first available font at
/// its line-height, the inline boxes aligned to its baseline. Flutter's line
/// of placeholders only has no such run and took metrics that are not the
/// CSS ones: default metrics with proportional leading, plus the enclosing
/// font's line gap on every placeholder run. vant-icon has a 92/1024 line
/// gap, and its 28px icon stood 30 tall (specs/131). So such a paragraph
/// gets:
/// - a StrutStyle from its own style (non-forced: a taller box still grows
///   the line, as on web). It resolves the family itself, so an icon font
///   that lacks a glyph still gives its own metrics;
/// - placeholder runs in [_noMetrics], so they add only the box;
/// - a word joiner in [_noMetrics], which keeps the default metrics out of
///   the line. It has no width and no break opportunity.
bool _placeholdersOnly(MirrorNode node, List<MirrorNode> childNodes) {
  if (node.text?.isNotEmpty == true) return false;
  var box = false;
  for (final k in childNodes) {
    if (k.tag != 'text') {
      box = true;
    } else if (k.text?.isNotEmpty == true || k.children.isNotEmpty) {
      return false;
    }
  }
  return box;
}

String _transformed(FjsStyle style, String data) => style.textTransform != null
    ? transformText(style.textTransform, data)!
    : data;

/// One `richSpans` run: a bare string, or `{t, s}` with the run's own style.
/// Anything else is skipped (and reported once in debug).
InlineSpan? _richSpan(Object? run, FjsStyle paragraph) {
  if (run is String) return TextSpan(text: _transformed(paragraph, run));
  if (run is! Map) return null;
  final text = run['t'];
  final declared = run['s'];
  if (text is! String || declared is! Map) return null;
  final style = FjsStyle({'style': Map<String, Object?>.from(declared)});
  final content = TextSpan(
    text: _transformed(paragraph, text),
    style: fjsSpanStyle(style),
  );
  // A shifted run sits in a WidgetSpan, where the paragraph's TextSpan style
  // no longer reaches: give it the paragraph's style to inherit from.
  return _shifted(
        style.verticalAlign,
        paragraph,
        content,
        inherited: fjsTextStyle(paragraph),
      ) ??
      content;
}

/// One child of a paragraph.
///
/// Spans are built from the child MirrorNodes directly, not from the child
/// node views: a TextSpan is not a widget, so a child's own view could not
/// sit inside the paragraph anyway, and a paragraph is laid out in one pass.
/// The price is that a change to a deep span must rebuild the paragraph
/// root — mirror_tree.dart's dirty marking walks up text ancestors for that.
InlineSpan _span(
  MirrorTree tree,
  MirrorNode kid,
  FjsStyle parent,
  Widget Function(MirrorNode node)? buildNode, [
  FjsDispatch? dispatch,
  TapGestureRecognizer? inheritedTap,
]) {
  if (kid.tag != 'text') {
    // An inline-block box, its bottom edge on the baseline — what CSS does
    // with an <img> in a line (an image has no baseline of its own).
    return WidgetSpan(
      alignment: PlaceholderAlignment.baseline,
      baseline: TextBaseline.alphabetic,
      // the box alone sizes its slot, not the enclosing font's line gap
      // (see _placeholdersOnly)
      style: _noMetrics,
      child: buildNode?.call(kid) ?? const SizedBox.shrink(),
    );
  }

  final style = FjsStyle.of(kid);
  assert(() {
    _warnBoxOnSpan(style);
    return true;
  }());

  final grandKids = <MirrorNode>[
    for (final id in kid.children)
      if (tree.node(id) case final n? when !FjsNodeRenderer.isHidden(n)) n,
  ];
  // A node the style engine never styled (a bare run with nothing to
  // inherit) takes its enclosing span's style. fjsTextStyle would pin the
  // 14px #333333 defaults instead, turning a run inside `<b style="color:
  // red">` back to grey.
  final textStyle = style.style.isEmpty && kid.props['style'] == null
      ? null
      : fjsTextStyle(style, span: true);
  // Flutter asks only the innermost span under the finger for a
  // recognizer, never its parents; vant's <span @click> holds its label as
  // a child text run, so the span's own recognizer was never consulted.
  // Runs inside a clickable span carry it, as a DOM click bubbles.
  final tap =
      (dispatch == null ? null : _spanTap(kid, dispatch)) ?? inheritedTap;
  final content = TextSpan(
    text: kid.text == null || kid.text!.isEmpty
        ? null
        : _transformed(style, kid.text!),
    style: textStyle,
    recognizer: tap,
    children: grandKids.isEmpty
        ? null
        : [
            for (final n in grandKids)
              _span(tree, n, style, buildNode, dispatch, tap),
          ],
  );
  return _shifted(style.verticalAlign, parent, content) ?? content;
}

/// A span's own `@tap` / `@click`. A run inside a paragraph is a TextSpan,
/// not a widget, so gestureNode's detector never wraps it — vant's
/// TextEllipsis "展开" is such a span and did nothing on tap (specs/128).
/// One recognizer per node, kept with it: TextSpan does not own the
/// recognizer, and a new one per build would drop a tap in progress
/// whenever the paragraph rebuilt. It is not disposed; it holds no
/// resources beyond an arena entry, which ends with the gesture.
final Expando<TapGestureRecognizer> _spanRecognizers = Expando();

TapGestureRecognizer? _spanTap(MirrorNode kid, FjsDispatch dispatch) {
  if (!hasTapEvent(kid) || fjsBool(kid.props['disabled'])) return null;
  final recognizer = _spanRecognizers[kid] ??= TapGestureRecognizer();
  recognizer
    ..onTapUp = ((details) => lastTapPosition = details.globalPosition)
    ..onTap = (() => dispatchTap(kid, dispatch));
  return recognizer;
}

/// A sub/superscript: TextSpan has no baseline shift, so the run is a small
/// paragraph of its own, moved off the baseline. Chrome shifts `super` up by
/// a third of the PARENT's font size and `sub` down by a fifth; the same
/// fractions here keep the two sides looking alike. The translation is
/// paint-only, so the line box does not grow the way a browser's does —
/// close enough for footnote marks and exponents, and it cannot wrap inside,
/// which a run this short never needs.
///
/// [inherited] is the style the run would otherwise have taken from the
/// paragraph; a node span passes none because its style is fully resolved.
InlineSpan? _shifted(
  String? align,
  FjsStyle parent,
  TextSpan content, {
  TextStyle? inherited,
}) {
  if (align != 'sub' && align != 'super') return null;
  final parentSize = parent.fontSize ?? _defaultFontSize;
  final dy = align == 'super' ? -parentSize / 3 : parentSize / 5;
  return WidgetSpan(
    alignment: PlaceholderAlignment.baseline,
    baseline: TextBaseline.alphabetic,
    child: Transform.translate(
      offset: Offset(0, dy),
      child: Text.rich(
        inherited == null
            ? content
            : TextSpan(style: inherited, children: [content]),
      ),
    ),
  );
}

bool _warnedBoxOnSpan = false;

/// An inline box has no margin / padding / border / size here, and the web
/// adapter forces the same (base-css.ts) — say so once instead of dropping
/// them without a word (constitution V).
void _warnBoxOnSpan(FjsStyle style) {
  if (_warnedBoxOnSpan) return;
  if (style.margin != null ||
      style.padding != null ||
      style.border != null ||
      style.hasSideBorderDeclaration ||
      style.widthLength != null ||
      style.heightLength != null) {
    _warnedBoxOnSpan = true;
    debugPrint(
      '[fjs] a <text> nested in a <text> is an inline span: its '
      'margin / padding / border / width / height are ignored',
    );
  }
}

bool _warnedRichSpans = false;

/// `richSpans` is written by rich-text only; a malformed one, or one sent
/// alongside children or element text, means something else wrote it —
/// report it once rather than render a silently different paragraph
/// (constitution V).
void _warnRichSpansOnce(
  MirrorNode node,
  Object richSpans,
  List<MirrorNode> childNodes,
) {
  if (_warnedRichSpans) return;
  String? problem;
  if (richSpans is! List) {
    problem = 'is not a list';
  } else if (richSpans.any(
    (run) =>
        run is! String &&
        !(run is Map && run['t'] is String && run['s'] is Map),
  )) {
    problem = 'has a run that is neither a string nor {t, s}';
  } else if (childNodes.isNotEmpty || (node.text?.isNotEmpty ?? false)) {
    problem =
        'arrived together with children or element text, which are ignored';
  }
  if (problem == null) return;
  _warnedRichSpans = true;
  debugPrint(
    '[fjs] <text> internal prop richSpans $problem (rendering the runs only)',
  );
}
