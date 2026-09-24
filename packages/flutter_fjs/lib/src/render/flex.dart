// CSS flex/wrap layout mapped onto Flutter's Flex and Wrap. This is the
// skeleton behind `view`, `scroll-view` and `safe-area`; `buildBox` adds the
// absolute-positioning half, which any box turns on with
// `position: relative`.
//
// Every function here takes the children already built as widgets, plus their
// nodes — the nodes are what carries per-child style (flex-grow, position,
// cross-axis size), which Flutter expresses through parent-side wrappers
// (Expanded, Align, Positioned) rather than on the child itself.
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../mirror_tree.dart';
import '../widgets/control_scope.dart' show fjsWarnOnce;
import 'cull.dart';
import 'gesture.dart' show hasTapEvent;
import 'overflow_hit.dart';
import 'touch.dart' show needsTouchNode;
import 'decoration.dart'
    show FjsClipScope, FjsUncappedHeightScope, resolveEdgeLengths;
import 'length.dart';
import 'stretch_flex.dart';
import 'style.dart';
import 'style_parse.dart' show FjsTransitionTrack;

/// `position: fixed` is authored by CSS but handled exactly like
/// `absolute` relative to the overlay host (specs/069): both are
/// out-of-flow boxes positioned by their offsets.
bool isOutOfFlowPosition(String? position) =>
    position == 'absolute' || position == 'fixed';

/// [growChildren] is the page root's rule: its children fill it even
/// without saying `flex-grow`, which is what the web stylesheet does with
/// `fjs-page-entry > * { flex: 1 1 0% }`. Without it the root column hands
/// a child that never asked to grow an *unbounded* height — and the app
/// shell inside, whose middle area does ask, cannot resolve it.
///
/// [cull] swaps the [Flex] for one that skips painting children outside the
/// clip. Only a scroller turns it on: everywhere else there is no clip to
/// cull against, so it would be per-child arithmetic for nothing. See
/// [FjsCullingFlex] for what it does and does not change.
Widget buildFlex(
  FjsStyle style,
  List<Widget> kids,
  List<MirrorNode?> kidNodes, {
  bool growChildren = false,
  bool cull = false,
  bool htmlBlock = false,
}) {
  final horizontal = (style.flexDirection ?? 'column') == 'row';
  final axis = horizontal ? Axis.horizontal : Axis.vertical;
  // Whether this box lays its children out as CSS BLOCK flow — an HTML div
  // (htmlBlock) left at display block / inline-block. Everything else is a
  // flex container on the web too (an fjs <view> is display: flex there),
  // and a flex item's display is blockified: an inline-block button in a
  // <view> stretches like a block (see [_flexChild]).
  // Read from the node, not [FjsStyle.props]: interned styles share one
  // view with empty props (specs/084), and htmlBlock is a tag marker.
  final blockFlow =
      htmlBlock &&
      (style.display == null ||
          style.display == 'block' ||
          style.display == 'inline-block');
  if (style.flexWrap && !_growingSingleLine(horizontal, kidNodes)) {
    // wrapped children lay out run by run, so flexGrow (Expanded) has no
    // meaning here — but a CSS flex item's MAIN-axis size is still
    // content-based, and the Wrap hands every child a BOUNDED loose
    // constraint (the run limit). A plain view defaults to a stretch column,
    // and Flutter's stretch-column expands to a bounded cross constraint —
    // so without this, every wrap child that is a plain box stretched to the
    // full run width while the same page shrink-to-fit on web. Relax the
    // main axis (a plain Flex row already gives its children an unbounded
    // one, which is why only wrap showed this); a child that declared a
    // main-axis percentage keeps the run limit as its reference, exactly
    // like [_flexChild] does for the non-wrapping path.
    return LayoutBuilder(
      builder: (context, constraints) {
        final mainAxisMax = horizontal
            ? constraints.maxWidth
            : constraints.maxHeight;
        final crossAxisMax = horizontal
            ? constraints.maxHeight
            : constraints.maxWidth;
        // A % gap is a fraction of the container's own size along the gap's
        // axis (CSS: column-gap against the width, row-gap against the
        // height); an unbounded reference resolves to zero, as CSS treats it.
        return Wrap(
          direction: axis,
          spacing:
              (horizontal
                  ? style.columnGapLength
                  : style.rowGapLength)?.resolveOrNull(mainAxisMax) ??
              0,
          runSpacing:
              (horizontal
                  ? style.rowGapLength
                  : style.columnGapLength)?.resolveOrNull(crossAxisMax) ??
              0,
          alignment: style.wrapAlignment,
          crossAxisAlignment: style.wrapCrossAlignment,
          children: [
            for (var i = 0; i < kids.length; i++)
              _wrapChild(
                child: kids[i],
                childNode: i < kidNodes.length ? kidNodes[i] : null,
                horizontal: horizontal,
                mainAxisMax: mainAxisMax,
                crossAxisMax: crossAxisMax,
              ),
          ],
        );
      },
    );
  }
  final crossAlignment =
      style.alignItems ??
      (horizontal ? CrossAxisAlignment.center : CrossAxisAlignment.stretch);
  // `align-self` on any in-flow item: Flutter's Flex aligns every child the
  // same way, so the box is laid out as a stretch — each item gets the
  // line's cross size — and every item that should NOT stretch aligns
  // itself inside it (see [_flexChild]'s crossAlign). Boxes without one
  // never take this path.
  final selfAligned = kidNodes.any((n) {
    if (n == null) return false;
    final s = FjsStyle.of(n);
    return s.alignSelf != null && !isOutOfFlowPosition(s.position);
  });
  return LayoutBuilder(
    builder: (context, constraints) {
      // A scroll view gives its content an unbounded cross axis. Flutter's
      // stretch hands that on as a tight Infinity constraint — invalid. CSS
      // still stretches there: to the LINE's cross size, the tallest item
      // (vant-nav's sidebar row: the content pane takes the sidebar's
      // height). That is the two-pass measure-then-stretch layout
      // (stretch_flex.dart measureCross): items at their own size first,
      // then the cross axis tight at the widest/tallest of them.
      final crossBounded = horizontal
          ? constraints.hasBoundedHeight
          : constraints.hasBoundedWidth;
      // Rows only (a vertical scroller's content): a column with an
      // unbounded WIDTH lives in a horizontal scroller, where its % paddings
      // would resolve against the width they help size — kept at start.
      final unboundedStretch =
          !crossBounded &&
          horizontal &&
          crossAlignment == CrossAxisAlignment.stretch;
      final effectiveCrossAlignment =
          !crossBounded &&
              !horizontal &&
              crossAlignment == CrossAxisAlignment.stretch
          ? CrossAxisAlignment.start
          : crossAlignment;
      // the alignment the Flex itself runs with; under `align-self` it is a
      // stretch, and a box that was not stretching measures its cross size
      // from its items first (stretch_flex.dart measureCross) — the width it
      // had before, now with a line for each item to align in
      final flexAlignment = selfAligned
          ? CrossAxisAlignment.stretch
          : effectiveCrossAlignment;
      final measureCross =
          unboundedStretch ||
          (selfAligned &&
              effectiveCrossAlignment != CrossAxisAlignment.stretch);
      // What a percentage on the main axis is a percentage OF: this box's
      // content box, the same reference CSS uses. Flex hands its children an
      // unbounded main axis, so a child cannot read it from its own
      // constraints — see [_flexChild].
      // A column whose box uncapped its height (overflow hidden + height
      // transition — specs/101's shared-element fly box) is laid out under
      // [box height, ∞]; CSS still resolves `height: 100%` against that box,
      // so the min is the reference there. Only when the decoration SAYS so
      // (FjsUncappedHeightScope): CSS min-height yields the same
      // constraints, and a min-height box is not a percentage reference —
      // inferring it from min > 0 (specs/101) made Flutter resolve what web
      // leaves auto (specs/106). Rows keep the max: nothing uncaps a width.
      final mainAxisMax = horizontal
          ? constraints.maxWidth
          : (!constraints.maxHeight.isFinite &&
                    constraints.minHeight > 0 &&
                    FjsUncappedHeightScope.marks(context, style)
                ? constraints.minHeight
                : constraints.maxHeight);
      // The main-axis gap with its % resolved — column-gap against the
      // width on a row, row-gap against the height on a column, both of
      // them mainAxisMax here; unbounded falls to zero, as CSS treats it.
      final gapPx = (horizontal
              ? style.columnGapLength
              : style.rowGapLength)?.resolveOrNull(mainAxisMax);
      final entries = <(Widget, MirrorNode?)>[
        for (var i = 0; i < kids.length; i++) ...[
          if (gapPx != null && i > 0)
            (
              horizontal ? SizedBox(width: gapPx) : SizedBox(height: gapPx),
              null,
            ),
          (kids[i], i < kidNodes.length ? kidNodes[i] : null),
        ],
      ];
      // Main-axis auto margins (CSS flexbox §8.1): they take the free space
      // before justify-content sees any, split equally between them — a
      // Spacer on each auto side is exactly that split. There is free space
      // only when the main axis is bounded and no item grows (a growing
      // item would have eaten it in CSS, while a Spacer would still take a
      // share here).
      final autoMargins =
          mainAxisMax.isFinite &&
          !growChildren &&
          !kidNodes.any((n) {
            if (n == null) return false;
            final s = FjsStyle.of(n);
            final grow = s.flexGrow;
            return !isOutOfFlowPosition(s.position) && grow != null && grow > 0;
          });
      final children = <Widget>[];
      for (final (child, childNode) in entries) {
        final auto = autoMargins && childNode != null
            ? _mainAutoMargins(FjsStyle.of(childNode), horizontal)
            : null;
        if (auto != null && auto.lead) children.add(const Spacer());
        final item = _flexChild(
          child: child,
          childNode: childNode,
          horizontal: horizontal,
          stretches: flexAlignment == CrossAxisAlignment.stretch,
          crossAlign: selfAligned && childNode != null
              ? FjsStyle.of(childNode).alignSelf ?? effectiveCrossAlignment
              : null,
          mainAxisMax: mainAxisMax,
          defaultGrow: growChildren ? 1 : null,
          blockFlow: blockFlow,
        );
        children.add(measureCross ? _crossLineItem(item) : item);
        if (auto != null && auto.trail) children.add(const Spacer());
      }
      if (cull) {
        return FjsCullingFlex(
          direction: axis,
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: style.justifyContent ?? MainAxisAlignment.start,
          crossAxisAlignment: flexAlignment,
          measureCross: measureCross,
          textBaseline: TextBaseline.alphabetic,
          children: children,
        );
      }
      return FjsFlex(
        direction: axis,
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: style.justifyContent ?? MainAxisAlignment.start,
        crossAxisAlignment: flexAlignment,
        measureCross: measureCross,
        textBaseline: TextBaseline.alphabetic,
        // CSS overflow:hidden absorbs content that runs past the box — the
        // children keep their natural layout and the paint clips (decoration
        // wraps the box in a ClipRect), which is exactly the geometry web
        // reports as scrollWidth > clientWidth. Flutter's debug paint would
        // still flag it as an overflow error on every frame; the scope also
        // covers boxes higher up that clip us (vant's swipe track sits in
        // the swipe's overflow:hidden). See [RenderFjsFlex.cssOverflowClip].
        cssOverflowClip: style.overflowHidden || FjsClipScope.of(context),
        children: children,
      );
    },
  );
}

