// specs/133: the overlay host's portal child (fixed popups, a stuck
// Sticky…) is painted in the Navigator's Overlay, outside its route's
// widget subtree — the route's transition never reaches it, so it used to
// stay put while its page slid away. This anchor marks where the page is
// painted; the host follows it through a LayerLink
// (overlay_host_adapter.dart).
//
// Following the painted page, not replaying the route's transition
// builder: a builder may paint scrims or edge shadows and hit-test them —
// CupertinoPageTransition's shadow DecoratedBox, replayed on a transparent
// full-screen layer, swallowed every tap on the page. A leader/follower
// pair carries translation and scale whatever the builder, and a page that
// is not painted (covered, offstage) leaves the follower unlinked, which
// hides it.
import 'package:flutter/widgets.dart';

/// Marks a page's origin for the overlay host to follow. FjsApp wraps every
/// page in one; a host building its own routes around [FjsView] can do the
/// same.
class FjsRouteAnchor extends StatefulWidget {
  const FjsRouteAnchor({super.key, required this.child});

  final Widget child;

  /// The link of the nearest anchor, or null outside any.
  static LayerLink? maybeOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<_FjsRouteAnchorScope>()
      ?.link;

  @override
  State<FjsRouteAnchor> createState() => _FjsRouteAnchorState();
}

class _FjsRouteAnchorState extends State<FjsRouteAnchor> {
  final LayerLink _link = LayerLink();

  @override
  Widget build(BuildContext context) {
    return _FjsRouteAnchorScope(
      link: _link,
      child: CompositedTransformTarget(link: _link, child: widget.child),
    );
  }
}

class _FjsRouteAnchorScope extends InheritedWidget {
  const _FjsRouteAnchorScope({required this.link, required super.child});

  final LayerLink link;

  @override
  bool updateShouldNotify(_FjsRouteAnchorScope old) => link != old.link;
}
