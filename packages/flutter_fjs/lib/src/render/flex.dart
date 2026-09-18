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

import '../mirror_tree.dart';
import '../widgets/control_scope.dart' show fjsWarnOnce;
import 'cull.dart';
import 'length.dart';
import 'style.dart';

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
}) {
  final horizontal = (style.flexDirection ?? 'column') == 'row';
  final axis = horizontal ? Axis.horizontal : Axis.vertical;
  // main-axis gap is column-gap on a row, row-gap on a column (as in CSS);
  // `gap` is the shorthand for both
  final gap = horizontal ? style.columnGap : style.rowGap;
  final crossGap = horizontal ? style.rowGap : style.columnGap;
  if (style.flexWrap) {
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
        return Wrap(
          direction: axis,
          spacing: gap ?? 0,
          runSpacing: crossGap ?? 0,
          alignment: style.wrapAlignment,
          crossAxisAlignment: style.wrapCrossAlignment,
          children: [
            for (var i = 0; i < kids.length; i++)
              _wrapChild(
                child: kids[i],
                childNode: i < kidNodes.length ? kidNodes[i] : null,
                horizontal: horizontal,
                mainAxisMax: mainAxisMax,
              ),
          ],
        );
      },
    );
  }
  final crossAlignment =
      style.alignItems ??
      (horizontal ? CrossAxisAlignment.center : CrossAxisAlignment.stretch);
  return LayoutBuilder(
    builder: (context, constraints) {
      // A scroll view gives its content an unbounded cross axis. Flutter's
      // stretch implementation turns that into a tight Infinity constraint,
      // which is invalid even when a descendant has a finite width/height.
      // CSS stretch also has no meaningful size to stretch to in this case,
      // so start is the closest finite fallback.
      final crossBounded = horizontal
          ? constraints.hasBoundedHeight
          : constraints.hasBoundedWidth;
      final effectiveCrossAlignment =
          !crossBounded && crossAlignment == CrossAxisAlignment.stretch
          ? CrossAxisAlignment.start
          : crossAlignment;
      final entries = <(Widget, MirrorNode?)>[
        for (var i = 0; i < kids.length; i++) ...[
          if (gap != null && i > 0)
            (horizontal ? SizedBox(width: gap) : SizedBox(height: gap), null),
          (kids[i], i < kidNodes.length ? kidNodes[i] : null),
        ],
      ];
      // What a percentage on the main axis is a percentage OF: this box's
      // content box, the same reference CSS uses. Flex hands its children an
      // unbounded main axis, so a child cannot read it from its own
      // constraints — see [_flexChild].
      final mainAxisMax = horizontal
          ? constraints.maxWidth
          : constraints.maxHeight;
      final children = [
        for (final (child, childNode) in entries)
          _flexChild(
            child: child,
            childNode: childNode,
            horizontal: horizontal,
            stretches: effectiveCrossAlignment == CrossAxisAlignment.stretch,
            mainAxisMax: mainAxisMax,
            defaultGrow: growChildren ? 1 : null,
          ),
      ];
      if (cull) {
        return FjsCullingFlex(
          direction: axis,
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: style.justifyContent ?? MainAxisAlignment.start,
          crossAxisAlignment: effectiveCrossAlignment,
          textBaseline: TextBaseline.alphabetic,
          children: children,
        );
      }
      return Flex(
        direction: axis,
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: style.justifyContent ?? MainAxisAlignment.start,
        crossAxisAlignment: effectiveCrossAlignment,
        textBaseline: TextBaseline.alphabetic,
        children: children,
      );
    },
  );
}

/// Wraps one WRAP child (a flex item of a `flex-wrap` container).
///
/// See the comment at the [Wrap] site in [buildFlex]: the main-axis
/// constraint is relaxed so a plain box shrink-to-fits like it does on web.
/// The one exception is a child that declared a main-axis percentage — it
/// keeps the run limit as the reference its percentage resolves against.
Widget _wrapChild({
  required Widget child,
  required MirrorNode? childNode,
  required bool horizontal,
  required double mainAxisMax,
}) {
  if (childNode == null) return child;
  final s = FjsStyle.of(childNode);
  if (s.position == 'absolute') return child;
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
  return UnconstrainedBox(
    alignment: AlignmentDirectional.topStart,
    constrainedAxis: horizontal ? Axis.vertical : Axis.horizontal,
    child: child,
  );
}

