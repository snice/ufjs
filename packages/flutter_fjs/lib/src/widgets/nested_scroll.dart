// nested-scroll-header / nested-scroll-body (specs/208): the Dart half of
// the nested-scroll contract. WeChat's pair is Skyline-only; this side earns
// the same observable behaviour with a plain CustomScrollView route — the
// scroll-view adapter takes it when its DIRECT children carry the tags, the
// same child-shape routing widgets/sticky.dart established.
//
// The scroll model is a SINGLE scroller (the same semantics the web side
// ships): headers ride out with the scroll, and the scroller directly inside
// a body is ABSORBED — it gives up its Scrollable (FjsNestedBodyScope) so its
// rows join the outer scroll. One scroll position means collapse and row
// scrolling carry one fling, and the outer scroll-view's @scroll / edge
// events keep firing for the whole thing; the absorbed scroller's own
// scroll-top / @scroll are inert (registered in docs/ui-api.md). skyline
// keeps the native pair with a real inner scroller.
//
// offset-top (a body prop, wx 3.6.2+) is the one measured piece: the LAST
// header becomes FjsCollapseHeaderSliver, which scrolls away like a box
// adapter but holds its bottom tail at the viewport's leading edge once the
// collapse point passes — the body keeps sliding up beneath it, which reads
// exactly like skyline's clip when the tail is opaque.
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart'
    show
        RenderSliverToBoxAdapter,
        SliverConstraints,
        SliverGeometry,
        SliverPhysicalParentData;

import '../mirror_tree.dart' show MirrorNode;
import '../node/node_adapter.dart';
import '../render/decoration.dart';
import '../render/flex.dart';
import '../render/style.dart';
import 'control_scope.dart' show fjsWarnOnce;

const String fjsNestedHeaderTag = 'nested-scroll-header';
const String fjsNestedBodyTag = 'nested-scroll-body';

bool fjsIsNestedTag(String? tag) =>
    tag == fjsNestedHeaderTag || tag == fjsNestedBodyTag;

/// wx offset-top (nested-scroll-body, 3.6.2+): the collapse inset, px.
double fjsNestedOffsetTop(MirrorNode node) {
  final raw = node.props['offsetTop'];
  if (raw is num) return raw.toDouble();
  return double.tryParse('${raw ?? ''}') ?? 0;
}

/// Marks a subtree as absorbed into the enclosing nested scroll (spec 208):
/// vertical scrollers below it give up their own scrolling. A scroller that
/// absorbs re-wraps its content with `absorbed: false`, so only the DIRECT
/// scroller of a body joins the outer scroll — a carousel deeper inside
/// keeps its own gestures.
class FjsNestedBodyScope extends InheritedWidget {
  const FjsNestedBodyScope({
    super.key,
    required this.absorbed,
    required super.child,
  });

  final bool absorbed;

  /// Not dependOnInherited: a scroller never needs to rebuild on this
  /// flipping — the nested split above it rebuilds the whole subtree.
  static bool absorbedOf(BuildContext context) =>
      context.getInheritedWidgetOfExactType<FjsNestedBodyScope>()?.absorbed ??
      false;

  @override
  bool updateShouldNotify(FjsNestedBodyScope oldWidget) =>
      oldWidget.absorbed != absorbed;
}

/// What the nested split produced: the sliver list for the scroll-view's
/// CustomScrollView.
class FjsNestedSplit {
  const FjsNestedSplit(this.slivers);

  final List<Widget> slivers;
}

/// Splits the scroll content around the nested tags. Plain children are
/// chunked into runs laid out by the scroll-view's own flex baseline — the
/// same [buildFlex] the non-sticky path feeds every child through — so an
/// ordinary child keeps its direction / align / gap. Headers and the body
/// render their FIRST child element only (wx semantics); a body additionally
/// opens the absorption scope around that child.
FjsNestedSplit fjsNestedSplit({
  required FjsNodeAdapterContext context,
  required FjsStyle scrollStyle,
  required List<MirrorNode> nodes,
  required List<Widget> kids,
}) {
  // The collapse tail belongs to the LAST header; the inset comes from the
  // first body's offset-top. A tail taller than the header it pins is
  // clamped in the sliver (and warned there).
  var lastHeaderIndex = -1;
  var offsetTop = 0.0;
  for (var i = 0; i < nodes.length; i++) {
    final node = nodes[i];
    if (node.tag == fjsNestedHeaderTag) lastHeaderIndex = i;
    if (node.tag == fjsNestedBodyTag && offsetTop == 0.0) {
      offsetTop = fjsNestedOffsetTop(node);
    }
  }
  final slivers = <Widget>[];
  final run = <Widget>[];
  final runNodes = <MirrorNode?>[];

  void flushRun() {
    if (run.isEmpty) return;
    // COPY the run: buildFlex wraps it in a LayoutBuilder whose builder only
    // runs at LAYOUT time, after these lists are cleared (widgets/sticky.dart).
    slivers.add(
      SliverToBoxAdapter(
        child: buildFlex(
          scrollStyle,
          List.of(run),
          List.of(runNodes),
          cull: true,
        ),
      ),
    );
    run.clear();
    runNodes.clear();
  }

  for (var i = 0; i < kids.length; i++) {
    final node = i < nodes.length ? nodes[i] : null;
    final kid = kids[i];
    if (node == null || !fjsIsNestedTag(node.tag)) {
      run.add(kid);
      runNodes.add(node);
      continue;
    }
    flushRun();
    if (node.tag == fjsNestedHeaderTag) {
      final content = _nestedChildBox(context, node);
      slivers.add(
        i == lastHeaderIndex && offsetTop > 0
            ? FjsCollapseHeaderSliver(tail: offsetTop, child: content)
            : SliverToBoxAdapter(child: content),
      );
    } else {
      slivers.add(
        SliverToBoxAdapter(
          child: FjsNestedBodyScope(
            absorbed: true,
            child: _nestedChildBox(context, node),
          ),
        ),
      );
    }
  }
  flushRun();
  return FjsNestedSplit(slivers);
}

