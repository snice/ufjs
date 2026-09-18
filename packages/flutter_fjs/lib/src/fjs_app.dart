// Host entry point: a Navigator whose page stack mirrors the JS router's.
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'engine.dart';
import 'fjs_view.dart';
import 'transitions.dart';
import 'widgets/perf_overlay.dart';

/// A [Navigator] driven by the JS router: one native route per JS route.
///
/// This is what makes `router.push('/detail')` an ordinary Flutter page
/// push — the platform's transition and its back gesture (iOS swipe,
/// Android system back) come with it, and popping tells JS to unmount the
/// page. The Navigator `pages` list is rebuilt only when [FjsEngine.navStack]
/// changes, not on every mirror-tree frame: a canvas or rAF notify that
/// reconstructed it would cancel iOS's interactive pop (spec 024). Place it
/// where you would place a [FjsView]:
///
/// ```dart
/// MaterialApp(home: FjsApp(engine: engine))
/// ```
class FjsApp extends StatefulWidget {
  const FjsApp({
    super.key,
    required this.engine,
    this.placeholder,
    this.observers = const [],
  });

  final FjsEngine engine;

  /// Shown by a page whose JS side has not mounted yet — for a pushed route
  /// that is the moment between the transition starting and its chunk
  /// arriving.
  final Widget? placeholder;

  final List<NavigatorObserver> observers;

  @override
  State<FjsApp> createState() => _FjsAppState();
}

class _FjsAppState extends State<FjsApp> {
  static const _keyPrefix = 'fjs-nav-';

  final GlobalKey<NavigatorState> _navigator = GlobalKey<NavigatorState>();

  /// Snapshot of [FjsEngine.navStack]. The engine's getter is a fresh
  /// unmodifiable view every time, so identity is meaningless; we copy
  /// when the keys actually change.
  List<NavEntry> _stack = const [];

  /// Handed to [Navigator.pages]. Flutter diffs this list by *reference*
  /// (`oldWidget.pages != widget.pages` → `_updatePages`). A new list on
  /// every JS UI frame is what broke the iOS back gesture (spec 024).
  List<Page<void>> _pages = const [];
  bool _pagesDirty = true;

  @override
  void initState() {
    super.initState();
    widget.engine.addListener(_onEngine);
    _stack = List<NavEntry>.of(widget.engine.navStack);
    // Draw under the status bar and the navigation bar (gesture handle).
    // Without it Android < 15 paints the status bar with its translucent
    // scrim and the navigation bar black, so a page's `<safe-area>` strips
    // never reach the screen edges the way they do on iOS and the web.
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  }

