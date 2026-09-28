import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/scheduler.dart';

/// "Is the app idle enough to evaluate a page chunk now?" — the gate the
/// idle-time chunk preload waits on (fjs.nav.preload, specs/143).
///
/// A chunk evaluates on the UI isolate for 12–16 ms on a phone. Doing that
/// under a finger (a drag would stutter), during a route transition (the
/// jank specs/086 and 118 fought) or while a fling is still coasting costs a
/// visible frame. JS cannot see any of those — it gets touch events, not
/// frames — which is why this lives on the Flutter side.
///
/// Idle = no pointer down, no route transition registered, and no frame
/// pending after the current one. "No frame pending" is the general signal:
/// flings, Tickers and the Navigator's own animations all keep scheduling
/// frames. Transitions are ALSO registered explicitly because a push can
/// leave a gap of a frame or two before its first animation tick.
///
/// A page with a perpetual animation (swiper autoplay, a spinner) never
/// stops scheduling frames. After [busyFallback] of that — with no finger
/// down and no transition — the gate opens anyway: one long frame in a
/// looping animation is the lesser cost than never preloading at all.
class FjsIdleGate {
  FjsIdleGate({
    bool Function()? framePending,
    this.busyFallback = const Duration(seconds: 2),
    this.poll = const Duration(milliseconds: 50),
    this.transitionTimeout = const Duration(seconds: 1),
  }) : _framePending = framePending ?? _schedulerFramePending;

  final bool Function() _framePending;
  final Duration busyFallback;
  final Duration poll;

  /// A registered transition stops blocking after this long even if its
  /// end was never reported. The settle callback rides on didPush, and a
  /// route the Navigator adds another way (didAdd, didReplace) never sends
  /// one — without this cap the gate would stay shut for the app's life.
  /// Same figure as the JS router's SETTLE_FALLBACK_MS.
  final Duration transitionTimeout;

  final Set<int> _pointers = {};
  final Map<int, Stopwatch> _animatingRoutes = {};
  bool _disposed = false;
  PointerRoute? _route;

  static bool _schedulerFramePending() {
    final scheduler = SchedulerBinding.instance;
    return scheduler.hasScheduledFrame ||
        scheduler.schedulerPhase != SchedulerPhase.idle;
  }

  /// Starts watching every pointer in the app. A no-op without a gesture
  /// binding (headless engine use), where only the other signals count.
  void attach() {
    if (_route != null) return;
    final GestureBinding gestures;
    try {
      gestures = GestureBinding.instance;
    } on FlutterError {
      return;
    }
    final route = handlePointer;
    gestures.pointerRouter.addGlobalRoute(route);
    _route = route;
  }

  /// Tracks which pointers are down. Public so tests can feed events.
  void handlePointer(PointerEvent event) {
    if (event is PointerDownEvent) {
      _pointers.add(event.pointer);
    } else if (event is PointerUpEvent || event is PointerCancelEvent) {
      _pointers.remove(event.pointer);
    }
  }

  /// Marks route [key]'s push or pop transition as running / over.
  void routeAnimating(int key, bool animating) {
    if (animating) {
      _animatingRoutes[key] = Stopwatch()..start();
    } else {
      _animatingRoutes.remove(key);
    }
  }

  bool get _blocked {
    if (_pointers.isNotEmpty) return true;
    _animatingRoutes.removeWhere((_, t) => t.elapsed >= transitionTimeout);
    return _animatingRoutes.isNotEmpty;
  }

  /// Completes once the app is idle (see the class doc); at once when
  /// disposed, so a pending preload never hangs past the engine.
  Future<void> whenIdle() async {
    Stopwatch? busy;
    while (!_disposed) {
      if (_blocked) {
        // a finger or a transition restarts the patience for animations
        busy = null;
      } else {
        if (!_framePending()) return;
        busy ??= Stopwatch()..start();
        if (busy.elapsed >= busyFallback) return;
      }
      await Future<void>.delayed(poll);
    }
  }

  void dispose() {
    _disposed = true;
    final route = _route;
    if (route != null) {
      try {
        GestureBinding.instance.pointerRouter.removeGlobalRoute(route);
      } on FlutterError {
        // binding already gone: nothing left to unhook
      }
    }
    _route = null;
    _pointers.clear();
    _animatingRoutes.clear();
  }
}