/// Wraps one flex child.
///
/// Every wrapper carries the child's own key. A wrapper is what the parent's
/// element reconciles against, so an unkeyed one makes Flutter match children
/// by POSITION: after a reorder, position 0 holds a different node than
/// before, `canUpdate` fails on the mismatched keys inside, and the whole
/// subtree is rebuilt from scratch. Keying the wrapper is what lets a move
/// stay a move.
Widget _flexChild({
  required Widget child,
  required MirrorNode? childNode,
  required bool horizontal,
  required bool stretches,
  required double mainAxisMax,
  int? defaultGrow,
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
  if (s.position == 'absolute') return child;
  Widget out = child;
  // CSS `align-items: stretch` only stretches items that have no size of
  // their own on the cross axis, but Flutter's CrossAxisAlignment.stretch
  // passes a tight cross constraint to every child. An Align absorbs that
  // constraint so an explicit width (column) / height (row) survives.
  // a percentage counts as a size of its own here too: it resolves against
  // the same parent box the stretch would have filled
  final crossLength = horizontal ? s.heightLength : s.widthLength;
  final crossSized = crossLength != null;
  if (stretches && crossSized) {
    out = Align(
      key: key,
      alignment: AlignmentDirectional.topStart,
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
      key: identical(out, child) ? key : null,
      constraints: horizontal
          ? BoxConstraints(maxWidth: mainAxisMax)
          : BoxConstraints(maxHeight: mainAxisMax),
      child: out,
    );
  }
  final grow = s.flexGrow ?? defaultGrow?.toDouble();
  if (grow != null && grow > 0) {
    return Flexible(
      key: identical(out, child) ? key : null,
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
}) {
  if (!style.isPositioningContext) {
    return buildFlex(
      style,
      kids,
      kidNodes,
      growChildren: growChildren,
      cull: cull,
    );
  }
  final flow = <Widget>[];
  final flowNodes = <MirrorNode>[];
  // node + widget, not the wrapped Positioned: wrapping is deferred until the
  // containing box's size is known (a relative width needs it)
  final over = <(MirrorNode?, Widget)>[];
  for (var i = 0; i < kids.length; i++) {
    final childNode = i < kidNodes.length ? kidNodes[i] : null;
    if (childNode != null && FjsStyle.of(childNode).position == 'absolute') {
      over.add((childNode, kids[i]));
      continue;
    }
    flow.add(kids[i]);
    if (childNode != null) flowNodes.add(childNode);
  }
  if (over.isEmpty) {
    return buildFlex(
      style,
      kids,
      kidNodes,
      growChildren: growChildren,
      cull: cull,
    );
  }
  Widget stack(BoxConstraints? outer) => Stack(
    // the box sizes to its in-flow content, and a positioned child may
    // hang outside it (`top: -4px`) exactly like it does on web
    clipBehavior: Clip.none,
    children: [
      // a positioned child may hang outside the flow box, so the flow
      // half keeps culling but the Stack as a whole is left alone
      buildFlex(style, flow, flowNodes, growChildren: growChildren, cull: cull),
      for (final entry in over) positionedChild(entry.$1, entry.$2, outer),
    ],
  );
  // Only a positioned child that declared a relative width/height or a
  // relative offset (`top: 50%`, spec 044) needs the extra LayoutBuilder —
  // see [positionedChild] for why it cannot read the box from its own
  // constraints.
  final relative = over.any((entry) {
    final s = entry.$1 == null ? null : FjsStyle.of(entry.$1!);
    return s?.widthLength?.isRelative == true ||
        s?.heightLength?.isRelative == true ||
        s?.leftLength?.isRelative == true ||
        s?.topLength?.isRelative == true ||
        s?.rightLength?.isRelative == true ||
        s?.bottomLength?.isRelative == true;
  });
  if (!relative) return stack(null);
  return LayoutBuilder(builder: (context, constraints) => stack(constraints));
}

/// Wraps a child in [Positioned] when it asks for absolute layout.
/// Takes the child's node directly: `kids` is built from the filtered
/// [kidNodes], so indexing back into `node.children` would misalign
/// whenever a hidden child was dropped.
Widget positionedChild(
  MirrorNode? childNode,
  Widget child, [
  BoxConstraints? outer,
]) {
  final s = childNode != null ? FjsStyle.of(childNode) : null;
  if (s?.position != 'absolute') return child;
  // Positioned wants pixels at build time, so a relative width/height — or
  // offset (spec 044) — is resolved here, against [outer] — the space the
  // positioned box was offered, which is its own size whenever it has a
  // definite one (the case `width: 100%` on an overlay means). Leaving it
  // to the child does NOT work: RenderStack lays a child out with
  // `BoxConstraints()` — unbounded on both axes — unless it was given both
  // edges or an explicit size, so the child's own resolver sees infinity
  // and falls back to auto, and a full-cover overlay collapses to its text.
  double? side(FjsLength? length, double reference) {
    if (length == null) return null;
    if (!length.isRelative) return length.px;
    return outer == null ? null : length.resolveOrNull(reference);
  }

  return Positioned(
    key: ValueKey<int>(childNode!.id),
    // CSS absolute offsets: left/right measure the containing block's
    // width, top/bottom its height — the same `outer` the sizes use
    left: side(s!.leftLength, outer?.maxWidth ?? double.infinity),
    top: side(s.topLength, outer?.maxHeight ?? double.infinity),
    right: side(s.rightLength, outer?.maxWidth ?? double.infinity),
    bottom: side(s.bottomLength, outer?.maxHeight ?? double.infinity),
    width: side(s.widthLength, outer?.maxWidth ?? double.infinity),
    height: side(s.heightLength, outer?.maxHeight ?? double.infinity),
    child: child,
  );
}
