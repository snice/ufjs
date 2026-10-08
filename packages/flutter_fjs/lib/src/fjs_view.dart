// Host entry point: mounts one JS root subtree as Flutter widgets.
import 'dart:async' show scheduleMicrotask;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart' show SemanticsBinding;

import 'engine.dart';
import 'flat/flat_gate.dart' show FjsFlatMode, fjsFlatMode;
import 'mirror_tree.dart';
import 'render/renderer.dart';
import 'widgets/blank_tap_blur.dart';
import 'widgets/toast_host.dart';

/// Renders the JS UI of [engine]. Place it under a [MaterialApp] body.
///
/// With the JS router in play each route mounts its own root element,
/// tagged with the route key the router allocated; [navKey] selects which
/// one this view draws. The default, 0, is the base page — which is also
/// what an app that never touches the router mounts. Use [FjsApp] to get a
/// native Navigator driven by the router instead of placing these by hand.
///
/// One [navKey] can own more than one root: the router parks a tab page
/// (`__navHidden`) instead of unmounting it, so switching back to that tab
/// finds it as it was left. A parked root stays in the widget tree
/// offstage — laid out, never painted, never hit-tested — which is what
/// keeps its scroll offsets and focus alive.
///
/// The base view is also the TabGroup (specs/210): a `__tabBar` root — the
/// global tab bar's own Vue app — floats at the bottom of a Stack over the
/// page area, so the bar is fixed chrome that takes no page height and a
/// pushed route covers whole.
class FjsView extends StatefulWidget {
  const FjsView({
    super.key,
    required this.engine,
    this.placeholder,
    this.navKey = 0,
  });

  final FjsEngine engine;
  final Widget? placeholder;
  final int navKey;

  /// Route key a root element belongs to; roots without the marker are the
  /// base page.
  static int rootNavKey(MirrorNode node) {
    final value = node.props['__navKey'];
    if (value is num) return value.toInt();
    return int.tryParse('$value') ?? 0;
  }

  /// A page the router parked: mounted, but not the one on screen.
  /// The app-level overlay host root (specs/136): rendered above the
  /// Navigator by FjsApp, never as page content.
  static bool rootIsAppOverlay(MirrorNode node) =>
      node.props['__appOverlay'] == true;

  /// The global tab bar's host root (specs/210): created once by the tab
  /// bar's own Vue app, docked by the BASE view below the page area — the
  /// TabGroup (tab pages above, bar below). A root without `__navKey` would
  /// otherwise fall back to navKey 0 and paint as page content.
  /// The global components root (specs/211): painted by FjsApp above the
  /// Navigator (widgets/app_overlay_host.dart), never as page content.
  static bool rootIsGlobal(MirrorNode node) => node.props['__global'] == true;

  static bool rootIsTabBar(MirrorNode node) => node.props['__tabBar'] == true;

  static bool rootParked(MirrorNode node) {
    final value = node.props['__navHidden'];
    return value == true || value == 'true';
  }

  @override
  State<FjsView> createState() => _FjsViewState();
}

class _FjsViewState extends State<FjsView> with WidgetsBindingObserver {
  /// One [GlobalKey] per root element. Parking a page changes the shape of
  /// the tree around it (a lone root becomes one layer of a [Stack]); a
  /// global key lets the subtree move into the new shape with its state —
  /// the scroll offsets this whole mechanism exists to keep — instead of
  /// being rebuilt from scratch.
  final Map<int, GlobalKey> _rootKeys = <int, GlobalKey>{};

  GlobalKey _keyFor(int id) => _rootKeys.putIfAbsent(id, GlobalKey.new);

  @override
  void initState() {
    super.initState();
    // The window size feeds the CSS engine's @media matching
    // (specs/043-media-queries). FjsView is the mount point every host
    // has, so an app that embeds one directly — no FjsApp, no router —
    // still reports; the engine dedupes, so several views under one
    // engine cost nothing.
    WidgetsBinding.instance.addObserver(this);
    // specs/193: flat display surfaces carry no semantics, so they exist only
    // while no semantics client does; a change re-asks every node
    SemanticsBinding.instance.addSemanticsEnabledListener(_semanticsChanged);
  }

  void _semanticsChanged() {
    if (fjsFlatMode != FjsFlatMode.auto) return;
    // not from inside the notification: the rebuilds are ordinary setStates
    scheduleMicrotask(() {
      if (mounted) widget.engine.tree.pingAll();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // also fires when the MediaQuery dependency changes, which covers
    // rotation on platforms that rebuild instead of calling didChangeMetrics
    _pushViewport();
  }

  @override
  void didChangeMetrics() {
    // the new size is only readable after this frame's layout
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _pushViewport();
    });
  }

  void _pushViewport() {
    final size = MediaQuery.sizeOf(context);
    widget.engine.updateViewport(size.width, size.height);
  }