/// Tags the web base stylesheet pins at `flex-shrink: 0` (web/base-css.ts:
/// a Flutter child keeps its natural size). Every other tag — `input`
/// included — has CSS's initial `flex-shrink: 1` on web, so it does here.
const _noShrinkTags = {
  'view',
  'scroll-view',
  'list-view',
  'safe-area',
  'refresh',
  'swiper-item',
  'fjs-modal-sheet',
  'switch',
  'checkbox',
  'progress-bar',
  'text',
};

/// Whether [out] is still [child] up to the shrink marker, i.e. the next
/// wrapper is the outermost one so far and must carry the node's key.
bool _keyed(Widget out, Widget child) =>
    identical(out, child) ||
    (out is FjsShrinkCross && identical(out.child, child));

/// Whether a wrapping ROW is really a single line whose growing item fills
/// the rest — vant's field: `.van-field { flex-wrap: wrap }` around a
/// fixed-width label and a `flex: 1` value.
///
/// [Wrap] cannot grow an item, so there the value is sized by its content:
/// an `input { width: 100% }` plus the clear icon that appears once the
/// field has text came out wider than the room beside the label, and the
/// whole value dropped to a second line. CSS breaks lines on the flex BASE
/// size — 0 for `flex: 1` — so the value stays beside the label and grows.
/// A nowrap [Flex] is that outcome. It stops being right when the items
/// really do not fit on one line, which only a measuring layout can tell;
/// the case authors use to force a break — an item claiming the full line
/// (`width: 100%`, vant's label-top) — keeps the [Wrap].
bool _growingSingleLine(bool horizontal, List<MirrorNode?> kidNodes) {
  if (!horizontal) return false;
  var grows = false;
  // percentage bases that add up past the line break it for real (vant's
  // number keyboard: twelve `flex-basis: 33%` keys make four lines)
  var basisTotal = 0.0;
  for (final n in kidNodes) {
    if (n == null) continue;
    final s = FjsStyle.of(n);
    if (isOutOfFlowPosition(s.position)) continue;
    final width = s.widthLength;
    if (width != null && width.percent >= 1) return false;
    basisTotal += (width ?? s.flexBasisLength)?.percent ?? 0;
    if (basisTotal > 1 + 1e-9) return false;
    final grow = s.flexGrow;
    if (grow != null && grow > 0) grows = true;
  }
  return grows;
}

/// The in-flow item's `auto` margins on the main axis, or null for none.
({bool lead, bool trail})? _mainAutoMargins(FjsStyle s, bool horizontal) {
  if (isOutOfFlowPosition(s.position)) return null;
  final a = s.marginAutoSides;
  final lead = horizontal ? a.left : a.top;
  final trail = horizontal ? a.right : a.bottom;
  return lead || trail ? (lead: lead, trail: trail) : null;
}

