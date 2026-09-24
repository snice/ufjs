// CSS `align-items: stretch` in a box that is itself shrink-to-fit on the
// cross axis.
//
// CSS sizes such a container to its widest item first and only then
// stretches the items to that width. Flutter's CrossAxisAlignment.stretch
// instead hands every child the incoming MAX cross extent, so a loosely
// constrained column (any box under `align-items: center` — vant's tabbar
// item label, a centred card) balloons to its parent's full width, and the
// text inside it sits at the left of that line instead of in the middle.
//
// The fix is the CSS order, done as two layout passes on the same
// RenderFlex: measure with a non-stretching alignment (children at their
// own cross size, the container at the widest; `center` because, unlike
// `start`, it needs no text direction — the stretch Flex is built without
// one), then lay out again with the cross axis tight at
// that width and the real `stretch`. Nothing is mutated between the passes
// — RenderFlex reads both `crossAxisAlignment` and `constraints` through
// their getters, which the mixin answers for the measuring pass. Only a box
// its flex parent marked shrink-to-fit ([FjsShrinkCross]) takes the two
// passes; everything else — a block in a stretching column, a page root —
// keeps the single pass untouched.
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

mixin FjsShrinkStretchFlex on RenderFlex {
  bool _measuring = false;
  BoxConstraints? _crossTight;

  /// Always take the two passes, whatever the parent says and even with an
  /// unbounded cross axis: set when a child declares `align-self` and the
  /// box was not stretching on its own (flex.dart). Such a box is laid out
  /// as a stretch so every item gets the line's cross size to align itself
  /// in, but its OWN cross size must stay what the non-stretch layout gave
  /// it — the widest item — which is exactly the measuring pass.
  bool get measureCross => _measureCross;
  bool _measureCross = false;
  set measureCross(bool value) {
    if (value == _measureCross) return;
    _measureCross = value;
    markNeedsLayout();
  }

  /// True while the second (stretching) pass runs: the children are being
  /// laid out with the cross axis tight at the measured line. See
  /// [RenderFjsCrossLineItem] for why a child needs to know.
  bool get inCrossPass => _crossTight != null;

  @override
  CrossAxisAlignment get crossAxisAlignment =>
      _measuring ? CrossAxisAlignment.center : super.crossAxisAlignment;

  @override
  BoxConstraints get constraints => _crossTight ?? super.constraints;

  @override
  void performLayout() {
    final c = super.constraints;
    final horizontal = direction == Axis.horizontal;
    final crossTight = horizontal ? c.hasTightHeight : c.hasTightWidth;
    final crossBounded = horizontal ? c.hasBoundedHeight : c.hasBoundedWidth;
    if (super.crossAxisAlignment != CrossAxisAlignment.stretch ||
        crossTight ||
        !(_measureCross || (crossBounded && _shrinkToFit()))) {
      super.performLayout();
      return;
    }
    _measuring = true;
    try {
      super.performLayout();
    } finally {
      _measuring = false;
    }
    final cross = horizontal ? size.height : size.width;
    _crossTight = horizontal
        ? c.copyWith(minHeight: cross, maxHeight: cross)
        : c.copyWith(minWidth: cross, maxWidth: cross);
    try {
      super.performLayout();
    } finally {
      _crossTight = null;
    }
  }

  /// Whether CSS makes this box shrink-to-fit: the layout that owns it
  /// said so with a [FjsShrinkCross] marker. A loose constraint alone is
  /// not enough — a block in normal flow fills its container however loose
  /// the incoming constraint is (a page root under an Align, say), so only
  /// the flex parent that knows it is not stretching this item opts in.
  ///
  /// The walk crosses the wrappers of this box's own node (decoration,
  /// LayoutBuilder, its positioning Stack when this Flex is the in-flow
  /// part) and stops at the first layout that belongs to someone else.
  bool _shrinkToFit() {
    RenderObject? from = this;
    RenderObject? p = parent;
    for (var depth = 0; p != null && depth < 16; depth++) {
      if (p is RenderFjsShrinkCross) return true;
      if (p is RenderFlex) return false;
      if (p is RenderStack) {
        final pd = from!.parentData;
        if (pd is StackParentData && pd.isPositioned) return false;
      }
      from = p;
      p = p.parent;
    }
    return false;
  }
}

/// Keeps a two-pass flex's line size live (specs/122).
///
/// The second pass hands every item a TIGHT cross constraint, and Flutter
/// makes any child laid out under a tight constraint its own relayout
/// boundary. From then on a change deep inside the item — a textarea
/// growing a line, a text wrapping onto another — stops at the item: it
/// re-lays out at the same tight size and the flex never re-measures. That
/// is how vant's autosize field stayed one cell high while its text grew
/// out of the clipped cell (specs/077 T060).
///
/// This proxy sits between the flex and each item. In the stretching pass
/// it passes the constraint on with a sub-pixel of slack on the cross max,
/// so the item is no longer tight and its subtree's dirtiness reaches the
/// proxy; the proxy itself stays at the tight size, and forwards that
/// dirtiness to the flex (the same pairing Flutter's own
/// markNeedsLayoutForSizedByParentChange does). Outside that pass it is a
/// plain pass-through.
class FjsCrossLineItem extends SingleChildRenderObjectWidget {
  const FjsCrossLineItem({super.key, super.child});