  @override
  void didUpdateWidget(FjsApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.engine != widget.engine) {
      oldWidget.engine.removeListener(_onEngine);
      widget.engine.addListener(_onEngine);
      _stack = List<NavEntry>.of(widget.engine.navStack);
      _pagesDirty = true;
    } else if (oldWidget.placeholder != widget.placeholder) {
      _pagesDirty = true;
    }
  }

  @override
  void dispose() {
    widget.engine.removeListener(_onEngine);
    super.dispose();
  }

  void _onEngine() {
    if (!mounted) return;
    final next = widget.engine.navStack;
    if (_stackEquals(_stack, next)) return;
    setState(() {
      _stack = List<NavEntry>.of(next);
      _pagesDirty = true;
    });
  }

  static bool _stackEquals(List<NavEntry> a, List<NavEntry> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].key != b[i].key ||
          a[i].path != b[i].path ||
          a[i].transition != b[i].transition) {
        return false;
      }
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    // Rebuilding this State on a canvas / rAF notify is the bug: even with
    // the same pages list, Navigator.didUpdateWidget always calls
    // changedExternalState → _forceRebuildPage, which tears down iOS's
    // _CupertinoBackGestureDetector mid-swipe. FjsView has its own
    // ListenableBuilder for the mirror tree; we only setState when the
    // stack signature changes (see _onEngine).
    if (_pagesDirty) {
      _pages = [
        _page(context, 0, null),
        for (final entry in _stack)
          _page(context, entry.key, entry.path, transition: entry.transition),
      ];
      _pagesDirty = false;
    }
    // above the Navigator, so the panel survives route pushes and there
    // is exactly one of it however many FjsViews are mounted
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: _systemBarsStyle(MediaQuery.platformBrightnessOf(context)),
      child: FjsPerfOverlay(
        engine: widget.engine,
        child: NavigatorPopHandler(
          // this Navigator is usually nested (under a host's Scaffold), and
          // a nested one does not see the system back button on its own
          enabled: _stack.isNotEmpty,
          onPopWithResult: (_) => _navigator.currentState?.pop(),
          child: Navigator(
            key: _navigator,
            observers: widget.observers,
            pages: _pages,
            onDidRemovePage: (page) {
              final key = page.key;
              if (key is! ValueKey<String>) return;
              final id = int.tryParse(key.value.substring(_keyPrefix.length));
              // the base page is the host's, not the router's
              if (id != null && id != 0) widget.engine.onRouteRemoved(id);
            },
          ),
        ),
      ),
    );
  }

  /// Transparent system bars: the page (its nav bar, tab bar, safe-area
  /// strips) is what shows through. Contrast enforcement off, or Android
  /// 10+ puts its own scrim back behind a three-button bar. Icons follow the
  /// system theme — the JS tree's colours are not visible from here.
  static SystemUiOverlayStyle _systemBarsStyle(Brightness brightness) {
    final icons = brightness == Brightness.dark
        ? Brightness.light
        : Brightness.dark;
    return SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: icons,
      statusBarBrightness: brightness,
      systemNavigationBarColor: Colors.transparent,
      systemNavigationBarDividerColor: Colors.transparent,
      systemNavigationBarIconBrightness: icons,
      systemNavigationBarContrastEnforced: false,
      systemStatusBarContrastEnforced: false,
    );
  }

  Page<void> _page(
    BuildContext context,
    int navKey,
    String? path, {
    String transition = '',
  }) {
    // routes paint no background of their own; without this the previous
    // page shows through wherever the JS tree is transparent (the safe
    // area strips, and the whole page while its chunk loads)
    final child = Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: FjsView(
        engine: widget.engine,
        navKey: navKey,
        placeholder: widget.placeholder,
      ),
    );
    final key = ValueKey('$_keyPrefix$navKey');
    // '' is the platform's own transition — a plain MaterialPage, which is
    // Cupertino on iOS and the theme's builder on Android. Every other name
    // is the same animation on both, which is the point of naming them.
    final spec = fjsTransitionSpec(transition);
    if (transition.isEmpty || (spec == null && transition != 'none')) {
      return _FjsMaterialPage(
        key: key,
        name: path,
        navKey: navKey,
        onDispose: widget.engine.onRouteTransitionComplete,
        onSettled: widget.engine.onRouteSettled,
        child: child,
      );
    }
    return FjsTransitionPage(
      key: key,
      name: path,
      navKey: navKey,
      onDispose: widget.engine.onRouteTransitionComplete,
      onSettled: widget.engine.onRouteSettled,
      builder: spec?.builder,
      duration: spec == null ? Duration.zero : spec.duration,
      cupertinoRoute: spec?.cupertinoRoute ?? false,
      child: child,
    );
  }
}

/// Fires [_onSettled] once the route's push transition is over.
///
/// `didPush()` hands back the entry animation's [TickerFuture], and
/// `whenCompleteOrCancel` is deliberate: a transition that gets cut short
/// (the user pops before it finishes, or an Android back gesture takes over)
/// must ALSO release whoever is waiting. A page holding its expensive
/// first-paint work until this signal would otherwise wait forever.
///
/// Listening to `animation.status == completed` would be equivalent for the
/// happy path but leaves the listener to unhook and misses the interrupted
/// case — see specs/027.
mixin _FjsSettleNotifier<T> on TransitionRoute<T> {
  int get settleKey;
  void Function(int key) get onSettled;

  @override
  TickerFuture didPush() {
    final result = super.didPush();
    result.whenCompleteOrCancel(() => onSettled(settleKey));
    return result;
  }
}

