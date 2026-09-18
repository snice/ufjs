// Default host for JS `__fjs.toast(msg)`: a transient overlay above the page.
// Mounted by FjsView, so a host that sets engine.onToast itself keeps control.
import 'dart:async';

import 'package:flutter/material.dart';

import '../engine.dart';

/// Shows JS `__fjs.toast(msg)` calls as transient overlays.
class FjsToastHost extends StatefulWidget {
  const FjsToastHost({required this.engine, required this.child});

  final FjsEngine engine;
  final Widget child;

  @override
  State<FjsToastHost> createState() => _FjsToastHostState();
}

class _FjsToastHostState extends State<FjsToastHost> {
  OverlayEntry? _entry;
  Timer? _hide;
  // one host per page: the newest page shows toasts, and popping it hands
  // the job back to the page underneath instead of dropping it
  void Function(String message)? _previous;

  @override
  void initState() {
    super.initState();
    _previous = widget.engine.onToast;
    widget.engine.onToast = _show;
  }

  @override
  void didUpdateWidget(covariant FjsToastHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.engine != widget.engine) {
      _previous = widget.engine.onToast;
      widget.engine.onToast = _show;
    }
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
    if (widget.engine.onToast == _show) widget.engine.onToast = _previous;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