  @override
  RenderFjsCrossLineItem createRenderObject(BuildContext context) =>
      RenderFjsCrossLineItem();
}

class RenderFjsCrossLineItem extends RenderProxyBox {
  /// Whether the last layout came from the stretching pass under a tight
  /// constraint — the only case the item would otherwise cut the flex off.
  bool _forwardsDirt = false;

  /// Small enough to never show (the item sizes to its content clamped to
  /// the line, and the line is what this box reports), large enough to
  /// make the constraint not `isTight`.
  static const double _slack = 1e-3;

  @override
  void performLayout() {
    final c = constraints;
    final p = parent;
    _forwardsDirt = c.isTight && p is FjsShrinkStretchFlex && p.inCrossPass;
    final child = this.child;
    if (child == null) {
      size = c.smallest;
      return;
    }
    if (!_forwardsDirt) {
      child.layout(c, parentUsesSize: true);
      size = child.size;
      return;
    }
    final horizontal = (p as RenderFlex).direction == Axis.horizontal;
    child.layout(
      horizontal
          ? c.copyWith(maxHeight: c.maxHeight + _slack)
          : c.copyWith(maxWidth: c.maxWidth + _slack),
      parentUsesSize: true,
    );
    size = c.constrain(child.size);
  }

  @override
  void markNeedsLayout() {
    super.markNeedsLayout();
    if (_forwardsDirt && parent != null) markParentNeedsLayout();
  }
}

/// Marks its child as shrink-to-fit on its parent's cross axis — a flex
/// item the parent does not stretch. See [FjsShrinkStretchFlex].
class FjsShrinkCross extends SingleChildRenderObjectWidget {
  const FjsShrinkCross({super.key, super.child});

  @override
  RenderFjsShrinkCross createRenderObject(BuildContext context) =>
      RenderFjsShrinkCross();
}

class RenderFjsShrinkCross extends RenderProxyBox {}

/// [RenderFlex] with CSS's shrink-then-stretch cross sizing.
class RenderFjsFlex extends RenderFlex with FjsShrinkStretchFlex {
  RenderFjsFlex({
    super.direction,
    super.mainAxisAlignment,
    super.mainAxisSize,
    super.crossAxisAlignment,
    super.textDirection,
    super.verticalDirection,
    super.textBaseline,
    super.clipBehavior,
  });

  bool _cssOverflowClip = false;

  /// CSS `overflow:hidden` on the box this flex lays out: content that runs
  /// past the box (vant's swipe track is N×100% of flex-shrink:0 items)
  /// keeps its natural layout and is clipped by the box's own ClipRect
  /// (decoration.dart) — exactly like web, where the same geometry shows up
  /// as scrollWidth > clientWidth and is not an error. Flutter's debug paint
  /// would still draw its "overflowed" stripes and report an exception on
  /// every frame regardless of clipBehavior, so the indicator is skipped
  /// while this is set.
  // ignore: avoid_setters_without_getters
  set cssOverflowClip(bool value) {
    if (_cssOverflowClip == value) return;
    _cssOverflowClip = value;
    markNeedsPaint();
  }

  @override
  void paintOverflowIndicator(
    PaintingContext context,
    Offset offset,
    Rect containerRect,
    Rect childRect, {
    List<DiagnosticsNode>? overflowHints,
  }) {
    if (_cssOverflowClip) return;
    super.paintOverflowIndicator(
      context,
      offset,
      containerRect,
      childRect,
      overflowHints: overflowHints,
    );
  }
}

/// A [Flex] laid out by [RenderFjsFlex].
class FjsFlex extends Flex {
  const FjsFlex({
    super.key,
    required super.direction,
    super.mainAxisAlignment,
    super.mainAxisSize,
    super.crossAxisAlignment,
    super.textBaseline,
    super.clipBehavior,
    this.measureCross = false,
    this.cssOverflowClip = false,
    super.children,
  });

  /// See [FjsShrinkStretchFlex.measureCross].
  final bool measureCross;

  /// See [RenderFjsFlex.cssOverflowClip].
  final bool cssOverflowClip;

  @override
  RenderFlex createRenderObject(BuildContext context) {
    return RenderFjsFlex(
      direction: direction,
      mainAxisAlignment: mainAxisAlignment,
      mainAxisSize: mainAxisSize,
      crossAxisAlignment: crossAxisAlignment,
      textDirection: getEffectiveTextDirection(context),
      verticalDirection: verticalDirection,
      textBaseline: textBaseline,
      clipBehavior: clipBehavior,
    )..measureCross = measureCross
      ..cssOverflowClip = cssOverflowClip;
  }

  @override
  void updateRenderObject(
    BuildContext context,
    covariant RenderFjsFlex renderObject,
  ) {
    super.updateRenderObject(context, renderObject);
    renderObject
      ..measureCross = measureCross
      ..cssOverflowClip = cssOverflowClip;
  }
}
