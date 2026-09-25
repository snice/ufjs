// Default host for JS `__fjs.toast(msg)`: a transient overlay above the page.
//
// One per app (specs/134): FjsApp mounts it above its Navigator, so a toast
// outlives the page that raised it — as on web, where it hangs off
// document.body — and a dev reload does not tear it down. FjsView mounts
// one only when nothing above it covers its engine, which keeps an app that
// embeds FjsView directly working. A host that sets engine.onToast itself
// gets it back once every FjsToastHost is gone.
import 'dart:async';

import 'package:flutter/material.dart';

import '../engine.dart';

/// Shows JS `__fjs.toast(msg)` calls as transient overlays.
class FjsToastHost extends StatefulWidget {
  const FjsToastHost({required this.engine, required this.child});

  final FjsEngine engine;
  final Widget child;

  /// Whether a host above [context] already shows [engine]'s toasts.
  static bool covers(BuildContext context, FjsEngine engine) =>
      context.getInheritedWidgetOfExactType<_FjsToastScope>()?.engine == engine;

  @override
  State<FjsToastHost> createState() => _FjsToastHostState();
}

/// The hosts alive for one engine. A predecessor chain (each host restoring
/// whatever it replaced) is only right when hosts die in stack order; a
/// replaced lower route, a parked tab or a dev reload broke that and left
/// onToast pointing at a disposed host, whose Overlay.of then threw.
class _Hosts {
  _Hosts(this.original);

  /// engine.onToast before the first host took it — the embedder's own.
  final void Function(String message)? original;
  final List<_FjsToastHostState> live = [];
}

final Expando<_Hosts> _hostsByEngine = Expando('fjs toast hosts');

class _FjsToastHostState extends State<FjsToastHost> {
  OverlayEntry? _entry;
  Timer? _hide;

  @override
  void initState() {
    super.initState();
    _attach(widget.engine);
  }

  @override
  void didUpdateWidget(covariant FjsToastHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.engine != widget.engine) {
      _detach(oldWidget.engine);
      _attach(widget.engine);
    }
  }

  // the newest host shows toasts
  void _attach(FjsEngine engine) {
    final hosts = _hostsByEngine[engine] ??= _Hosts(engine.onToast);
    hosts.live.add(this);
    engine.onToast = _show;
  }

  void _detach(FjsEngine engine) {
    final hosts = _hostsByEngine[engine];
    if (hosts == null) return;
    hosts.live.remove(this);
    if (hosts.live.isEmpty) _hostsByEngine[engine] = null;
    // someone else took onToast since: theirs now, leave it
    if (engine.onToast != _show) return;
    engine.onToast = hosts.live.isEmpty
        ? hosts.original
        : hosts.live.last._show;
  }

  void _show(String message) {
    // A new toast replaces the current one and restarts the hide timer —
    // otherwise the previous delay would dismiss the new message early.
    _hide?.cancel();
    _entry?.remove();
    _entry = OverlayEntry(
      // Match `.fjs-toast`: content-sized, centered, max 80vw — not a
      // full-width bar (`left`+`right` would stretch it across the screen).
      builder: (overlayContext) => Positioned(
        bottom: 80,
        left: 0,
        right: 0,
        child: Center(
          child: IgnorePointer(
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.sizeOf(overlayContext).width * 0.8,
              ),
              child: Material(
                color: const Color(0xCC222222),
                borderRadius: BorderRadius.circular(10),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  child: Text(
                    message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    Overlay.of(context, rootOverlay: true).insert(_entry!);
    _hide = Timer(const Duration(seconds: 2), () {
      _entry?.remove();
      _entry = null;
      _hide = null;
    });
  }

  @override
  void dispose() {
    _hide?.cancel();
    _hide = null;
    _entry?.remove();
    _entry = null;
    _detach(widget.engine);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      _FjsToastScope(engine: widget.engine, child: widget.child);
}

class _FjsToastScope extends InheritedWidget {
  const _FjsToastScope({required this.engine, required super.child});

  final FjsEngine engine;

  @override
  bool updateShouldNotify(_FjsToastScope old) => engine != old.engine;
}
