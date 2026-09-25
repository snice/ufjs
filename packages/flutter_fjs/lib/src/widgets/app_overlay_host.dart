// specs/136: renders the app-level overlay host (`fjs-app-overlay-host`)
// ABOVE the Navigator.
//
// The page-level overlay host (overlay_host_adapter.dart) lifts its subtree
// with an OverlayPortal anchored to its own route — a pushed page covers it,
// and it dies with the page. Elements opted in with `overlay="app"` must
// outlive that: their host root is a dedicated parentless root in the mirror
// tree, and THIS widget — mounted by FjsApp beside FjsToastHost, above the
// Navigator — paints it. A pushed page does not cover it; the page pop that
// unmounts the element removes it (ownership never leaves the page).
//
// The widget shape is the same with or without app-level floats: `child`
// always sits at Stack slot 0. Returning bare `child` when empty looked
// cheaper, but the first `overlay="app"` element then re-parented the whole
// Navigator subtree, and NavigatorPopHandler (unkeyed) was rebuilt with its
// `_canPop` reset to true — the nested Navigator only re-reports on its next
// history change, so until then the Android back button bypassed the page
// stack and left the app.
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../engine.dart';
import '../render/renderer.dart' show FjsNodeRenderer;

class FjsAppOverlayHost extends StatelessWidget {
  const FjsAppOverlayHost({
    super.key,
    required this.engine,
    required this.child,
  });

  final FjsEngine engine;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: engine,
      builder: (context, _) {
        final tree = engine.tree;
        final ids = [
          for (final id in tree.rootChildren)
            if (tree.node(id)?.props['__appOverlay'] == true) id,
        ];
        // The layer goes ABOVE the Navigator (later Stack sibling), so a
        // pushed page slides in underneath it. Hit testing: the layer's
        // boxes take touches where they paint, everything else falls
        // through to the Navigator (the adapter's blank-tap blur).
        return Stack(
          fit: StackFit.passthrough,
          children: [
            child,
            for (final id in ids)
              Positioned.fill(
                child: FjsNodeRenderer(
                  tree: tree,
                  ids: [id],
                  dispatch: engine.dispatchEvent,
                  registry: engine.components,
                ),
              ),
          ],
        );
      },
    );
  }
}

/// Whether any app-level element is up. The app root outlives its last
/// element (it is created once per VM), and a closed teleported popup
/// (vant's Popover, `teleport="body"`) stays in it hidden by v-show — so
/// the test is "a child that is not display: none".
bool fjsAppOverlayHoldsBack(FjsEngine engine) {
  final tree = engine.tree;
  for (final id in tree.rootChildren) {
    final root = tree.node(id);
    if (root == null || root.props['__appOverlay'] != true) continue;
    for (final kid in root.children) {
      final node = tree.node(kid);
      if (node != null && !FjsNodeRenderer.isHidden(node)) return true;
    }
  }
  return false;
}

/// Holds the back press while an app-level float is up (specs/136).
///
/// An app-level element sits above every page, so a back press that popped
/// the page under it would leave the float over a page it no longer belongs
/// to — or take it down with a page the user never looked at. FjsApp mounts
/// one of these on every route (Android back via maybePop, the iOS swipe)
/// and one around its NavigatorPopHandler (the base page, where back would
/// otherwise leave the app). Only system back is held: a JS-driven
/// `router.back()` still pops. Stricter than the page host, which holds only
/// for mask-shaped children — registered in docs/overlay-host.md.
class FjsAppOverlayBackGuard extends StatelessWidget {
  const FjsAppOverlayBackGuard({
    super.key,
    required this.engine,
    required this.child,
    this.logHeld = false,
  });

  final FjsEngine engine;
  final Widget child;

  /// One back press reaches both guards (host route, then the top route):
  /// only the one that always sees it says so.
  final bool logHeld;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: engine,
      child: child,
      builder: (context, child) => PopScope(
        canPop: !fjsAppOverlayHoldsBack(engine),
        onPopInvokedWithResult: (didPop, _) {
          // constitution V: a back press that does nothing looks like a bug
          if (!didPop &&
              logHeld &&
              kDebugMode &&
              fjsAppOverlayHoldsBack(engine)) {
            debugPrint(
              'fjs: back held — an overlay="app" element is up '
              '(docs/overlay-host.md)',
            );
          }
        },
        child: child!,
      ),
    );
  }
}
