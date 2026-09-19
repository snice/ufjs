// Hit testing for the parts of an absolutely positioned box that hang
// outside its ancestors — CSS `overflow: visible` for input, not just paint.
//
// Flutter hit-tests a child only where the point lies inside the parent's
// own size, at every level. The web does not: a positioned box that
// overflows its containing block still takes the pointer there. vant's
// Slider knob is the case that made this matter — a 24px circle
// `position: absolute` on a 2px bar, so only the bar's 2px band reached the
// knob and a drag starting anywhere else on the circle went to the
// scroll-view instead.
//
// The fix follows the usual Flutter pattern for this (a deferred hit
// target): each interactive out-of-flow box registers with the nearest
// [FjsOverflowHitScope] — the page root. When a pointer lands where the
// normal walk cannot reach a registered box (an ancestor's bounds cut it
// off), the scope hit-tests that box directly, with its full paint
// transform. Where the normal walk CAN reach the box, nothing changes, so
// z-order and everything the page drew over the box behave as before.
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// The page-level registry. Wraps a page root (and the overlay host's
/// content); boxes outside any scope keep Flutter's default hit testing.
class FjsOverflowHitScope extends SingleChildRenderObjectWidget {
  const FjsOverflowHitScope({super.key, super.child});

  @override
  RenderObject createRenderObject(BuildContext context) =>
      RenderFjsOverflowHitScope();
}

class RenderFjsOverflowHitScope extends RenderProxyBox {
  final List<_RenderOverflowHitTarget> _targets = [];

  void _register(_RenderOverflowHitTarget target) => _targets.add(target);
  void _unregister(_RenderOverflowHitTarget target) => _targets.remove(target);

  /// Transparent itself: no bounds check of its own (a translated page
  /// root is hit where it is painted, as it was before the scope wrapped
  /// it), and no entry unless something below was hit.
  @override
  bool hitTest(BoxHitTestResult result, {required Offset position}) {
    var hit = hitTestChildren(result, position: position);
    if (hit) result.add(BoxHitTestEntry(this, position));
    // later registrations were attached later, which is paint order for
    // siblings: walk them topmost-first and stop at the first box hit
    for (final target in _targets.reversed) {
      if (!target.attached || !target.hasSize) continue;
      if (_reachable(target, position)) continue;
      final hitHere = result.addWithPaintTransform(
        transform: target.getTransformTo(this),
        position: position,
        hitTest: (result, local) => target.hitTest(result, position: local),
      );
      if (hitHere) {
        hit = true;
        break;
      }
    }
    return hit;
  }

  /// Whether the normal walk gets down to [target]: every box between it
  /// and the scope contains the point. Then the target was already offered
  /// the pointer in its own place (and may have been covered by a sibling,
  /// which must stay that way).
  bool _reachable(_RenderOverflowHitTarget target, Offset position) {
    var node = target.parent;
    while (node != null && node != this) {
      if (node is RenderBox && node.hasSize) {
        final inverse = Matrix4.tryInvert(node.getTransformTo(this));
        if (inverse == null) return true;
        final local = MatrixUtils.transformPoint(inverse, position);
        if (!node.size.contains(local)) return false;
      }
      node = node.parent;
    }
    return true;
  }
}

/// Marks an interactive out-of-flow box (flex.dart [positionedChild]).
class FjsOverflowHitTarget extends SingleChildRenderObjectWidget {
  const FjsOverflowHitTarget({super.key, super.child});

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderOverflowHitTarget(
        context.findAncestorRenderObjectOfType<RenderFjsOverflowHitScope>(),
      );

  @override
  void updateRenderObject(
    BuildContext context,
    covariant _RenderOverflowHitTarget renderObject,
  ) {
    renderObject.scope = context
        .findAncestorRenderObjectOfType<RenderFjsOverflowHitScope>();
  }
}

class _RenderOverflowHitTarget extends RenderProxyBox {
  _RenderOverflowHitTarget(this._scope);

  RenderFjsOverflowHitScope? _scope;
  set scope(RenderFjsOverflowHitScope? value) {
    if (identical(value, _scope)) return;
    if (attached) _scope?._unregister(this);
    _scope = value;
    if (attached) _scope?._register(this);
  }

  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);
    _scope?._register(this);
  }

  @override
  void detach() {
    _scope?._unregister(this);
    super.detach();
  }

  /// No bounds check of its own: the box's paint position is decided
  /// below it — vant's knob is `translate(50%, -50%)` off its layout box,
  /// a FractionalTranslation that checks the shifted point itself.
  @override
  bool hitTest(BoxHitTestResult result, {required Offset position}) {
    if (hitTestChildren(result, position: position)) {
      result.add(BoxHitTestEntry(this, position));
      return true;
    }
    return false;
  }
}
