// `page-container` tag -> a route-level "fake page": mask + panel, pushed as
// a transparent route on the app's Navigator.
//
// Why a route (constitution VII deviation, specs/065): the container must
// cover the page from any mount point — the CSS engine has no
// `position: fixed`, so a JS-built view cannot escape a scroll-view — and
// the component's defining behavior is that the back gesture closes the
// CONTAINER, not the page. Both are Navigator capabilities. This is the
// same judgment call `modal` made.
//
// The route is a bare PageRoute on purpose: mixing in
// CupertinoRouteTransitionMixin makes the page below treat the container as
// a Cupertino push and slide itself aside, and its gesture detector is
// private anyway. The edge-swipe strip and drag controller here are a
// compact re-implementation of that private pair's semantics (same
// thresholds, same fling math) driving the same `route.controller` — which
// is what lets the panel follow the finger at ANY position.
//
// Event contract (specs/065): the leave chain fires on EVERY close path —
// JS flipping `show`, the overlay tap (the page closes the container in
// that handler), the edge swipe and close-on-slide-down (both surface as
// didPop). modalClosed's "JS already knows" rule does not apply here: the
// native side owns the animation clock, and the page syncs `show` itself
// in @after-leave.
//
// Panel content is a LIVE subtree (per-node listenable), the pattern
// modal.dart fixed for specs/008 — content has to keep mutating while the
// container is open.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../registry/component.dart';
import '../render/renderer.dart';
import '../render/style_parse.dart' show parseColor, parseLength;
import 'control_scope.dart' show fjsWarnOnce;
import 'dispatch.dart';

/// The container's own chrome — the same numbers as `.fjs-page-container-*`
/// in the web base stylesheet (constitution IV). The mask is fjs-modal's.
const Color fjsPageContainerMaskColor = Color(0x66000000);
const Color fjsPageContainerPanelColor = Color(0xFFFFFFFF);
const double fjsPageContainerRadius = 24;
const double fjsPageContainerDragThreshold = 80;

class FjsPageContainer extends StatefulWidget {
  const FjsPageContainer({
    required this.node,
    required this.tree,
    required this.dispatch,
    this.registry,
    super.key,
  });

  final MirrorNode node;
  final MirrorTree tree;
  final FjsDispatch dispatch;
  final ComponentRegistry? registry;

  @override
  State<FjsPageContainer> createState() => _FjsPageContainerState();
}

class _FjsPageContainerState extends State<FjsPageContainer> {
  _PageContainerRoute? _route;
  BuildContext? _routeContext;

  /// Guard against a second `Navigator.pop` racing one already animating
  /// out (back gesture vs the page's @after-leave handler both closing).
  bool _closing = false;

  /// Once-per-open guards for the callbacks a route can fire twice.
  bool _enterSettled = false;
  bool _leaveStarted = false;
  bool _leaveSettled = false;

  bool get _show => widget.node.props['show'] == true;

