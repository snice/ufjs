// specs/069 step 2: the JS side re-parents `position: fixed` elements
// (vant popups, action sheets, dialogs and their overlays) into this node;
// instead of rendering the subtree inline — where page scrolling would drag
// the popup along — this adapter lifts it via OverlayPortal into the
// nearest Overlay (FjsApp's Navigator), painted right above its own page,
// so the popup floats over the page and stays put while the page scrolls.
//
// Older flutter_fjs hosts do not know this tag: their fallback chain
// (registry → plain view) degrades to the step-1 behaviour, no version
// negotiation needed (contract.md).
//
// specs/133 (docs/overlay-host.md): the portal child lives in the
// Navigator's Overlay, outside the route's own widget subtree, so the route
// does not carry it along by itself. Two things tie it back to its page:
//
// * `modal` — a boolean prop the JS side writes on this node while a
//   full-viewport mask is among its children (renderer.ts isModalMask).
//   It becomes a PopScope on the page's route: the iOS back gesture, the
//   Android back button (FjsApp's NavigatorPopHandler → maybePop) and any
//   host BackButton are held until the popup closes. Before this the iOS
//   gesture was only blocked by accident (the mask covered the edge) and
//   Android left the page with the popup up.
// * _FollowRoute — the portal content follows where the page is painted
//   (FjsRouteAnchor), so a stuck Sticky or a fixed NavBar leaves with its
//   page instead of hanging over the previous one until dispose.
// ignore: unnecessary_import
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../widgets/route_anchor.dart';
import '../render/flex.dart' show positionedChild, zIndexOf;
import '../render/overflow_hit.dart';
import '../widgets/blank_tap_blur.dart';
import 'node_adapter.dart';

typedef OverlayChildBuilder = Widget Function(MirrorNode node);

class _FjsOverlayHost extends StatefulWidget {
  const _FjsOverlayHost({
    required this.childNodes,
    required this.buildNode,
    required this.modal,
  });

  final List<MirrorNode> childNodes;
  final OverlayChildBuilder buildNode;
  final bool modal;

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
    // read here, under the page's route: the portal child is built in the
    // Navigator's Overlay, outside the route's subtree
    final route = ModalRoute.of(context);
    final link = FjsRouteAnchor.maybeOf(context);
    return PopScope(
      canPop: !widget.modal,
      onPopInvokedWithResult: (didPop, _) {
        // constitution V: a back press that does nothing looks like a bug
        if (!didPop && kDebugMode) {
          debugPrint(
            'fjs: back held — a modal mask is open in the overlay host '
            '(docs/overlay-host.md)',
          );
        }
      },
      child: OverlayPortal(
        controller: _controller,
        overlayChildBuilder: (overlayContext) =>
            _FollowRoute(link: link, route: route, child: _content()),
      ),
    );
  }

  Widget _content() {
    // The overlay hands this builder the full screen, which is exactly the
    // containing block CSS `position: fixed` promises. Each child is a
    // hoisted popup/mask with absolute-style offsets. SizedBox.expand makes
    // the Stack the screen, so vant's `width/height: 100%` mask and bottom
    // sheet resolve against it (positionedChild resolves percentages
    // against the Stack's laid-out size).
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
  }
}

/// Ties the portal layer to its page (specs/133, widgets/route_anchor.dart).
///
/// `OverlayPortal()` targets the NEAREST Overlay — FjsApp's Navigator's —
/// and paints its child right above its own route's entry, but outside the
/// route's transition wrapper, so a stuck Sticky stayed put while its page
/// slid away. The follower takes the transform the page is actually painted
/// with (slide, zoom), and goes dark when the page is not painted.
///
/// A LayerLink carries geometry, not opacity: routes that do not merely
/// slide (fade, zoom, and the platform default off iOS) also fade the layer
/// with the route's own animation. Cupertino-style routes skip that — their
/// page does not fade, so the layer should not either (an iOS back swipe
/// would dim a stuck header as the finger moves).
class _FollowRoute extends StatelessWidget {
  const _FollowRoute({
    required this.link,
    required this.route,
    required this.child,
  });

  final LayerLink? link;
  final ModalRoute<Object?>? route;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final link = this.link;
    // no anchor (a host embedding FjsView in routes of its own): as before
    if (link == null) return child;
    Widget layer = child;
    final route = this.route;
    final animation = route?.animation;
    if (route != null && animation != null && !_slidesOnly(context, route)) {
      layer = FadeTransition(opacity: animation, child: layer);
    }
    return CompositedTransformFollower(
      link: link,
      showWhenUnlinked: false,
      child: layer,
    );
  }

  static bool _slidesOnly(BuildContext context, ModalRoute<Object?> route) {
    if (route is CupertinoRouteTransitionMixin) return true;
    if (route is MaterialRouteTransitionMixin) {
      final theme = Theme.of(context);
      return theme.pageTransitionsTheme.builders[theme.platform]
          is CupertinoPageTransitionsBuilder;
    }
    return false;
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
      modal: context.node.props['modal'] == true,
    );
  }

  @override
  Widget decorate(FjsNodeAdapterContext context, Widget content) {
    // no box decoration of its own: the host is invisible, its children
    // carry their own backgrounds and borders
    return content;
  }
}

/// Mounts the `fjs-app-overlay-host` reserved root (specs/136).
///
/// Unlike the page host this subtree is rendered by `FjsAppOverlayHost`
/// ABOVE the Navigator — no OverlayPortal (theatre entries from a page
/// subtree would be covered by a pushed page, the exact problem this
/// exists to solve), no PopScope (an app-level float does not hold the
/// route back — registered behaviour), no `FjsRouteAnchor` (it follows no
/// route). Children are the `overlay="app"` fixed elements: full-screen
/// container, z-index ordered like the page host.
class AppOverlayHostNodeAdapter extends FjsNodeAdapter {
  const AppOverlayHostNodeAdapter();

  @override
  String get tag => 'fjs-app-overlay-host';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsOverflowHitScope(
      child: FjsBlankTapBlur(
        opaque: false,
        child: SizedBox.expand(
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              for (final n in _paintOrder(context.childNodes))
                positionedChild(n, context.buildNode(context.flutterContext, n)),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget decorate(FjsNodeAdapterContext context, Widget content) {
    // no box decoration of its own: the host is invisible, its children
    // carry their own backgrounds and borders
    return content;
  }
}
