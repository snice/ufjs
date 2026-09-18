// Tag adapters: turn each [MirrorNode] of the [MirrorTree] into a Flutter
// widget. Tag set reference: docs/ui-api.md.
//
// Built-ins: view, text, image, button, input, scroll-view, list-view,
//   switch, checkbox, slider, progress, divider, safe-area, refresh,
//   swiper, modal
// Unknown tags fall back to the engine's [ComponentRegistry] (Dart-defined
// components), then to `view`.
//
// A tag whose build is more than a couple of lines lives in its own file
// under widgets/; renderer.dart owns the adapter table and the tags that are
// a single widget. Whatever a tag builds then goes through the same wrapper
// pipeline every node shares: flex.dart for the children, decoration.dart for
// the box, then gesture.dart for input.
//
// Rebuild granularity: every node is a [_FjsNodeView] that listens to that
// node's own signal, and each view instance is CACHED ON THE NODE. That
// caching is the mechanism, not an optimization on top of one:
// `Element.updateChild` skips a child when `child.widget == newWidget`, and
// `Widget.==` is `@nonVirtual` — it is identity, and Flutter forbids
// overriding it. So handing back the same instance is the only way to make a
// parent's rebuild stop at its children instead of walking the whole page,
// which is what it used to do. A node rebuilds when its own signal fires.
import 'package:flutter/gestures.dart' show kTouchSlop;
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../node/node_adapter.dart';
import '../node/node_adapters.dart';
import '../registry/component.dart';
import '../widgets/dispatch.dart';
import 'decoration.dart' show decorateNode, transitionNode;
import 'gesture.dart';
import 'touch.dart' show needsTouchNode;
import 'style.dart';

class FjsNodeRenderer extends StatelessWidget {
  const FjsNodeRenderer({
    required this.tree,
    required this.ids,
    required this.dispatch,
    this.registry,
    this.grow = true,
  });

  final MirrorTree tree;
  final List<int> ids;
  final FjsDispatch dispatch;
  final ComponentRegistry? registry;

  /// Whether these nodes are a PAGE root, whose children stretch to fill the
  /// screen. A subtree mounted somewhere with unbounded height — the bottom
  /// sheet `modal` opens — must say false: an Expanded child inside a
  /// scrollable is the "non-zero flex but unbounded constraints" crash.
  final bool grow;

  @override
  Widget build(BuildContext context) {
    final children = [
      for (final id in ids)
        if (tree.node(id) != null)
          _nodeView(
            tree,
            id,
            isRoot: grow,
            dispatch: dispatch,
            registry: registry,
          ),
    ];
    if (children.length == 1) return children.single;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }

  /// Nodes that take no space at all: `display: none`, and empty text nodes
  /// (Vue's fragment / v-if anchors arrive as text nodes with no content —
  /// a `Text('')` would still claim a line's height).
  /// Node builds since the counter was last reset; see [_FjsNodeView].
  @visibleForTesting
  static int get buildCount => _FjsNodeView.buildCount;

  @visibleForTesting
  static set buildCount(int value) => _FjsNodeView.buildCount = value;

  static bool isHidden(MirrorNode node) {
    // Read `display` straight off the maps instead of through FjsStyle: this
    // is called twice per node build plus once per child of every parent, and
    // an FjsStyle per call is an allocation for a single lookup.
    final display = node.styleMap['display'] ?? node.props['display'];
    if (display != null && display.toString() == 'none') return true;
    // A paragraph rich-text sends as one node carries its words in the
    // `richSpans` prop, with no element text and no children — it looks
    // exactly like an anchor by the other two checks (specs/035).
    return node.tag == 'text' &&
        (node.text == null || node.text!.isEmpty) &&
        node.children.isEmpty &&
        node.props['richSpans'] == null;
  }
}

/// Bypasses the view cache, so every parent rebuild produces fresh child
/// instances and cascades into their subtrees — the behaviour before per-node
/// views. Only the benchmark uses it.
@visibleForTesting
bool fjsDisableViewCache = false;

/// Returns the cached view for a node, building one if the cache is cold or
/// stale. Reusing the instance is what lets a parent rebuild skip the child.
Widget _nodeView(
  MirrorTree tree,
  int id, {
  required bool isRoot,
  required FjsDispatch dispatch,
  required ComponentRegistry? registry,
}) {
  final node = tree.node(id);
  if (node == null) return const SizedBox.shrink();
  final cached = fjsDisableViewCache ? null : node.view;
  if (cached is _FjsNodeView &&
      identical(cached.tree, tree) &&
      cached.isRoot == isRoot &&
      cached.generation == tree.generation &&
      // a method tear-off is `==` for the same receiver, not `identical`
      cached.dispatch == dispatch &&
      cached.registry == registry) {
    return cached;
  }
  final view = _FjsNodeView(
    // A node the page named with `id` gets a global key so whatever refers
    // to it can find its render object (scroll-into-view). Everything else
    // keeps the cheap value key — see mirror_tree.dart's _globalKeys.
    key: node.props['id'] != null ? tree.globalKeyFor(id) : ValueKey<int>(id),
    tree: tree,
    nodeId: id,
    isRoot: isRoot,
    dispatch: dispatch,
    registry: registry,
    generation: tree.generation,
  );
  node.view = view;
  return view;
}