  @override
  void initState() {
    super.initState();
    if (_show) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _syncRoute());
    }
  }

  @override
  void didUpdateWidget(covariant FjsPageContainer oldWidget) {
    super.didUpdateWidget(oldWidget);
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncRoute());
  }

  void _syncRoute() {
    if (!mounted) return;
    if (_show && _route == null) {
      _open();
    } else if (!_show && _route != null) {
      _close();
    }
  }

  void _open() {
    final route = _PageContainerRoute(
      config: _ContainerConfig.fromNode(widget.node),
      events: _ContainerEvents(
        enterStarted: () {
          // didPush runs before the first transition tick: wx fires
          // before-enter then enter back to back, so do we.
          widget.dispatch(widget.node.id, FjsEvent.beforeEnter);
          widget.dispatch(widget.node.id, FjsEvent.enter);
        },
        enterSettled: () {
          if (_enterSettled) return;
          _enterSettled = true;
          widget.dispatch(widget.node.id, FjsEvent.afterEnter);
        },
        leaveStarted: () {
          if (_leaveStarted) return;
          _leaveStarted = true;
          widget.dispatch(widget.node.id, FjsEvent.beforeLeave);
          widget.dispatch(widget.node.id, FjsEvent.leave);
        },
        leaveSettled: () {
          if (_leaveSettled) return;
          _leaveSettled = true;
          widget.dispatch(widget.node.id, FjsEvent.afterLeave);
          if (mounted) {
            setState(() {
              _route = null;
              _routeContext = null;
              _closing = false;
              _enterSettled = false;
              _leaveStarted = false;
              _leaveSettled = false;
            });
          }
        },
        overlayTap: () =>
            widget.dispatch(widget.node.id, FjsEvent.clickOverlay),
        contextReady: (context) => _routeContext = context,
      ),
      node: widget.node,
      tree: widget.tree,
      dispatch: widget.dispatch,
      registry: widget.registry,
    );
    setState(() => _route = route);
    Navigator.of(context).push(route);
  }

  void _close() {
    final route = _route;
    final context = _routeContext;
    if (route == null || context == null || _closing) return;
    if (route.animation?.status == AnimationStatus.reverse) return;
    _closing = true;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

/// The callbacks the route fires back into the node's state, where the
/// once-per-open guards live.
class _ContainerEvents {
  _ContainerEvents({
    required this.enterStarted,
    required this.enterSettled,
    required this.leaveStarted,
    required this.leaveSettled,
    required this.overlayTap,
    required this.contextReady,
  });

  final VoidCallback enterStarted;
  final VoidCallback enterSettled;
  final VoidCallback leaveStarted;
  final VoidCallback leaveSettled;
  final VoidCallback overlayTap;
  final void Function(BuildContext context) contextReady;
}

/// Parsed node props, so the route never touches the mirror tree for its
/// chrome and a mid-flight prop change cannot mix two looks.
class _ContainerConfig {
  _ContainerConfig({
    required this.duration,
    required this.overlay,
    required this.position,
    required this.closeOnSlideDown,
    required this.maskColor,
    required this.panelColor,
    required this.radius,
    required this.panelOpacity,
  });

  final Duration duration;
  final bool overlay;

  /// One of top / bottom / right / center — already validated.
  final String position;
  final bool closeOnSlideDown;
  final Color maskColor;
  final Color panelColor;
  final BorderRadius radius;
  final double panelOpacity;

  static _ContainerConfig fromNode(MirrorNode node) {
    final props = node.props;
    final durationMs = (props['duration'] as num?)?.toDouble() ?? 300;
    final overlay = props['overlay'] != false;
    final closeOnSlideDown = props['closeOnSlideDown'] == true;

    var position = props['position'] as String? ?? 'bottom';
    if (position != 'top' &&
        position != 'bottom' &&
        position != 'right' &&
        position != 'center') {
      fjsWarnOnce(
        'page-container:position:$position',
        '<page-container> does not know position="$position"; expected top, '
            'bottom, right or center. Falling back to bottom.',
      );
      position = 'bottom';
    }

    var maskColor = fjsPageContainerMaskColor;
    _applyCss(props['overlayStyle'] as String?, (key, value) {
      switch (key) {
        case 'background':
        case 'background-color':
          final color = parseColor(value);
          if (color != null) maskColor = color;
          break;
        default:
          fjsWarnOnce(
            'page-container:overlay-style:$key',
            '<page-container> overlay-style only supports background and '
                'opacity on this platform; "$key" is ignored.',
          );
      }
    });

    var panelColor = fjsPageContainerPanelColor;
    double? radiusPx;
    var panelOpacity = 1.0;
    _applyCss(props['customStyle'] as String?, (key, value) {
      switch (key) {
        case 'background':
        case 'background-color':
          final color = parseColor(value);
          if (color != null) panelColor = color;
          break;
        case 'border-radius':
          final px = parseLength(value.trim().split(RegExp(r'\s+')).first);
          if (px != null) radiusPx = px;
          break;
        case 'opacity':
          final v = double.tryParse(value);
          if (v != null) panelOpacity = v.clamp(0.0, 1.0);
          break;
        default:
          fjsWarnOnce(
            'page-container:custom-style:$key',
            '<page-container> custom-style only supports background, '
                'border-radius and opacity on this platform; "$key" is ignored.',
          );
      }
    });
    final base =
        radiusPx ?? (props['round'] == true ? fjsPageContainerRadius : 0.0);
    final radius = switch (position) {
      'top' => BorderRadius.vertical(bottom: Radius.circular(base)),
      'right' => BorderRadius.horizontal(left: Radius.circular(base)),
      'center' => BorderRadius.circular(base),
      _ => BorderRadius.vertical(top: Radius.circular(base)),
    };

    return _ContainerConfig(
      duration: Duration(milliseconds: durationMs.round()),
      overlay: overlay,
      position: position,
      closeOnSlideDown: closeOnSlideDown,
      maskColor: maskColor,
      panelColor: panelColor,
      radius: radius,
      panelOpacity: panelOpacity,
    );
  }

  static void _applyCss(
    String? css,
    void Function(String key, String value) on,
  ) {
    if (css == null || css.isEmpty) return;
    for (final declaration in css.split(';')) {
      final i = declaration.indexOf(':');
      if (i <= 0) continue;
      on(
        declaration.substring(0, i).trim(),
        declaration.substring(i + 1).trim(),
      );
    }
  }
}

/// The transparent route that hosts mask + panel.
///
/// Deliberately a bare PageRoute, NOT CupertinoRouteTransitionMixin: pages
/// below treat that mixin as "a Cupertino push is covering me" and slide
/// themselves aside (canTransitionTo checks `nextRoute is
/// CupertinoRouteTransitionMixin`) — while wx's page-container keeps the
/// page perfectly still under the mask. The edge-swipe gesture that mixin
/// would provide is private, so the strip below re-implements it against
/// the same `route.controller`.
class _PageContainerRoute extends PageRoute<void> {
  _PageContainerRoute({
    required this.config,
    required this.events,
    required this.node,
    required this.tree,
    required this.dispatch,
    this.registry,
  });

  final _ContainerConfig config;
  final _ContainerEvents events;
  final MirrorNode node;
  final MirrorTree tree;
  final FjsDispatch dispatch;
  final ComponentRegistry? registry;

  @override
  Duration get transitionDuration => config.duration;

  @override
  Duration get reverseTransitionDuration => config.duration;

  // The page below stays visible under the mask.
  @override
  bool get opaque => false;

  @override
  bool get maintainState => true;

  @override
  Color? get barrierColor => null;

  @override
  String? get barrierLabel => null;

  // Also keeps the container itself from sliding when something is pushed
  // on top of it later.
  @override
  bool canTransitionTo(TransitionRoute<dynamic> nextRoute) => false;

  @override
  TickerFuture didPush() {
    final result = super.didPush();
    events.enterStarted();
    animation?.addStatusListener(_onAnimationStatus);
    return result;
  }

  // Any pop lands here first — the edge swipe, close-on-slide-down, and the
  // page's own `show = false` (via _close) — which is what makes the leave
  // chain fire exactly once per close.
  @override
  bool didPop(void result) {
    events.leaveStarted();
    return super.didPop(result);
  }

  void _onAnimationStatus(AnimationStatus status) {
    if (status == AnimationStatus.completed) {
      _settleEnter();
    } else if (status == AnimationStatus.dismissed) {
      events.leaveSettled();
    }
  }

  /// The navigator installs a pushed route offstage for one frame and jumps
  /// the animation clock straight to 1.0 — which reports a `completed` of
  /// its own, BEFORE the transition it then replays for real. Only the
  /// replay counts; a zero-duration container settles via the post-frame
  /// recheck, since the replayed forward() has no status left to fire.
  void _settleEnter() {
    if (!offstage) {
      events.enterSettled();
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!offstage && animation?.status == AnimationStatus.completed) {
          _settleEnter();
        }
      });
    }
  }

  @override
  void dispose() {
    animation?.removeStatusListener(_onAnimationStatus);
    super.dispose();
  }

  @override
  Widget buildPage(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
  ) {
    // Same semantics wrapper the cupertino mixin's buildPage uses.
    return Semantics(
      scopesRoute: true,
      explicitChildNodes: true,
      child: buildContent(context),
    );
  }

  Widget buildContent(BuildContext context) {
    events.contextReady(context);
    return AnimatedBuilder(
      animation: animation!,
      builder: (context, _) {
        final t = animation!.value.clamp(0.0, 1.0);
        return Stack(
          children: [
            if (config.overlay)
              Positioned.fill(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: events.overlayTap,
                  child: ColoredBox(
                    color: config.maskColor.withValues(
                      alpha: config.maskColor.a * t,
                    ),
                  ),
                ),
              ),
            _buildPanel(context, t),
          ],
        );
      },
    );
  }

  @override
  Widget buildTransitions(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    // Replaces the mixin's own transition — a horizontal slide driven by
    // CupertinoPageTransition, whose private edge detector would fight the
    // panel's own transform. The panel animates itself off `animation`
    // (buildContent); the edge swipe is the strip layered on top.
    return Stack(
      fit: StackFit.expand,
      children: [
        child,
        _EdgeBackZone(route: this),
      ],
    );
  }

  Widget _buildPanel(BuildContext context, double t) {
    final size = MediaQuery.of(context).size;
    final content = ListenableBuilder(
      listenable: tree.listenableFor(node.id),
      builder: (_, __) => FjsNodeRenderer(
        tree: tree,
        ids: node.children,
        dispatch: dispatch,
        registry: registry,
        // the panel shrink-wraps; an Expanded child here has no bound height
        grow: false,
      ),
    );

    // Down closes for bottom/center, up for top, right for right — the same
    // gesture wx's close-on-slide-down describes. Flinging in the close
    // direction closes without the distance.
    final closeSign = switch (config.position) {
      'top' => -1.0,
      _ => 1.0,
    };
    final vertical = config.position != 'right';
    Widget panel = GestureDetector(
      onVerticalDragUpdate: vertical
          ? (details) => _drag += closeSign * (details.primaryDelta ?? 0)
          : null,
      onVerticalDragEnd: vertical ? _finishPanelDrag : null,
      onHorizontalDragUpdate: vertical
          ? null
          : (details) => _drag += closeSign * (details.primaryDelta ?? 0),
      onHorizontalDragEnd: vertical ? null : _finishPanelDrag,
      child: ClipRRect(
        borderRadius: config.radius,
        child: Container(color: config.panelColor, child: content),
      ),
    );
    if (config.panelOpacity < 1) {
      panel = Opacity(opacity: config.panelOpacity, child: panel);
    }

    switch (config.position) {
      case 'top':
        return _positioned(
          alignment: Alignment.topCenter,
          translation: Offset(0, t - 1),
          constraints: BoxConstraints(maxHeight: size.height * 0.9),
          // wx semantics: top/bottom span the full width, right the full
          // height — only center shrink-wraps its content.
          width: size.width,
          child: panel,
        );
      case 'right':
        return _positioned(
          alignment: Alignment.centerRight,
          translation: Offset(1 - t, 0),
          constraints: BoxConstraints(maxWidth: size.width * 0.85),
          height: size.height,
          child: panel,
        );
      case 'center':
        return _positioned(
          alignment: Alignment.center,
          translation: null,
          constraints: BoxConstraints(
            maxWidth: size.width * 0.8,
            maxHeight: size.height * 0.8,
          ),
          child: Opacity(opacity: Curves.easeOut.transform(t), child: panel),
        );
      default:
        return _positioned(
          alignment: Alignment.bottomCenter,
          translation: Offset(0, 1 - t),
          constraints: BoxConstraints(maxHeight: size.height * 0.9),
          width: size.width,
          child: panel,
        );
    }
  }

  /// Cumulative close-direction drag on the panel, reset on every gesture.
  double _drag = 0;

  void _finishPanelDrag(DragEndDetails details) {
    final fling =
        config.closeOnSlideDown &&
        closeSign * (details.primaryVelocity ?? 0) > 600;
    final far = _drag >= fjsPageContainerDragThreshold;
    _drag = 0;
    final navigator = this.navigator;
    if ((far || fling) && navigator != null && navigator.canPop()) {
      navigator.pop();
    }
  }

  double get closeSign => config.position == 'top' ? -1.0 : 1.0;

  /// The transition clock, for [_BackDrag] — the SDK marks `controller`
  /// @protected against cross-library use, and this library owns the route.
  AnimationController? get driveController => controller;

  Widget _positioned({
    required AlignmentGeometry alignment,
    Offset? translation,
    required BoxConstraints constraints,
    required Widget child,
    double? width,
    double? height,
  }) {
    Widget content = child;
    if (width != null || height != null) {
      content = SizedBox(width: width, height: height, child: content);
    }
    if (translation != null) {
      content = FractionalTranslation(translation: translation, child: content);
    }
    return Positioned.fill(
      child: Align(
        alignment: alignment,
        child: ConstrainedBox(constraints: constraints, child: content),
      ),
    );
  }
}