/// Wraps one WRAP child (a flex item of a `flex-wrap` container).
///
/// See the comment at the [Wrap] site in [buildFlex]: the main-axis
/// constraint is relaxed so a plain box shrink-to-fits like it does on web.
/// The one exception is a child that declared a main-axis percentage — it
/// keeps the run limit as the reference its percentage resolves against.
///
/// A column wrap's children are capped at the container's width, because
/// [Wrap] does not do it: it constrains only the main axis (the run limit),
/// so every child got an infinite width. A text field in there asserts
/// and takes the whole page down — vant's `.van-field { flex-wrap: wrap }`
/// is a column wrap under fjs's column default. CSS never gives an item
/// more cross space than its container has, so capping it is the web shape.
Widget _wrapChild({
  required Widget child,
  required MirrorNode? childNode,
  required bool horizontal,
  required double mainAxisMax,
  required double crossAxisMax,
}) {
  final bounded = _wrapChildMain(
    child: child,
    childNode: childNode,
    horizontal: horizontal,
    mainAxisMax: mainAxisMax,
  );
  // A row wrap's items may overflow a fixed-height box in CSS rather than
  // shrink, so only the column case — the one Wrap leaves infinite — is
  // capped.
  if (horizontal || !crossAxisMax.isFinite) return bounded;
  return ConstrainedBox(
    constraints: BoxConstraints(maxWidth: crossAxisMax),
    child: bounded,
  );
}

Widget _wrapChildMain({
  required Widget child,
  required MirrorNode? childNode,
  required bool horizontal,
  required double mainAxisMax,
}) {
  if (childNode == null) return child;
  final s = FjsStyle.of(childNode);
  if (isOutOfFlowPosition(s.position)) return child;
  final basis =
      _basisSize(s, horizontal, mainAxisMax) ??
      _growingShare(s, horizontal, mainAxisMax);
  if (basis != null) {
    return SizedBox(
      width: horizontal ? basis : null,
      height: horizontal ? null : basis,
      child: child,
    );
  }
  final mainLength = horizontal ? s.widthLength : s.heightLength;
  // spec 044: a % margin/padding references the container's width on every
  // side, and a row's main axis is unbounded for the child — same gate as
  // [_flexChild]
  final needsMainBound = horizontal
      ? s.hasRelativeSpacing ||
            s.leftLength?.isRelative == true ||
            s.rightLength?.isRelative == true
      : s.topLength?.isRelative == true || s.bottomLength?.isRelative == true;
  if ((mainLength?.isRelative == true || needsMainBound) &&
      mainAxisMax.isFinite) {
    return ConstrainedBox(
      constraints: horizontal
          ? BoxConstraints(maxWidth: mainAxisMax)
          : BoxConstraints(maxHeight: mainAxisMax),
      child: child,
    );
  }
  // Not UnconstrainedBox: it sizes itself past the run and paints its debug
  // "overflowed" stripes when the child's natural size exceeds the slot —
  // CSS inline content paints the same surplus silently (a 1px font-metric
  // surplus on CJK runs, nowrap text), clipped only where an ancestor
  // clips. The proxy below keeps the box at the run's size so the Wrap sees
  // no overflow, and lets the child paint from the leading edge.
  return FjsFreeMainAxis(horizontal: horizontal, child: child);
}

/// Frees a wrap item's MAIN axis: the child lays out at its natural size
/// even when that runs past the run, and paints from the box's leading
/// edge. The box itself reports the run's size — the surplus is paint-only,
/// exactly like an overflowing inline box on web.
class FjsFreeMainAxis extends SingleChildRenderObjectWidget {
  const FjsFreeMainAxis({super.key, required this.horizontal, super.child});

  /// Whether the freed axis is the width (a row wrap's main axis).
  final bool horizontal;

  @override
  RenderFjsFreeMainAxis createRenderObject(BuildContext context) =>
      RenderFjsFreeMainAxis(horizontal);

  @override
  void updateRenderObject(BuildContext context, RenderFjsFreeMainAxis ro) {
    ro.horizontal = horizontal;
  }
}

class RenderFjsFreeMainAxis extends RenderProxyBox {
  RenderFjsFreeMainAxis(this.horizontal);

  bool horizontal;

  @override
  void performLayout() {
    final c = constraints;
    final freed = horizontal
        // free the width, keep the height (a row wrap's main axis)
        ? BoxConstraints(minHeight: c.minHeight, maxHeight: c.maxHeight)
        // free the height, keep the width (a column wrap's main axis)
        : BoxConstraints(minWidth: c.minWidth, maxWidth: c.maxWidth);
    child?.layout(freed, parentUsesSize: true);
    size = c.constrain(child?.size ?? c.smallest);
  }
}

/// The main-axis size `flex-basis` gives a non-growing item that has no
/// main size of its own (vant's grid: `flex-basis: 33.33%` per column), or
/// null. A percentage resolves against the container's main size, which a
/// Flex/Wrap child cannot read from its own (unbounded) constraints. A
/// growing item keeps Flutter's flex split — equivalent to basis 0, the
/// `flex: 1` shorthand's own basis.
double? _basisSize(FjsStyle s, bool horizontal, double mainAxisMax) {
  final mainLength = horizontal ? s.widthLength : s.heightLength;
  if (mainLength != null) return null;
  final grow = s.flexGrow;
  if (grow != null && grow > 0) return null;
  final basis = s.flexBasisLength;
  if (basis == null) return null;
  if (!basis.isRelative) return basis.px;
  return mainAxisMax.isFinite ? basis.resolveOrNull(mainAxisMax) : null;
}

/// A growing wrap item with a percentage basis (vant's number keyboard:
/// `flex: 1; flex-basis: 33%` keys in a wrapping row). CSS breaks lines on
/// the basis — three 33% keys to a line — then grow hands the leftover 1% out
/// evenly, so each key is a third of the line. That equal share is what
/// this returns; Wrap cannot grow, so it is sized up front.
double? _growingShare(FjsStyle s, bool horizontal, double mainAxisMax) {
  final grow = s.flexGrow;
  if (grow == null || grow <= 0 || !mainAxisMax.isFinite) return null;
  if ((horizontal ? s.widthLength : s.heightLength) != null) return null;
  final basis = s.flexBasisLength;
  if (basis == null || basis.px != 0 || basis.percent <= 0) return null;
  final perLine = (1 / basis.percent + 1e-9).floor();
  return perLine < 1 ? mainAxisMax : mainAxisMax / perLine;
}

/// Where an item that aligns itself sits in its line (the cross axis only;
/// the Align is main-axis sized to the item).
AlignmentGeometry _crossAlignment(CrossAxisAlignment align, bool horizontal) {
  switch (align) {
    case CrossAxisAlignment.center:
      return horizontal ? Alignment.centerLeft : Alignment.topCenter;
    case CrossAxisAlignment.end:
      return horizontal ? Alignment.bottomLeft : AlignmentDirectional.topEnd;
    default:
      return horizontal ? Alignment.topLeft : AlignmentDirectional.topStart;
  }
}

/// Wraps one flex child.
///
/// Every wrapper carries the child's own key. A wrapper is what the parent's
/// element reconciles against, so an unkeyed one makes Flutter match children
/// by POSITION: after a reorder, position 0 holds a different node than
/// before, `canUpdate` fails on the mismatched keys inside, and the whole
/// subtree is rebuilt from scratch. Keying the wrapper is what lets a move
/// stay a move.
/// Puts [FjsCrossLineItem] between a measuring flex and one of its items,
/// under the item's Flexible — flex parent data has to land on the flex's
/// direct render child, which the proxy now is.
Widget _crossLineItem(Widget item) {
  if (item is Flexible) {
    return Flexible(
      key: item.key,
      flex: item.flex,
      fit: item.fit,
      child: FjsCrossLineItem(child: item.child),
    );
  }
  return FjsCrossLineItem(key: item.key, child: item);
}