class _FjsMaterialPage extends MaterialPage<void> {
  const _FjsMaterialPage({
    required this.navKey,
    required this.onDispose,
    required this.onSettled,
    required super.child,
    super.key,
    super.name,
  });

  final int navKey;
  final void Function(int key) onDispose;
  final void Function(int key) onSettled;

  @override
  Route<void> createRoute(BuildContext context) {
    return _FjsMaterialPageRoute(page: this);
  }
}

class _FjsMaterialPageRoute extends MaterialPageRoute<void>
    with _FjsSettleNotifier<void> {
  _FjsMaterialPageRoute({required _FjsMaterialPage page})
    : _page = page,
      super(settings: page, builder: ((context) => page.child));

  final _FjsMaterialPage _page;

  @override
  int get settleKey => _page.navKey;

  @override
  void Function(int key) get onSettled => _page.onSettled;

  @override
  void dispose() {
    _page.onDispose(_page.navKey);
    super.dispose();
  }
}

/// A route whose transition the JS side named. A null [builder] is the
/// no-animation case (`meta.transition: false`); the route is a real
/// Navigator route either way, so the back gesture and [Navigator.pop]
/// keep working.
class FjsTransitionPage extends Page<void> {
  const FjsTransitionPage({
    required this.child,
    required this.builder,
    required this.duration,
    required this.navKey,
    required this.onDispose,
    required this.onSettled,
    this.cupertinoRoute = false,
    super.key,
    super.name,
  });

  final Widget child;
  final PageTransitionsBuilder? builder;
  final Duration duration;
  final int navKey;
  final void Function(int key) onDispose;
  final void Function(int key) onSettled;
  final bool cupertinoRoute;

  @override
  Route<void> createRoute(BuildContext context) {
    return cupertinoRoute
        ? _FjsCupertinoPageRoute(page: this)
        : _FjsPageRoute(page: this);
  }
}

class _FjsPageRoute extends PageRoute<void>
    with MaterialRouteTransitionMixin<void>, _FjsSettleNotifier<void> {
  _FjsPageRoute({required this.page}) : super(settings: page);

  final FjsTransitionPage page;

  @override
  int get settleKey => page.navKey;

  @override
  void Function(int key) get onSettled => page.onSettled;

  @override
  Duration get transitionDuration => page.duration;

  @override
  Duration get reverseTransitionDuration => page.duration;

  @override
  Color? get barrierColor => null;

  @override
  String? get barrierLabel => null;

  @override
  bool get maintainState => true;

  @override
  Widget buildContent(BuildContext context) => page.child;

  @override
  Widget buildTransitions(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final builder = page.builder;
    if (builder == null) return child;
    return builder.buildTransitions<void>(
      this,
      context,
      animation,
      secondaryAnimation,
      child,
    );
  }

  @override
  void dispose() {
    page.onDispose(page.navKey);
    super.dispose();
  }
}

class _FjsCupertinoPageRoute extends PageRoute<void>
    with CupertinoRouteTransitionMixin<void>, _FjsSettleNotifier<void> {
  _FjsCupertinoPageRoute({required this.page}) : super(settings: page);

  final FjsTransitionPage page;

  @override
  int get settleKey => page.navKey;

  @override
  void Function(int key) get onSettled => page.onSettled;

  // CupertinoRouteTransitionMixin does not set this — only CupertinoPageRoute
  // and CupertinoPage's route do. Without it, the Material page underneath
  // fails canTransitionTo (next is not a Material mixin and has no
  // delegatedTransition), so fjs-slide only moves the top page (spec 025).
  @override
  DelegatedTransitionBuilder? get delegatedTransition =>
      CupertinoPageTransition.delegatedTransition;

  @override
  Duration get transitionDuration => page.duration;

  @override
  Duration get reverseTransitionDuration => page.duration;

  @override
  bool get maintainState => true;

  @override
  String? get title => page.name;

  @override
  Widget buildContent(BuildContext context) => page.child;

  @override
  void dispose() {
    page.onDispose(page.navKey);
    super.dispose();
  }
}