/// The 20px leading-edge strip that turns an edge swipe into a pop — a
/// compact re-implementation of the SDK's private Cupertino back-gesture
/// pair (route.dart's _CupertinoBackGestureDetector/_Controller), driving
/// `route.controller` so the panel follows the finger at any position.
class _EdgeBackZone extends StatefulWidget {
  const _EdgeBackZone({required this.route});

  final _PageContainerRoute route;

  @override
  State<_EdgeBackZone> createState() => _EdgeBackZoneState();
}

class _EdgeBackZoneState extends State<_EdgeBackZone> {
  _BackDrag? _drag;

  void _start(DragStartDetails details) {
    if (!widget.route.popGestureEnabled) return;
    _drag = _BackDrag(widget.route);
  }

  // Fractions of SCREEN width — the strip itself is only 20px wide, so its
  // own size would over-drive the clock straight to dismissed (the SDK's
  // detector wraps the whole screen and can use its own size).
  void _update(DragUpdateDetails details) {
    final width = MediaQuery.of(context).size.width;
    _drag?.update(
      (Directionality.of(context) == TextDirection.rtl ? -1.0 : 1.0) *
          (details.primaryDelta ?? 0) /
          width,
    );
  }

  void _end(DragEndDetails details) {
    final width = MediaQuery.of(context).size.width;
    _drag?.end(
      (Directionality.of(context) == TextDirection.rtl ? -1.0 : 1.0) *
          details.velocity.pixelsPerSecond.dx /
          width,
    );
    _drag = null;
  }