/// One node, rebuilt on its own.
///
/// Holds ids, never a [MirrorNode]: a widget outlives the frame that built it,
/// and a captured node would go stale.
class _FjsNodeView extends StatelessWidget {
  const _FjsNodeView({
    super.key,
    required this.tree,
    required this.nodeId,
    required this.isRoot,
    required this.dispatch,
    required this.registry,
    required this.generation,
  });

  final MirrorTree tree;
  final int nodeId;
  final bool isRoot;
  final FjsDispatch dispatch;
  final ComponentRegistry? registry;

  /// Bumped when the tree is rebuilt from scratch (hot reload). Part of `==`
  /// so a new generation forces fresh elements rather than reusing state that
  /// belonged to the previous load.
  final int generation;

  /// Counts node builds. A widget test asserts a leaf edit costs a handful,
  /// not one per node on the page — the regression this whole file is
  /// arranged around, and one that is invisible without a counter.
  @visibleForTesting
  static int buildCount = 0;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: tree.listenableFor(nodeId),
      builder: (context, _) {
        buildCount++;
        final node = tree.node(nodeId);
        // removed between the signal firing and this rebuild
        if (node == null) return const SizedBox.shrink();
        return _buildNode(context, node, isRoot: isRoot);
      },
    );
  }

  Widget _view(int id) => _nodeView(
    tree,
    id,
    isRoot: false,
    dispatch: dispatch,
    registry: registry,
  );

  /// A node that paints while pressed — CSS `:active`, or a `button` with
  /// the default WeUI mask — gets a [_PressedNode] so the press lives in
  /// the widget tree. No round trip through JS, and no wait for a
  /// recognizer to win the arena (that delay is why a quick tap showed
  /// nothing).
  Widget _buildNode(
    BuildContext context,
    MirrorNode node, {
    bool isRoot = false,
  }) {
    final style = FjsStyle.of(node);
    // a draggable node keeps its transform wrapper even before it has a
    // transform — see transitionNode's `stableTransform`
    final stable = needsTouchNode(node, style);
    final visible = !FjsNodeRenderer.isHidden(node);
    final tracksPress = visible && _tracksPress(node);
    final tracksHover = visible && FjsStyle.nodeHasHoverStyle(node);
    Widget buildWithState(bool pressed, bool hovered) {
      // The STATE style must also drive transitionNode: transform lives in
      // that wrapper and nowhere else, so a `:active { transform: … }` rule
      // needs the pressed variant here or the scale simply never renders
      // (the pressed style only reached the decoration layer, which does
      // not apply transform). The wrapper stays in the same element
      // position across press toggles, so _TransitionNode sees a changed
      // target and interpolates — the CSS `:active` + `transition` pairing.
      final s = tracksPress || tracksHover
          ? FjsStyle.stateOf(node, pressed: pressed, hovered: hovered)
          : style;
      return transitionNode(
        s,
        _buildStyledNode(context, node, s, pressed: pressed, isRoot: isRoot),
        key: 'fjs-transition-${tree.generation}-${node.id}',
        stableTransform: stable,
      );
    }

    Widget built;
    if (tracksPress && tracksHover) {
      // hover wraps press: entering/leaving rebuilds the subtree under the
      // region, press stays a per-node Listener inside
      built = _HoverNode(
        builder: (hovered) => _PressedNode(
          builder: (pressed) => buildWithState(pressed, hovered),
        ),
      );
    } else if (tracksHover) {
      built = _HoverNode(builder: (hovered) => buildWithState(false, hovered));
    } else if (tracksPress) {
      built = _PressedNode(
        builder: (pressed) => buildWithState(pressed, false),
      );
    } else {
      built = buildWithState(false, false);
    }
    // node identity already lives in this view's key, so a reorder matches
    // by id rather than by position without a second KeyedSubtree
    return built;
  }

  static bool _tracksPress(MirrorNode node) =>
      node.tag == 'button' || FjsStyle.nodeHasPressedStyle(node);

  Widget _buildStyledNode(
    BuildContext context,
    MirrorNode node,
    FjsStyle style, {
    bool pressed = false,
    // the page root fills its route, and so do its children — the same rule
    // the web stylesheet writes as `fjs-page-entry > * { flex: 1 1 0% }`
    bool isRoot = false,
  }) {
    if (FjsNodeRenderer.isHidden(node)) return const SizedBox.shrink();
    // hidden children (display:none, and Vue's empty-text v-if / fragment
    // anchors) are dropped here rather than per-tag, so they take no slot in
    // a swiper page, a positioned layer or a list row either
    // One lookup per child: the comprehension this replaces called
    // `tree.node(id)` three times for every one of them, and a scroll-view
    // with a thousand rows pays that on every rebuild of the container.
    final kidNodes = <MirrorNode>[];
    for (final id in node.children) {
      final kid = tree.node(id);
      if (kid != null && !FjsNodeRenderer.isHidden(kid)) kidNodes.add(kid);
    }
    List<Widget>? kids;
    // one view per direct child, so collecting them costs O(children) rather
    // than O(subtree) — the children build themselves
    List<Widget> buildKids() =>
        kids ??= [for (final n in kidNodes) _view(n.id)];

    final adapter = builtInNodeAdapterByTag[node.tag];
    final adapterContext = FjsNodeAdapterContext(
      flutterContext: context,
      tree: tree,
      node: node,
      style: style,
      childNodes: kidNodes,
      buildChildren: buildKids,
      buildNode: (_, child) => _view(child.id),
      dispatch: dispatch,
      pressed: pressed,
      isRoot: isRoot,
      registry: registry,
    );

    Widget content;
    Widget decorated;
    if (adapter != null) {
      content = adapter.build(adapterContext);
      decorated = adapter.decorate(adapterContext, content);
    } else {
      // Dart-registered component (engine.registerComponent) first...
      final builder = registry?.lookup(node.tag);
      if (builder != null) {
        content = builder(context, node, buildKids(), dispatch);
      } else {
        // ...then plain container fallback
        content = viewNodeAdapter.build(adapterContext);
      }
      decorated = decorateNode(style, content);
    }
    return gestureNode(node, style, decorated, dispatch);
  }
}

