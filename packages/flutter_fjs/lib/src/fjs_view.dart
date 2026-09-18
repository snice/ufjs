// Host entry point: mounts one JS root subtree as Flutter widgets.
import 'package:flutter/material.dart';

import 'engine.dart';
import 'mirror_tree.dart';
import 'render/renderer.dart';
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
        for (final id in tree.rootChildren) {
          final node = tree.node(id);
          if (node == null || FjsView.rootNavKey(node) != widget.navKey)
            continue;
          (FjsView.rootParked(node) ? parked : ids).add(id);
        }
        _rootKeys.removeWhere(
          (id, _) => !ids.contains(id) && !parked.contains(id),
        );
        if (tree.version == 0 || ids.isEmpty) {
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
              child: FjsToastHost(engine: engine, child: content),
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