Widget _flexChild({
  required Widget child,
  required MirrorNode? childNode,
  required bool horizontal,
  required bool stretches,
  required double mainAxisMax,
  CrossAxisAlignment? crossAlign,
  int? defaultGrow,
  bool blockFlow = true,
}) {
  if (childNode == null) {
    return defaultGrow == null
        ? child
        : Expanded(flex: defaultGrow, child: child);
  }
  final key = ValueKey<int>(childNode.id);
  final s = FjsStyle.of(childNode);
  // Style-level `position: sticky` only sticks as a scroll container's
  // DIRECT child (or inside a sticky-section) — there the sticky split
  // pulls it out of the run before this ever sees it. Reaching _flexChild
  // with one means it is buried deeper, where web would stick to the
  // nearest scroll ancestor but the sliver split cannot reach; say so
  // instead of silently not sticking (constitution V, specs/053).
  if (s.position == 'sticky') {
    fjsWarnOnce(
      'sticky-style-deep:${childNode.id}',
      'position: sticky on node ${childNode.id} only sticks as a scroll '
          'view\'s DIRECT child (or inside a sticky-section); use the '
          '<sticky-header> tag or move it up a level.',
    );
  }
  // absolutely-positioned children are out of flow; never expand them
  if (isOutOfFlowPosition(s.position)) return child;
  Widget out = child;
  // An inline-level box (`display: inline-block/inline`, e.g. van-stepper in
  // a cell's value div) never stretches in BLOCK flow: CSS gives it a
  // shrink-to-fit size. The same Align treatment an explicit cross size
  // gets absorbs the parent's tight cross constraint, so the box sizes to
  // its content. (The engine maps these displays to a wrapping row so the
  // CHILDREN lay out horizontally — see css/style.ts.) As a flex item its
  // display is blockified and align-items stretches it — vant's
  // inline-block button fills a <view> column on the web.
  final shrinkBox =
      blockFlow &&
      (s.display == 'inline-block' ||
          s.display == 'inline' ||
          s.display == 'inline-flex');
  // CSS `align-items: stretch` only stretches items that have no size of
  // their own on the cross axis, but Flutter's CrossAxisAlignment.stretch
  // passes a tight cross constraint to every child. An Align absorbs that
  // constraint so an explicit width (column) / height (row) survives.
  // a percentage counts as a size of its own here too: it resolves against
  // the same parent box the stretch would have filled
  final crossLength = horizontal ? s.heightLength : s.widthLength;
  final crossSized = crossLength != null || shrinkBox;
  // An item the parent does not stretch is shrink-to-fit on the cross axis
  // (CSS): its own stretch children size to the widest of them, not to the
  // parent's line — see stretch_flex.dart. An inline-block is the same box
  // under a stretching parent (the Align below loosens it).
  // Under `align-self` (crossAlign set, see [buildFlex]) the Flex always
  // stretches; an item whose own alignment is not stretch is the one the
  // parent does not stretch, and aligns itself inside its line.
  final stretched = crossAlign == null
      ? stretches
      : crossAlign == CrossAxisAlignment.stretch;
  // Under `align-self` every item is marked, the stretched ones too: the
  // box's measuring pass hands them a loose line, where CSS takes their
  // content size; the marker only acts on a loose line, so the real pass —
  // the line tight at the measured size — still stretches them.
  if (((!stretched || crossAlign != null) && crossLength == null) ||
      shrinkBox) {
    out = FjsShrinkCross(key: key, child: out);
  }
  if (crossAlign != null && !stretched) {
    // the cross factor 1 keeps the item at its own cross size when the
    // line is not tight yet (the measuring pass); a tight line — the item
    // is the line's width — puts it where its alignment says
    out = Align(
      key: _keyed(out, child) ? key : null,
      alignment: _crossAlignment(crossAlign, horizontal),
      widthFactor: horizontal ? null : 1,
      heightFactor: horizontal ? 1 : null,
      child: out,
    );
  } else if (stretches && crossSized) {
    // both cross-axis margins `auto` centre the item in the line instead
    // (`width: 300px; margin: 0 auto` in a column — block centring)
    final auto = s.marginAutoSides;
    final crossAuto = horizontal
        ? auto.top && auto.bottom
        : auto.left && auto.right;
    // CSS keeps an absolute cross size even when it is WIDER than the line:
    // the box overflows it, the overflowing part still paints (the nearest
    // `overflow: hidden` clip cuts it) and still takes hits. Align's
    // loosen() keeps the parent's max, so `width: 1038px` in a 346px line
    // clamped to the line — and with it vant's swipe track (N×100%) lost
    // every page after the first translate step: the visible item lived
    // beyond the track's box and Flutter hit-testing rejects a point
    // outside each render box, where the browser hits the overflowing item
    // under the transformed track. A percentage keeps the Align — an
    // unbounded cross reference would read back as `auto` there.
    out = crossLength != null && !crossLength.isRelative
        ? FjsUncappedCross(
            key: _keyed(out, child) ? key : null,
            horizontal: horizontal,
            centerWhenFits: crossAuto,
            child: out,
          )
        : Align(
            key: _keyed(out, child) ? key : null,
            alignment: crossAuto
                ? (horizontal ? Alignment.centerLeft : Alignment.topCenter)
                : AlignmentDirectional.topStart,
            // The factor belongs to the cross axis. Without it, a column child
            // with an explicit width still receives the column's tight width; when
            // that column itself is measured as a row item, the width can be
            // infinite and RenderPositionedBox rejects the constraint.
            widthFactor: horizontal ? null : 1,
            heightFactor: horizontal ? 1 : null,
            child: out,
          );
  }
  // A percentage on the MAIN axis. Flutter's Flex lays every child out with
  // an unbounded main axis (children size themselves first), so the child's
  // own resolver — which reads the constraint it is handed — would see
  // infinity and fall back to auto, even though this box's size is perfectly
  // well known. That is not what CSS does, and not what the same page does on
  // web: `height: 100%` in a column with a definite height resolves there.
  // Worse than the wrong size: a child that falls back to auto and has a flex
  // of its own inside (a <canvas>, a nested column) trips "non-zero flex but
  // incoming height constraints are unbounded".
  //
  // So hand that one child the box it is a percentage of. The same infinity
  // hits other properties that reference the parent box (spec 044): a %
  // margin/padding references the containing block WIDTH on every side —
  // this row's width when the main axis is horizontal — and a % left/right
  // (or top/bottom, in a column) offset references it too. Only a child
  // that actually declared one pays anything, and only a bounded max is
  // added — the child still shrink-wraps if it turns out not to want the
  // space. An unbounded box (inside a scroller) keeps falling back, which
  // is what CSS says there too.
  final needsWidthBound =
      s.hasRelativeSpacing ||
      s.leftLength?.isRelative == true ||
      s.rightLength?.isRelative == true;
  final needsHeightBound =
      s.topLength?.isRelative == true || s.bottomLength?.isRelative == true;
  final needsMainBound = horizontal ? needsWidthBound : needsHeightBound;
  final mainLength = horizontal ? s.widthLength : s.heightLength;
  if ((mainLength?.isRelative == true || needsMainBound) &&
      mainAxisMax.isFinite) {
    out = ConstrainedBox(
      key: _keyed(out, child) ? key : null,
      constraints: horizontal
          ? BoxConstraints(maxWidth: mainAxisMax)
          : BoxConstraints(maxHeight: mainAxisMax),
      child: out,
    );
  }
  // A percentage-wide row item may shrink (CSS's default `flex-shrink: 1`):
  // `input { width: 100% }` beside vant's clear icon gives up the icon's
  // width instead of overflowing the row. A loose Flexible hands it what
  // the fixed-size siblings leave; the ConstrainedBox above still caps it
  // at the percentage. (Several such items split the room evenly, where
  // CSS shrinks them in proportion to their bases — close enough for the
  // one-shrinking-item rows this is for.)
  if (horizontal &&
      mainLength?.isRelative == true &&
      mainAxisMax.isFinite &&
      (s.flexGrow ?? defaultGrow ?? 0) <= 0 &&
      (s.flexShrink ?? (_noShrinkTags.contains(childNode.tag) ? 0 : 1)) > 0) {
    return Flexible(
      key: _keyed(out, child) ? key : null,
      fit: FlexFit.loose,
      child: out,
    );
  }
  final basis = _basisSize(s, horizontal, mainAxisMax);
  if (basis != null && defaultGrow == null) {
    return SizedBox(
      key: _keyed(out, child) ? key : null,
      width: horizontal ? basis : null,
      height: horizontal ? null : basis,
      child: out,
    );
  }
  final grow = s.flexGrow ?? defaultGrow?.toDouble();
  // A growing item capped by a main-axis max (`flex: 1; max-width: 10%` —
  // vant's left-aligned divider line): CSS freezes it at the cap and hands
  // the leftover to the other growing items. Flutter's Flex splits by
  // factor and never redistributes, so the item would take its full share
  // and the cap would be lost under the tight fit. Given the cap, the item
  // almost always reaches it, so size it AT the cap as an inflexible child
  // and let the remaining items share the rest — the CSS outcome whenever
  // the row has room.
  if (grow != null && grow > 0 && mainAxisMax.isFinite) {
    final cap = horizontal ? s.maxWidthLength : s.maxHeightLength;
    final capPx = cap == null
        ? null
        : cap.isRelative
        ? cap.resolveOrNull(mainAxisMax)
        : cap.px;
    if (capPx != null && capPx < mainAxisMax) {
      return SizedBox(
        key: _keyed(out, child) ? key : null,
        width: horizontal ? capPx : null,
        height: horizontal ? null : capPx,
        child: out,
      );
    }
  }
  if (grow != null && grow > 0) {
    return Flexible(
      key: _keyed(out, child) ? key : null,
      flex: grow.round().clamp(1, 9999),
      // Expanded (a tight fit) is only legal when there IS remaining space to
      // take: in a shrink-wrapping column — inside a scroller, or any box
      // whose own height is auto — Flutter asserts "non-zero flex but
      // incoming constraints are unbounded" and the page goes red. CSS has
      // no such failure: with no free space to distribute, `flex-grow` does
      // nothing and the item keeps its content size. A loose fit is that.
      fit: mainAxisMax.isFinite ? FlexFit.tight : FlexFit.loose,
      child: out,
    );
  }
  return out;
}