  @override
  void dispose() {
    SemanticsBinding.instance.removeSemanticsEnabledListener(_semanticsChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final engine = widget.engine;
    return ListenableBuilder(
      listenable: engine,
      builder: (context, _) {
        final tree = engine.tree;
        final ids = <int>[];
        final parked = <int>[];
        final bars = <int>[];
        for (final id in tree.rootChildren) {
          final node = tree.node(id);
          if (node == null || FjsView.rootNavKey(node) != widget.navKey)
            continue;
          // the app overlay root (specs/136) is painted by FjsApp above the
          // Navigator, never inside a page — the base page would double-
          // paint it (its navKey is the fallback 0)
          if (FjsView.rootIsAppOverlay(node) || FjsView.rootIsGlobal(node)) {
            continue;
          }
          // the tab bar root (specs/210) floats at the bottom instead: the
          // TabGroup — the page area keeps its full height and the bar is a
          // Positioned layer over it. A pushed route covers the whole
          // group, so the bar needs no visibility plumbing beyond the JS
          // side collapsing it on non-tab pages.
          if (FjsView.rootIsTabBar(node)) {
            if (widget.navKey == 0) bars.add(id);
            continue;
          }
          (FjsView.rootParked(node) ? parked : ids).add(id);
        }
        _rootKeys.removeWhere(
          (id, _) => !ids.contains(id) && !parked.contains(id) && !bars.contains(id),
        );
        if (tree.version == 0 || (ids.isEmpty && bars.isEmpty)) {
          return widget.placeholder ?? const SizedBox.expand();
        }

        Widget layer(int id) => KeyedSubtree(
          key: _keyFor(id),
          child: FjsNodeRenderer(
            tree: tree,
            ids: [id],
            dispatch: engine.dispatchEvent,
            registry: engine.components,
          ),
        );

        final shown = [for (final id in ids) layer(id)];
        Widget content = shown.length == 1
            ? shown.single
            : shown.isEmpty
            ? const SizedBox.expand()
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: shown,
              );
        if (parked.isNotEmpty) {
          // passthrough so the page on screen still gets this view's own
          // constraints; a parked layer lays out but reports no size
          content = Stack(
            fit: StackFit.passthrough,
            children: [
              content,
              for (final id in parked) Offstage(child: layer(id)),
            ],
          );
        }
        // the TabGroup (specs/210): the bar FLOATS at the bottom of the
        // group — fixed over the page content, taking no layout height —
        // but as a plain Positioned layer of this same view, keyed like a
        // page root. Not the app-level overlay host: that rebuilt the bar
        // on every op batch and flickered on tab switches; here the bar
        // lives in the same rebuild pass as the page, so a tab swap reflows
        // around it without repainting it.
        if (bars.isNotEmpty) {
          content = Stack(
            fit: StackFit.passthrough,
            children: [
              Positioned.fill(child: content),
              for (final id in bars)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: layer(id),
                ),
            ],
          );
        }
        content = FjsBlankTapBlur(child: content);
        // FjsApp (or the embedder) already shows this engine's toasts from
        // above; a view embedded on its own still needs a host (specs/134)
        if (!FjsToastHost.covers(context, engine)) {
          content = FjsToastHost(engine: engine, child: content);
        }
        return FjsAssetScope(
          devUri: engine.devUri,
          generation: tree.generation,
          assetBundle: engine.assetBundle,
          child: Directionality(
            textDirection: TextDirection.ltr,
            // new tree generation → fresh Element/State under this key, so
            // inputs and switches don't inherit state from the previous load
            child: KeyedSubtree(
              key: ValueKey('fjs-tree-${tree.generation}'),
              child: content,
            ),
          ),
        );
      },
    );
  }
}

/// Where this process reads a page's local files from.
///
/// A root path like `/images/x.png` is a dev-server URL while `fjs dev` is
/// connected and a Flutter asset otherwise, and only Dart knows which
/// (specs/017-local-image-assets). It rides an InheritedWidget rather than a
/// global so a test — or a host with two engines — gets the answer for the
/// engine it is actually under; `of()` returning null is the release
/// reading, which is what a widget built outside any FjsView should see.
///
/// It sits inside [FjsView] rather than [FjsApp] because FjsView is the
/// mount point every host has: an app that embeds one directly, with no
/// router, still has local images.
class FjsAssetScope extends InheritedWidget {
  const FjsAssetScope({
    super.key,
    required this.devUri,
    this.generation = 0,
    this.assetBundle,
    required super.child,
  });

  /// The `fjs dev` origin, or null in a release build.
  final Uri? devUri;

  /// The mirror tree's generation, which bumps on every full dev reload.
  ///
  /// It rides along because a dev URL needs it: the image cache is keyed by
  /// URL, so editing a file in `public/` — whose path never changes — would
  /// keep serving the copy from the first load. An imported asset does not
  /// have this problem (its hash is in the name), and neither does a release
  /// build (nothing is editable). See fjsResolveImageSource.
  final int generation;

  /// The engine's [FjsEngine.assetBundle]: where release-build files are
  /// read from. Null means the app's own assets.
  final AssetBundle? assetBundle;

  static FjsAssetScope? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<FjsAssetScope>();

  @override
  bool updateShouldNotify(FjsAssetScope oldWidget) =>
      devUri != oldWidget.devUri ||
      generation != oldWidget.generation ||
      assetBundle != oldWidget.assetBundle;
}