  void _cancel() {
    _drag?.end(0);
    _drag = null;
  }

  @override
  Widget build(BuildContext context) {
    final rtl = Directionality.of(context) == TextDirection.rtl;
    return Positioned(
      left: rtl ? null : 0,
      right: rtl ? 0 : null,
      top: 0,
      bottom: 0,
      width: 20,
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onHorizontalDragStart: _start,
        onHorizontalDragUpdate: _update,
        onHorizontalDragEnd: _end,
        onHorizontalDragCancel: _cancel,
      ),
    );
  }
}

/// One edge-drag session. Same thresholds and fling math as the SDK's
/// private _CupertinoBackGestureController.
class _BackDrag {
  _BackDrag(this._route) {
    _route.navigator?.didStartUserGesture();
  }

  final _PageContainerRoute _route;

  /// Delta is the pop-direction fraction of screen width per event.
  void update(double delta) {
    final controller = _route.driveController;
    if (controller != null) {
      controller.value = (controller.value - delta).clamp(0.0, 1.0);
    }
  }

  void end(double velocity) {
    const curve = Curves.fastEaseInToSlowEaseOut;
    const dropDuration = Duration(milliseconds: 246);
    // 1.0 screen width per second — the SDK's _kMinFlingVelocity.
    const minFlingVelocity = 1.0;
    final controller = _route.driveController;
    final navigator = _route.navigator;
    if (controller == null || navigator == null) return;

    final bool animateForward;
    if (!_route.isCurrent) {
      // Navigated away mid-drag: finish the route off unless it is already
      // gone (flutter/flutter#141268).
      animateForward = _route.isActive;
    } else if (velocity.abs() >= minFlingVelocity) {
      animateForward = velocity <= 0;
    } else {
      animateForward = controller.value > 0.5;
    }

    if (animateForward) {
      controller.animateTo(1.0, duration: dropDuration, curve: curve);
    } else {
      // → route.didPop → the leave chain.
      navigator.pop();
      if (controller.isAnimating) {
        controller.animateBack(0.0, duration: dropDuration, curve: curve);
      }
    }

    if (controller.isAnimating) {
      void onDone(AnimationStatus status) {
        if (status == AnimationStatus.completed ||
            status == AnimationStatus.dismissed) {
          controller.removeStatusListener(onDone);
          navigator.didStopUserGesture();
        }
      }

      controller.addStatusListener(onDone);
    } else {
      navigator.didStopUserGesture();
    }
  }
}