/// A box whose in-flow children lay out as flex and whose
/// absolutely-positioned ones sit over the top — CSS's positioned
/// containing block, which is what `view { position: relative }` is. Only a
/// positioned box is one (again CSS): elsewhere `position: absolute` on a
/// child means "some ancestor", which this side does not chase, so the
/// child stays in flow.
///
Widget buildBox(
  FjsStyle style,
  List<Widget> kids,
  List<MirrorNode?> kidNodes, {
  bool growChildren = false,
  bool cull = false,
  bool htmlBlock = false,
}) {
  if (!style.isPositioningContext) {
    return buildFlex(
      style,
      kids,
      kidNodes,
      growChildren: growChildren,
      cull: cull,
      htmlBlock: htmlBlock,
    );
  }
  final flow = <Widget>[];
  final flowNodes = <MirrorNode>[];
  // node + widget, not the wrapped Positioned: wrapping is deferred until the
  // containing box's size is known (a relative width needs it)
  final over = <(MirrorNode?, Widget)>[];
  for (var i = 0; i < kids.length; i++) {
    final childNode = i < kidNodes.length ? kidNodes[i] : null;
    if (childNode != null &&
        isOutOfFlowPosition(FjsStyle.of(childNode).position)) {
      over.add((childNode, kids[i]));
      continue;
    }
    flow.add(kids[i]);
    if (childNode != null) flowNodes.add(childNode);
  }
  // A positioning context keeps the Stack even with no absolute child
  // (a one-child passthrough Stack lays out exactly like its child): an
  // absolute child that comes and goes — vant's expanded-title `::after`
  // hairline — would otherwise swap the widget above the in-flow content
  // and remount all of it, dropping every running transition inside (the
  // collapse arrow snapped instead of rotating).
  return stackOutOfFlow(
    style,
    buildFlex(
      style,
      flow,
      flowNodes,
      growChildren: growChildren,
      cull: cull,
      htmlBlock: htmlBlock,
    ),
    over,
  );
}

/// Lays [over] — a box's out-of-flow children, node + built widget — over
/// its in-flow content [flow]: the CSS positioned containing block. Shared
/// by [buildBox] and by paragraphs (a `<text>`/span with an absolute
/// `::before`, vant's plain tag border), whose in-flow half is a Text.rich.
///
/// An absolute child's containing block is the parent's PADDING box, but
/// this Stack is built inside the padding (decorateNode wraps it around
/// whatever buildBox returns), so the padding is handed to each child to
/// measure its offsets from the padding edge — vant's `.van-cell::after`
/// hairline is `left: 16px; right: 16px; bottom: 0` against a
/// `padding: 10px 16px` cell.
Widget stackOutOfFlow(
  FjsStyle style,
  Widget flow,
  List<(MirrorNode?, Widget)> over,
) {
  final padding = (lengths: style.paddingLengths, base: style.padding);
  // stable: equal z-index keeps tree order
  final indexed = [
    for (var i = 0; i < over.length; i++) (i, _zIndexOf(over[i].$1), over[i]),
  ]..sort((a, b) => a.$2 != b.$2 ? a.$2.compareTo(b.$2) : a.$1.compareTo(b.$1));
  final below = [
    for (final e in indexed)
      if (e.$2 < 0) e.$3,
  ];
  final above = [
    for (final e in indexed)
      if (e.$2 >= 0) e.$3,
  ];
  return Stack(
    // the box sizes to its in-flow content, and a positioned child may
    // hang outside it (`top: -4px`) exactly like it does on web
    clipBehavior: Clip.none,
    // the in-flow half gets exactly the constraints it would have had with
    // no absolute sibling: a loose fit shrank a tight-width column to its
    // widest child and pinned it top-left, so `align-items: center` in a
    // positioned box (vant's grid item) stopped centring
    fit: StackFit.passthrough,
    children: [
      for (final entry in below)
        positionedChild(entry.$1, entry.$2, padding: padding, container: style),
      // a positioned child may hang outside the flow box, so the flow
      // half keeps culling but the Stack as a whole is left alone
      flow,
      for (final entry in above)
        positionedChild(entry.$1, entry.$2, padding: padding, container: style),
    ],
  );
}

