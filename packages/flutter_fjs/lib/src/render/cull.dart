// Paint culling for a scroll-view's content.
//
// The problem this exists for: `scroll-view` is a `SingleChildScrollView`
// holding a plain `Column`, and **a Column paints every one of its children,
// on every frame in which anything inside it changed** — whether or not they
// are on screen. Flutter only culls inside a sliver (which is what
// `ListView` / our `list-view` gives you); a RenderBox subtree has no such
// mechanism of its own. So on a 1000-row page, changing ten rows re-recorded
// a thousand rows' worth of paint commands: measured at ~50 ms per frame,
// and the same 50 ms whether ten rows changed or four hundred
// (docs/performance.md, 并发上限).
//
// The mechanism Flutter *does* offer is `RenderAbstractViewport`: every
// scroller's render object implements it, `maybeOf` finds the nearest one
// from any descendant, and `getTransformTo` maps our children into its
// coordinates — scroll offset included, because the viewport reports it in
// `applyPaintTransform`. A RenderFlex that asks where the window is can skip
// `paintChild` for the rows outside it: the same trade a sliver makes, done
// one level down.
//
// **Every** enclosing viewport is consulted, not just the nearest, and a
// child has to be inside all of them. Nesting is not exotic here — an app
// shell that wraps its pages in a scroller (examples/hello-fjs does) and a
// page that has a scroller of its own make two, and the INNER one is useless
// for culling: a scroller inside an unbounded parent is as tall as its own
// content, so its window covers everything. Only the outer, bounded one says
// anything. Asking just the nearest culled nothing at all on exactly the page
// this was written for.
//
// (The canvas's own clip is NOT usable for this. `Canvas.getLocalClipBounds`
// works only when the enclosing clip happened to be applied to the canvas;
// when the viewport composites, the clip is a `ClipRectLayer` instead and the
// recording canvas reports `Rect.largest`. The first version of this file
// used it and culled nothing.)
//
// Deliberately paint-only:
//
// - **hit testing is untouched.** Culling is about what gets recorded, not
//   about what exists; `hitTestChildren` still reaches every child, so a
//   programmatic tap or an accessibility action on an off-screen row behaves
//   as before.
// - **layout is untouched.** Every child is still laid out, so the scroll
//   extent, intrinsic sizes and `align-items` all resolve exactly as they
//   did. This is what makes it safe to turn on for an existing page —
//   nothing moves.
//
// What it does NOT fix: those children are still built. A theme switch still
// rebuilds every node in the tree. Culling removes the paint half; the build
// half needs `list-view` (or specs/002's slots). The two are complementary.
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'stretch_flex.dart';

// One thing culling across viewports HAS to do, and did not: invalidate
// itself. Every scroll viewport is a repaint boundary
// (`_RenderSingleChildViewport.isRepaintBoundary` is true), so once an inner
// scroller has painted, an outer scroll only re-offsets its retained layer —
// its paint never runs again. A flex inside it that culled against the OUTER
// window keeps a decision taken when it was off screen, and the rows the
// user just scrolled to stay unpainted: an empty box, until something
// happens to touch that scroller. Reported from the simulator, where a page
// of inner scroll-views rendered blank below the fold.
//
// So a flex that culls against a viewport on the far side of a repaint
// boundary registers itself here, and every fjs scroller calls
// [fjsScrollerMoved] as it scrolls. It is deliberately a repaint and not a
// relayout: the frame's work is the same paint loop, only with a window
// that is current.

/// Flexes whose last paint culled against a viewport they cannot be
/// repainted by. Empty on a page with a single scroller, which is most.
final Set<RenderFjsCullingFlex> _acrossBoundary = <RenderFjsCullingFlex>{};

/// The registry, for the test that pins this wiring down.
@visibleForTesting
Set<RenderFjsCullingFlex> get fjsCullingFlexesAcrossBoundary => _acrossBoundary;

/// Tells every such flex its window has moved. Called by `scroll_view.dart`
/// and `list_view.dart` on each scroll notification — including the ones an
/// outer scroller sees from its own subtree, which is exactly the case that
/// was broken.
void fjsScrollerMoved() {
  if (_acrossBoundary.isEmpty) return;
  _acrossBoundary.removeWhere((flex) => !flex.attached);
  for (final flex in _acrossBoundary) {
    flex.markNeedsPaint();
  }
}