/// Holds one node's `:active` state, driven by raw pointer input.
///
/// Why not a tap recognizer: `onTapDown` only fires once the recognizer wins
/// the gesture arena, which inside a list is `kPressTimeout` later or never
/// for a quick tap — the pressed style would flash after the finger is gone,
/// or not at all. And `onTapCancel` fires as soon as the enclosing scrollable
/// claims the gesture, which for a mouse (1px slop) is the tiniest jitter,
/// so a press would vanish while the button is still held.
///
/// Pointers give the browser's behaviour instead: on at pointer-down, off at
/// pointer-up, and off early only when the pointer travels far enough that
/// the gesture is really a scroll rather than a press.
class _PressedNode extends StatefulWidget {
  const _PressedNode({required this.builder});

  final Widget Function(bool pressed) builder;

  @override
  State<_PressedNode> createState() => _PressedNodeState();
}

class _PressedNodeState extends State<_PressedNode> {
  bool _pressed = false;
  Offset? _downAt;

  void _setPressed(bool value) {
    if (_pressed == value || !mounted) return;
    setState(() => _pressed = value);
  }

  void _onDown(PointerDownEvent event) {
    _downAt = event.position;
    _setPressed(true);
  }

  void _onMove(PointerMoveEvent event) {
    final from = _downAt;
    if (from == null) return;
    // same threshold the framework uses to call a drag a drag
    if ((event.position - from).distance <= kTouchSlop) return;
    _downAt = null;
    _setPressed(false);
  }

  void _onEnd([PointerEvent? _]) {
    _downAt = null;
    _setPressed(false);
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      // translucent, not opaque: an `:active` node still lets whatever sits
      // behind it in a positioned box take the same pointer, as it would in CSS
      behavior: HitTestBehavior.translucent,
      onPointerDown: _onDown,
      onPointerMove: _onMove,
      onPointerUp: _onEnd,
      onPointerCancel: _onEnd,
      child: widget.builder(_pressed),
    );
  }
}

/// Desktop-mouse `:hover` for a node that matched a hover rule (op 12).
/// Only created for such nodes — see [FjsStyle.nodeHasHoverStyle]. Touch
/// devices never fire MouseRegion callbacks, so mobile is unaffected, the
/// same way mobile browsers never match `:hover`.
class _HoverNode extends StatefulWidget {
  const _HoverNode({required this.builder});

  final Widget Function(bool hovered) builder;

  @override
  State<_HoverNode> createState() => _HoverNodeState();
}

class _HoverNodeState extends State<_HoverNode> {
  bool _hovered = false;

  void _set(bool value) {
    if (_hovered == value || !mounted) return;
    setState(() => _hovered = value);
  }

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      // MouseRegion's enter/exit cover the whole subtree: the pointer sitting
      // on a descendant keeps the ancestors hovered, which is exactly CSS's
      // definition of :hover (no per-pair tracking needed for self styling).
      onEnter: (_) => _set(true),
      onExit: (_) => _set(false),
      child: widget.builder(_hovered),
    );
  }
}
