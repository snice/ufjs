// specs/069 step 2: the JS side re-parents `position: fixed` elements
// (vant popups, action sheets, dialogs and their overlays) into this node;
// instead of rendering the subtree inline — where page scrolling would drag
// the popup along — this adapter lifts it into the MaterialApp's root
// Overlay via OverlayPortal, so the popup floats above every page and the
// host chrome, and stays put while the page scrolls.
//
// Older flutter_fjs hosts do not know this tag: their fallback chain
// (registry → plain view) degrades to the step-1 behaviour, no version
// negotiation needed (contract.md).
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../render/flex.dart' show positionedChild, zIndexOf;
import '../render/overflow_hit.dart';
import '../widgets/blank_tap_blur.dart';
import 'node_adapter.dart';

typedef OverlayChildBuilder = Widget Function(MirrorNode node);

class _FjsOverlayHost extends StatefulWidget {
  const _FjsOverlayHost({required this.childNodes, required this.buildNode});

  final List<MirrorNode> childNodes;
  final OverlayChildBuilder buildNode;

  @override
  State<_FjsOverlayHost> createState() => _FjsOverlayHostState();
}

class _FjsOverlayHostState extends State<_FjsOverlayHost> {
  final OverlayPortalController _controller = OverlayPortalController();

  @override
  void initState() {
    super.initState();
    // The portal content is the subtree the JS side already keeps under this
    // node; an always-shown portal with no children paints nothing, so there
    // is no need to detect "has popups" from here.
    //
    // Shown right away, not after the first frame: the host is created
    // together with the first popup, and that popup's enter flow flips
    // `enter-from` off two frames later. A post-frame show put the popup on
    // screen only after the flip — the first open of every page skipped its
    // slide-in. The controller takes show() before the portal attaches.
    _controller.show();
  }

  @override
  Widget build(BuildContext context) {
    return OverlayPortal(
      controller: _controller,
      overlayChildBuilder: (overlayContext) {
        // The overlay hands this builder the full screen, which is exactly
        // the containing block CSS `position: fixed` promises. Each child is
        // a hoisted popup/mask with absolute-style offsets. SizedBox.expand
        // makes the Stack the screen, so vant's `width/height: 100%` mask
        // and bottom sheet resolve against it (positionedChild resolves
        // percentages against the Stack's laid-out size).
        return FjsOverflowHitScope(
          child: FjsBlankTapBlur(
            opaque: false,
            child: SizedBox.expand(
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  for (final n in _paintOrder(widget.childNodes))
                    positionedChild(n, widget.buildNode(n)),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The hoisted elements share one containing block — the screen — so
/// `z-index` orders them the way it orders absolute siblings in a box
/// (render/flex.dart): ascending, tree order breaking ties. Insertion order
/// alone put a sticky header (z-index 99, hoisted on scroll) over a vant
/// Popover opened before it (z-index 2000+) (specs/129).
List<MirrorNode> _paintOrder(List<MirrorNode> nodes) {
  final indexed = [
    for (var i = 0; i < nodes.length; i++) (i, zIndexOf(nodes[i]), nodes[i]),
  ]..sort((a, b) => a.$2 != b.$2 ? a.$2.compareTo(b.$2) : a.$1.compareTo(b.$1));
  return [for (final e in indexed) e.$3];
}

/// Mounts the `fjs-overlay-host` reserved tag (specs/069, contract.md).
class OverlayHostNodeAdapter extends FjsNodeAdapter {
  const OverlayHostNodeAdapter();

  @override
  String get tag => 'fjs-overlay-host';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return _FjsOverlayHost(
      childNodes: context.childNodes,
      buildNode: (child) => context.buildNode(context.flutterContext, child),
    );
  }

  @override
  Widget decorate(FjsNodeAdapterContext context, Widget content) {
    // no box decoration of its own: the host is invisible, its children
    // carry their own backgrounds and borders
    return content;
  }
}