/// Children skipped / painted since the counter was last reset. A widget test
/// asserts the off-screen ones are skipped; without a counter that is
/// invisible, because a culled frame looks exactly like an uncelled one.
@visibleForTesting
int fjsCulledChildren = 0;

/// See [fjsCulledChildren].
@visibleForTesting
int fjsPaintedChildren = 0;

/// Turns culling off, for the benchmark's control arm.
@visibleForTesting
bool fjsDisablePaintCulling = false;

/// How far outside the clip a child still counts as visible.
///
/// Two things paint outside a child's layout box: `box-shadow`, and the
/// paint-only shift of `position: relative` (and `transform`). Neither is
/// covered by `child.size`, so culling exactly at the clip edge would clip
/// them off a row that is only just outside. A fixed slab is cheap insurance
/// — at 1000 rows it means painting one extra row, not a thousand.
const double _cullSlack = 240;

/// A [Flex] whose paint skips children outside the current clip.
class FjsCullingFlex extends Flex {
  const FjsCullingFlex({
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
  void updateRenderObject(
    BuildContext context,
    covariant RenderFjsCullingFlex renderObject,
  ) {
    super.updateRenderObject(context, renderObject);
    renderObject.measureCross = measureCross;
  }

  @override
  RenderFlex createRenderObject(BuildContext context) {
    return RenderFjsCullingFlex(
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
}

/// [RenderFlex] with the paint loop of [RenderBoxContainerDefaultsMixin],
/// minus the children the clip says nobody can see.
class RenderFjsCullingFlex extends RenderFlex with FjsShrinkStretchFlex {
  RenderFjsCullingFlex({
    super.direction,
    super.mainAxisAlignment,
    super.mainAxisSize,
    super.crossAxisAlignment,
    super.textDirection,
    super.verticalDirection,
    super.textBaseline,
    super.clipBehavior,
  });

  /// [RenderFlex.paint] routes both its cases — plain, and clipped when the
  /// children overflow — through this one method, so overriding it here
  /// instead of `paint` keeps the overflow clip (and its debug stripes)
  /// exactly as they were. Overriding `paint` would quietly drop them.
  @override
  void defaultPaint(PaintingContext context, Offset offset) {
    if (fjsDisablePaintCulling) {
      super.defaultPaint(context, offset);
      return;
    }
    // (matrix into that viewport's coordinates, its visible window there),
    // outermost scroller last. Computed once for the whole child loop.
    final List<(Matrix4, Rect)> windows = _enclosingWindows();
    // Past the first, every window belongs to a viewport behind a repaint
    // boundary — this paint will not re-run when THAT one scrolls unless we
    // ask for it.
    if (windows.length > 1) {
      _acrossBoundary.add(this);
    } else {
      _acrossBoundary.remove(this);
    }
    if (windows.isEmpty) {
      // Not inside a scroller: nothing to cull against.
      super.defaultPaint(context, offset);
      return;
    }
    RenderBox? child = firstChild;
    while (child != null) {
      final FlexParentData pd = child.parentData! as FlexParentData;
      final Rect box = pd.offset & child.size;
      var visible = true;
      for (final (Matrix4 toViewport, Rect window) in windows) {
        if (!MatrixUtils.transformRect(toViewport, box).overlaps(window)) {
          visible = false;
          break;
        }
      }
      if (visible) {
        fjsPaintedChildren++;
        context.paintChild(child, pd.offset + offset);
      } else {
        fjsCulledChildren++;
      }
      child = pd.nextSibling;
    }
  }

  @override
  void detach() {
    _acrossBoundary.remove(this);
    super.detach();
  }

  /// Every scroller between this box and the root, as (transform, window).
  ///
  /// Capped: a page nested more than a few scrollers deep is a layout
  /// problem of its own, and the cap keeps this O(1) rather than O(depth)
  /// on a pathological tree.
  List<(Matrix4, Rect)> _enclosingWindows() {
    final List<(Matrix4, Rect)> out = <(Matrix4, Rect)>[];
    RenderObject? probe = this;
    while (probe != null && out.length < 4) {
      final RenderObject? found = RenderAbstractViewport.maybeOf(probe);
      if (found == null) break;
      if (found is RenderBox && found.hasSize) {
        out.add((
          getTransformTo(found),
          (Offset.zero & found.size).inflate(_cullSlack),
        ));
      }
      probe = found.parent;
    }
    return out;
  }
}