/// `z-index` among the absolute children of one containing block: CSS
/// paints them by z-index, tree order breaking ties (`auto` counts as 0),
/// negative ones under the in-flow content. vant's steps lean on it — the
/// dot's white `z-index: 1` box masks the connecting line that follows it
/// in the tree. Stacking contexts across containing blocks are not modelled
/// (css-compat.md).
int _zIndexOf(MirrorNode? node) {
  if (node == null) return 0;
  final v = FjsStyle.of(node).style['zIndex'];
  if (v is num) return v.toInt();
  return int.tryParse(v?.toString() ?? '') ?? 0;
}

/// A containing block's padding as the style declared it: [lengths] may
/// hold percentages (resolved against the box's width at layout), [base]
/// is the absolute EdgeInsets the style already merged.
typedef FjsPaddingSpec = ({FjsEdgeLengths? lengths, EdgeInsets? base});

EdgeInsets _resolvePadding(FjsPaddingSpec? p, double width) {
  if (p == null) return EdgeInsets.zero;
  final lengths = p.lengths;
  if (lengths != null && lengths.hasRelative) {
    return resolveEdgeLengths(lengths, p.base, null, width);
  }
  return p.base ?? EdgeInsets.zero;
}

/// Wraps a child in [Positioned] when it asks for absolute layout.
/// Takes the child's node directly: `kids` is built from the filtered
/// [kidNodes], so indexing back into `node.children` would misalign
/// whenever a hidden child was dropped.
///
/// [padding] is the containing block's padding (see [stackOutOfFlow]); the
/// overlay host has none.
Widget positionedChild(
  MirrorNode? childNode,
  Widget child, {
  FjsPaddingSpec? padding,
  FjsStyle? container,
}) {
  final s = childNode != null ? FjsStyle.of(childNode) : null;
  if (s == null || !isOutOfFlowPosition(s.position)) return child;
  // an interactive box may hang outside its parents and still take the
  // pointer there, as on the web (vant's Slider knob on a 2px bar)
  if (hasTapEvent(childNode!) || needsTouchNode(childNode, s)) {
    child = FjsOverflowHitTarget(child: child);
  }
  // Shrink-to-fit (CSS 10.3.7) is min(max(min-content, available),
  // max-content), and a nowrap line's min-content IS the whole line: an
  // absolute nowrap box with no width of its own is as wide as its text and
  // overflows its containing block (vant's marquee content, 577px in a
  // 314px bar — the marquee measures that width to know how far to run).
  // Flutter's Positioned would cap it at the Stack's width. A max-width
  // still clamps the shrink-to-fit result (van-ellipsis: `max-width: 100%`
  // keeps the static bar inside and lets its ellipsis show).
  if (s.whiteSpaceNowrap &&
      s.widthLength == null &&
      s.maxWidthLength == null &&
      (s.leftLength == null || s.rightLength == null)) {
    child = _UncappedWidth(
      alignEnd: s.leftLength == null && s.rightLength != null,
      child: FjsShrinkCross(child: child),
    );
  }
  final key = ValueKey<int>(childNode.id);
  final auto = s.marginAuto;
  final m = s.margin ?? EdgeInsets.zero;
  final geometry = _AbsGeometry(
    // the node's own margins offset the box from its inset (CSS resolves
    // `top: 0; margin-top: 4px` to a border box at 4); folding them in here
    // keeps the tight Positioned slot at the DECLARED size — a margin
    // Padding inside the slot would squeeze the box instead (vant's badge
    // dot came out 8x4). decoration skips the margin Padding for out-of-flow
    // boxes to match.
    left: _inset(s.leftLength, m.left),
    top: _inset(s.topLength, m.top),
    right: _inset(s.rightLength, m.right),
    bottom: _inset(s.bottomLength, m.bottom),
    width: s.widthLength,
    height: s.heightLength,
    autoX: auto.horizontal,
    autoY: auto.vertical,
    padding: padding,
  );
  // A percentage (spec 044's `top: 50%`, vant's `inset: -50%` hairline box,
  // the overlay's `width: 100%`) or auto-margin centring needs the
  // containing block's FINAL size, which a Stack only knows once its
  // in-flow child is laid out — not the incoming constraint, which for a
  // shrink-wrapped box is the wrong number (the grid hairline came out a
  // third of its cell's height). Positioned.fill hands a layout delegate
  // exactly that size; it resolves the box there.
  if (geometry.needsLayoutSize) {
    return Positioned.fill(
      key: key,
      child: _animateAbsGeometry(
        style: s,
        geometry: geometry,
        build: (g) => CustomSingleChildLayout(
          delegate: _AbsLayoutDelegate(g),
          child: child,
        ),
      ),
    );
  }
  // All-absolute: plain Positioned, resolved now — through the same
  // animation helper as the delegate path, so a CSS transition on a px
  // inset interpolates too (web does).
  Widget buildPlain(_AbsGeometry g) {
    final pad = _resolvePadding(padding, 0);
    var left = g.left?.px;
    var right = g.right?.px;
    var top = g.top?.px;
    var bottom = g.bottom?.px;
    final width = g.width?.px;
    final height = g.height?.px;
    // padding edge -> the Stack's (content-box) coordinates
    if (left != null) left -= pad.left;
    if (right != null) right -= pad.right;
    if (top != null) top -= pad.top;
    if (bottom != null) bottom -= pad.bottom;
    // CSS over-constrains without complaint — vant sets `left: 0; right: 0;
    // width: 100%` on its bottom popups — and resolves LTR by keeping
    // left+width. Flutter's Positioned ASSERTS on the same trio, so drop the
    // edge CSS would have discarded.
    if (left != null && width != null) right = null;
    if (right != null && width != null) left = null;
    if (top != null && height != null) bottom = null;
    if (bottom != null && height != null) top = null;
    // Static position (CSS Flexbox §4.1): an absolute child of a flex
    // container with both cross-axis insets `auto` sits where it would as
    // the container's sole item — `align-items`/`align-self` place it on the
    // cross axis. vant's notice bar centres its absolute marquee text in the
    // 40px bar this way; the Stack would pin it to the top. Only center/end
    // are handled: start is where the Stack puts it already.
    final cross = _staticCrossAlignment(container, s);
    if (cross != null) {
      final row = container!.flexDirection == 'row';
      // a cross size of its own is fine: the node's box keeps it (the Align
      // below loosens the slot), only a cross-axis inset takes it over
      final free = row
          ? top == null && bottom == null
          : left == null && right == null;
      if (free) {
        // Laid out non-positioned (no inset, no size) the Stack hands it its
        // own box, tight; otherwise pin the cross axis to the containing
        // block's edges. Either way the Align places it on the cross axis
        // and sizes to it on the main one.
        final positioned =
            left != null ||
            right != null ||
            top != null ||
            bottom != null ||
            width != null ||
            height != null;
        final aligned = Align(
          alignment: row
              ? Alignment(left == null && right != null ? 1 : -1, cross)
              : Alignment(cross, top == null && bottom != null ? 1 : -1),
          widthFactor: positioned && row ? 1 : null,
          heightFactor: positioned && !row ? 1 : null,
          child: child,
        );
        return Positioned(
          key: key,
          left: positioned && !row ? 0 : left,
          top: positioned && row ? 0 : top,
          right: positioned && !row ? 0 : right,
          bottom: positioned && row ? 0 : bottom,
          // the node's own box keeps a declared cross size
          width: positioned && !row ? null : width,
          height: positioned && row ? null : height,
          child: aligned,
        );
      }
    }
    return Positioned(
      key: key,
      left: left,
      top: top,
      right: right,
      bottom: bottom,
      width: width,
      height: height,
      child: child,
    );
  }

  return _animateAbsGeometry(style: s, geometry: geometry, build: buildPlain);
}