/// The tag's own box, first child element only (wx renders exactly that),
/// through the same build the view adapter runs so its padding/background
/// keep working. The explicit global key keeps scroll-into-view able to land
/// on a node inside the header or body.
Widget _nestedChildBox(FjsNodeAdapterContext context, MirrorNode node) {
  final style = FjsStyle.of(node);
  MirrorNode? first;
  for (final id in node.children) {
    final child = context.tree.node(id);
    if (child != null) {
      first = child;
      break;
    }
  }
  final kids = <Widget>[];
  final kidNodes = <MirrorNode?>[];
  if (first != null) {
    kids.add(context.buildNode(context.flutterContext, first));
    kidNodes.add(first);
  }
  return KeyedSubtree(
    key: context.tree.globalKeyFor(node.id),
    child: decorateNode(style, buildBox(style, kids, kidNodes)),
  );
}

/// Standalone fallback: the tag reached its own adapter, so it is not a
/// direct child of a type="nested" scroll-view. Warn once (constitution V)
/// and render the first-child box.
Widget fjsNestedFallbackBox(FjsNodeAdapterContext context) {
  fjsWarnOnce(
    'nested-standalone:${context.node.tag}:${context.node.id}',
    '<${context.node.tag}> node ${context.node.id} only works as a direct '
    'child of <scroll-view type="nested">; rendered as a plain container.',
  );
  return _nestedChildBox(context, context.node);
}

/// The LAST nested-scroll-header when the body carries offset-top > 0.
/// Scrolls away like a box adapter, but past the collapse point it holds its
/// bottom [tail] px at the viewport's leading edge while the content after
/// it keeps sliding up beneath the tail.
class FjsCollapseHeaderSliver extends SingleChildRenderObjectWidget {
  const FjsCollapseHeaderSliver({super.key, required this.tail, super.child});

  /// Collapse inset from the body's offset-top, px. Clamped to the header's
  /// measured height — an inset taller than the header pins the whole
  /// header (wx's collapse point is then unreachable, same reading).
  final double tail;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderCollapseHeader(tail);

  @override
  void updateRenderObject(
    BuildContext context,
    covariant _RenderCollapseHeader renderObject,
  ) {
    renderObject.tail = tail;
  }
}

class _RenderCollapseHeader extends RenderSliverToBoxAdapter {
  _RenderCollapseHeader(this.tail);

  double tail;

  double get _childExtent => child?.size.height ?? 0;
  double get _tail => math.min(tail, _childExtent);

  /// Scroll offset at which the tail reaches the leading edge.
  double get _pinAt => math.max(0.0, _childExtent - _tail);

  @override
  void performLayout() {
    if (child == null) {
      geometry = SliverGeometry.zero;
      return;
    }
    final constraints = this.constraints;
    child!.layout(constraints.asBoxConstraints(), parentUsesSize: true);
    final childExtent = _childExtent;
    final pinned = constraints.scrollOffset >= _pinAt;
    final double paintExtent = pinned
        ? math.min(_tail, constraints.remainingPaintExtent)
        : calculatePaintOffset(constraints, from: 0.0, to: childExtent);
    geometry = SliverGeometry(
      // scrollExtent stays the FULL child extent: the rest position of
      // everything after this sliver never depends on the pin.
      scrollExtent: childExtent,
      paintExtent: paintExtent,
      // layoutExtent is where the FOLLOWING slivers sit: full while
      // collapsing, zero once pinned — that is exactly what lets the body
      // slide up beneath the held tail. RenderSliverPinnedPersistentHeader
      // follows the same pattern; a delegate's maxExtent cannot be used
      // here because the header height is a JS layout product, not a
      // build-time constant.
      layoutExtent: pinned ? 0.0 : paintExtent,
      maxPaintExtent: childExtent,
      maxScrollObstructionExtent: _tail,
      cacheExtent: pinned ? 0.0 : calculateCacheOffset(constraints, from: 0.0, to: childExtent),
      hitTestExtent: paintExtent,
      hasVisualOverflow: true,
    );
    setChildParentData(child!, constraints, geometry!);
  }

  // The pin itself: the child's paint offset stops at the collapse point
  // instead of drifting off with the scroll (the base class slides it up by
  // the raw offset), so the tail holds at the leading edge while the body
  // after this sliver keeps moving — the mechanism a pinned SliverAppBar
  // uses, minus the shrink: the header's height never changes.
  @override
  void setChildParentData(
    RenderObject child,
    SliverConstraints constraints,
    SliverGeometry geometry,
  ) {
    if (constraints.growthDirection != GrowthDirection.forward ||
        constraints.axisDirection != AxisDirection.down) {
      super.setChildParentData(child, constraints, geometry);
      return;
    }
    (child.parentData! as SliverPhysicalParentData).paintOffset = Offset(
      0.0,
      -math.min(constraints.scrollOffset, _pinAt),
    );
  }

  @override
  double childMainAxisPosition(RenderBox child) =>
      -math.min(constraints.scrollOffset, _pinAt);
}
