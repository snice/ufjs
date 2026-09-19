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
    this.measureCross = false,
    super.children,
  });

  /// See [FjsShrinkStretchFlex.measureCross].
  final bool measureCross;

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
    )..measureCross = measureCross;
  }

  @override
  void updateRenderObject(
    BuildContext context,
    covariant RenderFjsFlex renderObject,
  ) {
    super.updateRenderObject(context, renderObject);
    renderObject.measureCross = measureCross;
  }
}