/// The cross-axis [Alignment] component (-1…1) for an absolute child's
/// static position in a CSS flex [container], or null when it stays at
/// the start (no flex container, start/stretch alignment).
double? _staticCrossAlignment(FjsStyle? container, FjsStyle child) {
  if (container == null) return null;
  final display = container.display;
  if (display != 'flex' && display != 'inline-flex') return null;
  final align = child.alignSelf ?? container.alignItems;
  return switch (align) {
    CrossAxisAlignment.center => 0,
    CrossAxisAlignment.end => 1,
    _ => null,
  };
}

/// An absolutely positioned box's declared geometry, resolved against the
/// containing block at layout time by [_AbsLayoutDelegate].
@immutable
class _AbsGeometry {
  const _AbsGeometry({
    this.left,
    this.top,
    this.right,
    this.bottom,
    this.width,
    this.height,
    this.autoX = false,
    this.autoY = false,
    this.padding,
  });

  final FjsLength? left, top, right, bottom, width, height;
  final bool autoX, autoY;
  final FjsPaddingSpec? padding;

  /// A copy with one declared length replaced — the animated value while a
  /// CSS transition runs on that property (see [_animateAbsGeometry]).
  _AbsGeometry copy({
    FjsLength? left,
    FjsLength? top,
    FjsLength? right,
    FjsLength? bottom,
    FjsLength? width,
    FjsLength? height,
  }) => _AbsGeometry(
    left: left ?? this.left,
    top: top ?? this.top,
    right: right ?? this.right,
    bottom: bottom ?? this.bottom,
    width: width ?? this.width,
    height: height ?? this.height,
    autoX: autoX,
    autoY: autoY,
    padding: padding,
  );

  bool get needsLayoutSize =>
      left?.isRelative == true ||
      top?.isRelative == true ||
      right?.isRelative == true ||
      bottom?.isRelative == true ||
      width?.isRelative == true ||
      height?.isRelative == true ||
      padding?.lengths?.hasRelative == true ||
      // centring via auto margins needs the box too
      (autoX && left != null && right != null && width != null) ||
      (autoY && top != null && bottom != null && height != null);

  @override
  bool operator ==(Object other) =>
      other is _AbsGeometry &&
      other.left == left &&
      other.top == top &&
      other.right == right &&
      other.bottom == bottom &&
      other.width == width &&
      other.height == height &&
      other.autoX == autoX &&
      other.autoY == autoY &&
      other.padding == padding;

  @override
  int get hashCode => Object.hash(
    left,
    top,
    right,
    bottom,
    width,
    height,
    autoX,
    autoY,
    padding,
  );
}

/// Places one absolute child inside a Positioned.fill slot — the Stack's
/// content box — using CSS's rules against the PADDING box around it.
class _AbsLayoutDelegate extends SingleChildLayoutDelegate {
  _AbsLayoutDelegate(this.g);

  final _AbsGeometry g;

  // resolved per layout; getPositionForChild runs right after
  // getConstraintsForChild for the same size
  late EdgeInsets _pad;
  late double _boxW, _boxH;
  double? _l, _t, _r, _b, _w, _h;

  void _resolve(Size content) {
    _pad = _resolvePadding(g.padding, content.width);
    _boxW = content.width + _pad.horizontal;
    _boxH = content.height + _pad.vertical;
    double? px(FjsLength? v, double ref) =>
        v == null ? null : (v.isRelative ? v.resolveOrNull(ref) : v.px);
    _l = px(g.left, _boxW);
    _r = px(g.right, _boxW);
    _t = px(g.top, _boxH);
    _b = px(g.bottom, _boxH);
    _w = px(g.width, _boxW);
    _h = px(g.height, _boxH);
  }

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) {
    _resolve(constraints.biggest);
    double? span(double? a, double? b, double? size, double box) {
      if (size != null) return size.clamp(0.0, double.infinity);
      // negative insets grow the box past its containing block (vant's
      // hairline box is `inset: -50%` then `scale(.5)`), so no upper bound
      if (a != null && b != null)
        return (box - a - b).clamp(0.0, double.infinity);
      return null;
    }

    final w = span(_l, _r, _w, _boxW);
    final h = span(_t, _b, _h, _boxH);
    // an auto size shrink-wraps, as RenderStack does for a one-edged child
    return BoxConstraints(
      minWidth: w ?? 0,
      maxWidth: w ?? double.infinity,
      minHeight: h ?? 0,
      maxHeight: h ?? double.infinity,
    );
  }

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    double place(
      double? lead,
      double? trail,
      bool auto,
      double box,
      double child,
    ) {
      if (lead != null) {
        // both edges + a size + auto margins: CSS gives the leftover to the
        // margins in equal parts (vant's dialog: `left: 0; right: 0;
        // width: 320px; margin: 0 auto`)
        if (auto && trail != null) {
          final room = box - lead - trail - child;
          if (room > 0) return lead + room / 2;
        }
        return lead;
      }
      if (trail != null) return box - trail - child;
      return 0;
    }

    final x = place(_l, _r, g.autoX, _boxW, childSize.width);
    final y = place(_t, _b, g.autoY, _boxH, childSize.height);
    // padding edge -> the Stack's (content-box) coordinates
    return Offset(x - _pad.left, y - _pad.top);
  }

  @override
  bool shouldRelayout(_AbsLayoutDelegate oldDelegate) => oldDelegate.g != g;
}

/// A length tween over the px+percent pair: both components move together,
/// which is CSS's calc() interpolation — `10px → 50%` sweeps the same pair a
/// `calc(10px + 0%) → calc(0px + 50%)` declaration would.
class _FjsLengthTween extends Tween<FjsLength> {
  _FjsLengthTween({required FjsLength super.end});

  @override
  FjsLength lerp(double t) {
    final b = begin!;
    final e = end!;
    return FjsLength(
      b.px + (e.px - b.px) * t,
      b.percent + (e.percent - b.percent) * t,
    );
  }
}

/// An inset with the node's own absolute margin folded in: CSS resolves
/// `top: 0; margin-top: 4px` to a border box at 4. Percent insets stay
/// percent (their reference is the containing block, which the delegate
/// resolves); percent MARGINS are width-referenced on every side and can
/// not fold into a top/bottom inset (height-referenced) — the style keeps
/// them out of [EdgeInsets], so they arrive here as zero and an abs box
/// with percent vertical margins loses them.
FjsLength? _inset(FjsLength? inset, double margin) =>
    inset == null ? null : FjsLength(inset.px + margin, inset.percent);

const _absGeometryProps = ['left', 'top', 'right', 'bottom', 'width', 'height'];

FjsLength? _absLengthOf(_AbsGeometry g, String name) => switch (name) {
  'left' => g.left,
  'top' => g.top,
  'right' => g.right,
  'bottom' => g.bottom,
  'width' => g.width,
  _ => g.height,
};

_AbsGeometry _withAbsLength(_AbsGeometry g, String name, FjsLength v) =>
    switch (name) {
      'left' => g.copy(left: v),
      'top' => g.copy(top: v),
      'right' => g.copy(right: v),
      'bottom' => g.copy(bottom: v),
      'width' => g.copy(width: v),
      _ => g.copy(height: v),
    };

