// specs/193 — one RenderBox that lays out and paints a whole pure subtree of
// the mirror tree: no widget, element or RenderObject per node. See
// flat_layout.dart for the layout, flat_gate.dart for who gets one.
//
// Lifetime: the surface is built by `_FjsNodeViewState.build` for the flat
// root. The root's signal fires for any change under it (MirrorTree forwards
// descendants' dirty ids to it), the view rebuilds, the gate is asked again, and
// either this widget updates (the dirty ids are applied incrementally at
// layout) or the node falls back to the ordinary path.
import 'dart:developer' show Timeline;

import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import '../mirror_tree.dart';
import '../render/cull.dart' show fjsFlatCullerRegister, fjsVisibleWindowOf;
import '../render/stretch_flex.dart' show RenderFjsShrinkCross;
import '../widgets/text.dart' show FjsTextEnvData;
import 'flat_gate.dart';
import 'flat_layout.dart';

class FjsFlatSurface extends LeafRenderObjectWidget {
  const FjsFlatSurface({super.key, required this.tree, required this.root});

  final MirrorTree tree;
  final MirrorNode root;

  @override
  RenderObject createRenderObject(BuildContext context) {
    FjsFlatStats.surfaces++;
    return RenderFlatSurface(tree, root, FjsTextEnvData.maybeOf(context)!);
  }

  @override
  void updateRenderObject(BuildContext context, RenderFlatSurface ro) {
    ro.update(tree, root, FjsTextEnvData.maybeOf(context)!);
  }
}

class RenderFlatSurface extends RenderBox {
  RenderFlatSurface(this._tree, this._root, this._env);

  MirrorTree _tree;
  MirrorNode _root;
  FjsTextEnvData _env;
  final FlatEngine engine = FlatEngine();
  bool _needsPack = true;
  bool _fallingBack = false;

  void update(MirrorTree tree, MirrorNode root, FjsTextEnvData env) {
    if (!identical(tree, _tree) || !identical(root, _root)) {
      _tree = tree;
      _root = root;
      _needsPack = true;
    }
    _env = env;
    markNeedsLayout();
    markNeedsPaint();
  }

  @override
  bool get isRepaintBoundary => true;

  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);
    _tree.flatRoots.add(_root.id);
  }

  @override
  void detach() {
    fjsFlatCullerRegister(this, culling: false);
    _tree.flatRoots.remove(_root.id);
    _release();
    super.detach();
  }

  void _release() {
    for (final n in engine.byId.values) {
      n.node.flatHost = null;
    }
    engine.dispose();
    _needsPack = true;
  }

  @override
  void performLayout() {
    // Timeline spans (profile / debug only cost; no-ops in release) so
    // tool/frame-timeline.mjs can show where a surface's frame goes on a device
    final ok = Timeline.timeSync('flat.prepare', _prepare);
    if (!ok) {
      size = constraints.smallest;
      return;
    }
    final s = Timeline.timeSync(
      'flat.layout',
      () => engine.layoutRoot(constraints, rootShrinkToFit: _shrinkToFit()),
    );
    size = constraints.constrain(s);
  }

  /// Packs or refreshes the engine to match the mirror tree. False when the
  /// subtree can no longer be flat — then the node is sent back to the
  /// ordinary renderer.
  bool _prepare() {
    final dirty = _tree.takeFlatDirty(_root.id);
    if (!_needsPack) {
      if (!engine.setEnv(_env)) {
        _needsPack = true;
      } else {
        for (final id in dirty) {
          final m = _tree.node(id);
          if (m == null || !engine.refresh(_tree, m)) {
            _needsPack = true;
            break;
          }
        }
      }
    }
    if (_needsPack) {
      _release();
      final packed = Timeline.timeSync('flat.pack', () => engine.pack(_tree, _root, _env));
      if (!packed) {
        _fallback(engine.rejectedReason ?? 'pack');
        return false;
      }
      for (final n in engine.byId.values) {
        n.node.flatHost = this;
      }
      _needsPack = false;
    }
    return true;
  }

  void _fallback(String reason) {
    if (_fallingBack) return;
    _fallingBack = true;
    FjsFlatStats.reject('fallback:$reason');
    final root = _root, tree = _tree;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      // the gate memo said "pure" and the engine disagreed: believe the engine
      // until the subtree next changes, and rebuild the node as ordinary
      root.flatPure = 2;
      tree.pingNode(root.id);
    });
  }

  /// FjsShrinkStretchFlex._shrinkToFit for the root's own flex: walks the real
  /// render tree above the surface, which stands in for the whole chain of the
  /// root node's wrappers.
  bool _shrinkToFit() {
    RenderObject? from = this;
    RenderObject? p = parent;
    for (var depth = 0; p != null && depth < 16; depth++) {
      if (p is RenderFjsShrinkCross && p.active) return true;
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

  @override
  void paint(PaintingContext context, Offset offset) {
    if (engine.root == null) return;
    // Paint only what a scroller above can show (render/cull.dart). Layout is
    // untouched: every node is still laid out, so extents and sizes are what
    // the ordinary path gives.
    final window = fjsVisibleWindowOf(this);
    fjsFlatCullerRegister(this, culling: window != null);
    Timeline.timeSync(
      'flat.paint',
      () => engine.paint(context.canvas, offset, window?.shift(offset)),
    );
  }

  @override
  bool hitTestSelf(Offset position) => false;

  /// [node]'s outer rect in global coordinates, for geometry.dart; null when
  /// the surface is not laid out.
  Rect? globalRectOf(MirrorNode node) {
    if (!attached || !hasSize) return null;
    final n = engine.byId[node.id];
    if (n == null) return null;
    final local = engine.rectOf(n);
    final origin = localToGlobal(local.topLeft);
    return origin & local.size;
  }
}