/// Runs [build] once with the declared geometry — or, when the node's CSS
/// transitions cover left/top/right/bottom/width/height, once per animation
/// frame with the interpolated lengths. The delegate path (percentages, auto
/// margins) and the plain Positioned path both go through here: without it a
/// change jumps straight to the resolved value, because layout resolves the
/// length in one pass (spec 073: vant's progress portion is `width: 70%` and
/// its pivot `left: 70%`, and the browser tweens both under the components'
/// `transition: all`).
///
/// FjsLength is a px+percent pair, so lerping the components is always valid
/// and the delegate then resolves the interpolated length exactly as it
/// resolves a static one. Each animated property gets its own
/// [TweenAnimationBuilder], nested so the innermost [build] sees every
/// length: a level's builder re-runs on each tick of its own tween and
/// rebuilds the levels below it, so an inner length always moves against the
/// outer level's latest value (its end value once that one finished). The
/// box's structure — which insets are declared, over-constrained dropping,
/// static cross position — derives from null-ness, which the animation does
/// not change, so a per-frame [build] cannot re-branch.
///
/// track.delay is not honored here (TweenAnimationBuilder has no delay hook,
/// the same gap as the background/size paths in decoration.dart);
/// transitionend for width/height keeps coming from the node's own size
/// animation there, the insets dispatch none.
Widget _animateAbsGeometry({
  required FjsStyle style,
  required _AbsGeometry geometry,
  required Widget Function(_AbsGeometry animated) build,
}) {
  final transitions = style.transitions;
  if (transitions == null) return build(geometry);

  FjsTransitionTrack? live(String name) {
    final track = transitions.forProperty(name);
    return track != null && track.duration > Duration.zero ? track : null;
  }

  Widget nest(int index, _AbsGeometry g) {
    if (index == _absGeometryProps.length) return build(g);
    final name = _absGeometryProps[index];
    final value = _absLengthOf(g, name);
    final track = live(name);
    if (value == null || track == null) return nest(index + 1, g);
    return TweenAnimationBuilder<FjsLength>(
      tween: _FjsLengthTween(end: value),
      duration: track.duration,
      curve: track.curve,
      builder: (_, animated, _) =>
          nest(index + 1, _withAbsLength(g, name, animated)),
    );
  }

  return nest(0, geometry);
}

/// Lays its child out with no width cap and takes the child's size clamped
/// to its own constraints — the child paints (and hit-tests) past the edge
/// it overflows. OverflowBox with a defer-to-child fit, which this Flutter
/// does not have; [alignEnd] pins the child's right edge instead of its
/// left (a box placed by `right:`).
class _UncappedWidth extends SingleChildRenderObjectWidget {
  const _UncappedWidth({required this.alignEnd, super.child});

  final bool alignEnd;

  @override
  _RenderUncappedWidth createRenderObject(BuildContext context) =>
      _RenderUncappedWidth(alignEnd);

  @override
  void updateRenderObject(
    BuildContext context,
    _RenderUncappedWidth renderObject,
  ) {
    renderObject.alignEnd = alignEnd;
  }
}

class _RenderUncappedWidth extends RenderShiftedBox {
  _RenderUncappedWidth(this._alignEnd) : super(null);

  bool _alignEnd;
  set alignEnd(bool v) {
    if (v == _alignEnd) return;
    _alignEnd = v;
    markNeedsLayout();
  }

  @override
  void performLayout() {
    final c = child;
    if (c == null) {
      size = constraints.smallest;
      return;
    }
    c.layout(
      BoxConstraints(
        minHeight: constraints.minHeight,
        maxHeight: constraints.maxHeight,
      ),
      parentUsesSize: true,
    );
    size = constraints.constrain(c.size);
    (c.parentData! as BoxParentData).offset = Offset(
      _alignEnd ? size.width - c.size.width : 0,
      0,
    );
  }

  @override
  bool hitTestSelf(Offset position) => false;

  @override
  bool hitTest(BoxHitTestResult result, {required Offset position}) =>
      // the overflowing part is still the child's
      hitTestChildren(result, position: position);
}

/// A stretched flex item whose absolute cross size is wider than the line it
/// stretches into: CSS keeps the declared size, the box overflows the line,
/// and the part past the edge still paints (the ancestor's `overflow: hidden`
/// clip is what cuts it) and still takes hits — unlike [Align], whose
/// loosen() carries the parent's max and clamps the child to the line, and
/// unlike a plain render box, whose hit testing rejects points outside its
/// own size. [_flexChild] sends absolute cross lengths here; percentages
/// stay on [Align] because an unbounded cross reference reads back as auto.
///
/// Kinship: [_UncappedWidth] is the same idea for an absolutely positioned
/// box; this one is for an in-flow stretch item, so the axis to uncap
/// follows the parent's direction.
class FjsUncappedCross extends SingleChildRenderObjectWidget {
  const FjsUncappedCross({
    required this.horizontal,
    this.centerWhenFits = false,
    super.key,
    super.child,
  });

  /// Whether the parent's main axis is horizontal, i.e. the cross axis to
  /// uncap is HEIGHT.
  final bool horizontal;

  /// Both cross margins `auto`: centre the child while it fits the line;
  /// CSS over-constrains an overflowing box to the start edge (ltr), so an
  /// oversized child stays at offset 0.
  final bool centerWhenFits;

  @override
  RenderFjsUncappedCross createRenderObject(BuildContext context) =>
      RenderFjsUncappedCross(horizontal, centerWhenFits);

  @override
  void updateRenderObject(
    BuildContext context,
    covariant RenderFjsUncappedCross renderObject,
  ) {
    renderObject
      ..horizontal = horizontal
      ..centerWhenFits = centerWhenFits;
  }
}

class RenderFjsUncappedCross extends RenderShiftedBox {
  RenderFjsUncappedCross(this._horizontal, this._centerWhenFits) : super(null);

  bool _horizontal;
  set horizontal(bool v) {
    if (v == _horizontal) return;
    _horizontal = v;
    markNeedsLayout();
  }

  bool _centerWhenFits;
  set centerWhenFits(bool v) {
    if (v == _centerWhenFits) return;
    _centerWhenFits = v;
    markNeedsLayout();
  }

  @override
  void performLayout() {
    final c = child;
    if (c == null) {
      size = constraints.smallest;
      return;
    }
    // Loosen both axes like the Align this sits next to: a growing item
    // (Flexible's tight fit) with its own explicit size keeps the declared
    // size, and a percentage child inside reads the max as its reference.
    // The cross max goes to infinity — that is the uncapping.
    c.layout(
      _horizontal
          ? constraints.loosen().copyWith(maxHeight: double.infinity)
          : constraints.loosen().copyWith(maxWidth: double.infinity),
      parentUsesSize: true,
    );
    // the line's cross size is this box's size, whatever the child kept
    size = constraints.constrain(c.size);
    final fits = _horizontal
        ? c.size.height <= size.height
        : c.size.width <= size.width;
    final center = _centerWhenFits && fits;
    (c.parentData! as BoxParentData).offset = _horizontal
        ? Offset(0, center ? (size.height - c.size.height) / 2 : 0)
        : Offset(center ? (size.width - c.size.width) / 2 : 0, 0);
  }

  @override
  bool hitTest(BoxHitTestResult result, {required Offset position}) =>
      // the child overflows this box by design; its part past the edge is
      // still hittable, as on the web
      hitTestChildren(result, position: position);
}
