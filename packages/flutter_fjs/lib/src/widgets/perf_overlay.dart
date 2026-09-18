// The dev performance monitor: a small draggable panel, toggled by `p` in
// `fjs dev`. React Native ships the same idea; the numbers differ because the
// architecture does.
//
// What it reports, and why those:
//
//   fps       frames Flutter actually produced in the last second. Low while
//             nothing moves is normal — nobody asked for a frame — so it is
//             never flagged. The two rows under it are where jank shows.
//   ui        the UI thread's half of a frame (build + layout + paint):
//             average over the last second / worst since the panel opened.
//             **JS lives here too** — the engine runs on the Flutter UI
//             isolate, so a slow restyle lands in this number rather than in
//             a separate "JS fps" the way RN splits it.
//   gpu       the raster thread's half, same two numbers. Big here and small
//             in `ui` means the fix is in what is painted, not what is built.
//   heap      the JS engine's malloc size and live object count, read WITHOUT
//             collecting (FjsEngine.heapUsage). The object count is the one
//             that predicts collection cost: QuickJS marks the whole heap.
//   nodes     mirror-tree nodes — the Dart-side count of what JS has built.
//
// Two deliberate choices:
//
// - **It samples on a timer, not every frame.** A monitor that repaints per
//   frame keeps the app permanently animating and inflates the very fps it
//   reports.
// - **The peak outlives the averaging window.** The interesting frame is
//   usually the one caused by the thing just tapped, and a one-second window
//   has forgotten it before anyone reads the panel. Hiding and re-showing is
//   the reset.
import 'dart:async';
import 'dart:ui' show FramePhase;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../engine.dart';

/// Wraps [child] and paints the monitor above it while
/// `engine.perfOverlay` is true. [FjsApp] installs one; a host that places
/// [FjsView] by hand can wrap it in this to get the same panel.
class FjsPerfOverlay extends StatefulWidget {
  const FjsPerfOverlay({super.key, required this.engine, required this.child});

  final FjsEngine engine;
  final Widget child;

  @override
  State<FjsPerfOverlay> createState() => _FjsPerfOverlayState();
}

/// Fixed so the value column lines up and so a drag can be clamped to the
/// screen without measuring the panel first.
const Size _panelSize = Size(156, 88);
const double _panelMargin = 8;

class _FjsPerfOverlayState extends State<FjsPerfOverlay> {
  /// Null until dragged: the panel starts pinned to the top-right corner,
  /// under whatever the platform reserves for a notch or status bar. Pinning
  /// with `right:` rather than a computed `left:` keeps the default correct
  /// whatever the enclosing box turns out to be; the first drag replaces it
  /// with the panel's measured position, so it never jumps.
  Offset? _position;
  final GlobalKey _panelKey = GlobalKey();

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: widget.engine.perfOverlay,
      builder: (context, on, _) {
        if (!on) return widget.child;
        final at = _position;
        return LayoutBuilder(
          builder: (context, constraints) {
            return Stack(
              fit: StackFit.passthrough,
              children: [
                widget.child,
                Positioned(
                  left: at?.dx,
                  right: at == null ? _panelMargin : null,
                  top:
                      at?.dy ??
                      MediaQuery.paddingOf(context).top + _panelMargin,
                  // Being draggable means taking pointers: a tap that lands on
                  // the panel goes to it, not to the app under it. That is the
                  // whole reason it can be dragged — it is in the way.
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onPanStart: (_) => setState(() => _position = _measured()),
                    onPanUpdate: (details) => setState(() {
                      final from = _position ?? _measured() ?? Offset.zero;
                      _position = _clamp(from + details.delta, constraints);
                    }),
                    child: KeyedSubtree(
                      key: _panelKey,
                      child: _PerfPanel(engine: widget.engine),
                    ),
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  /// Where the panel actually is, in the Stack's coordinates. Asked once, when
  /// a drag starts, so the pinned default can hand over to a free position
  /// without having to work out where `right: 8` put it.
  Offset? _measured() {
    final panel = _panelKey.currentContext?.findRenderObject();
    final stack = context.findRenderObject();
    if (panel is! RenderBox || stack is! RenderBox) return null;
    return stack.globalToLocal(panel.localToGlobal(Offset.zero));
  }

  Offset _clamp(Offset at, BoxConstraints box) {
    final maxX = (box.maxWidth - _panelSize.width).clamp(0.0, double.infinity);
    final maxY = (box.maxHeight - _panelSize.height).clamp(
      0.0,
      double.infinity,
    );
    return Offset(at.dx.clamp(0.0, maxX), at.dy.clamp(0.0, maxY));
  }
}

/// How often the panel re-reads and repaints.
const Duration _sampleEvery = Duration(milliseconds: 500);

/// Frames older than this leave the window the averages are computed over.
const Duration _window = Duration(seconds: 1);

/// A frame over this is one a user can see.
const double _budgetMs = 16.7;

class _PerfPanel extends StatefulWidget {
  const _PerfPanel({required this.engine});

  final FjsEngine engine;

  @override
  State<_PerfPanel> createState() => _PerfPanelState();
}

class _PerfPanelState extends State<_PerfPanel> {
  final List<FrameTiming> _timings = <FrameTiming>[];
  Timer? _sampler;
  ({int bytes, int objects})? _heap;
  double _uiPeak = 0;
  double _gpuPeak = 0;

  @override
  void initState() {
    super.initState();
    SchedulerBinding.instance.addTimingsCallback(_onTimings);
    _sampler = Timer.periodic(_sampleEvery, (_) => _sample());
    _sample();
  }

  @override
  void dispose() {
    SchedulerBinding.instance.removeTimingsCallback(_onTimings);
    _sampler?.cancel();
    super.dispose();
  }

  void _onTimings(List<FrameTiming> timings) {
    _timings.addAll(timings);
    for (final t in timings) {
      final ui = t.buildDuration.inMicroseconds / 1000;
      final gpu = t.rasterDuration.inMicroseconds / 1000;
      if (ui > _uiPeak) _uiPeak = ui;
      if (gpu > _gpuPeak) _gpuPeak = gpu;
    }
  }

  void _sample() {
    if (!mounted) return;
    // Reading the heap walks QuickJS's allocator bookkeeping; it does not
    // collect, so it is safe on a timer — but it is not free either, which is
    // the other reason this runs at 2 Hz and not at 60.
    final heap = widget.engine.heapUsage();
    setState(() => _heap = heap);
  }

  /// The timings inside [_window], dropping the rest as it goes.
  List<FrameTiming> _recent() {
    if (_timings.isEmpty) return const <FrameTiming>[];
    final newest = _timings.last.timestampInMicroseconds(
      FramePhase.rasterFinish,
    );
    final cutoff = newest - _window.inMicroseconds;
    _timings.removeWhere(
      (t) => t.timestampInMicroseconds(FramePhase.rasterFinish) < cutoff,
    );
    return _timings;
  }

  @override
  Widget build(BuildContext context) {
    final recent = _recent();
    final heap = _heap;

    var uiSum = 0.0, gpuSum = 0.0;
    for (final t in recent) {
      uiSum += t.buildDuration.inMicroseconds / 1000;
      gpuSum += t.rasterDuration.inMicroseconds / 1000;
    }
    final n = recent.length;
    final uiAvg = n == 0 ? 0.0 : uiSum / n;
    final gpuAvg = n == 0 ? 0.0 : gpuSum / n;

    return Container(
      width: _panelSize.width,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xCC000000),
        borderRadius: BorderRadius.circular(6),
      ),
      child: DefaultTextStyle(
        style: const TextStyle(
          fontSize: 10,
          height: 1.4,
          fontFamily: 'Menlo',
          color: Color(0xFFEAEAEA),
          decoration: TextDecoration.none,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _row('fps', '$n'),
            _row(
              'ui',
              '${uiAvg.toStringAsFixed(1)}/'
                  '${_uiPeak.toStringAsFixed(1)} ms',
              bad: _uiPeak > _budgetMs,
            ),
            _row(
              'gpu',
              '${gpuAvg.toStringAsFixed(1)}/'
                  '${_gpuPeak.toStringAsFixed(1)} ms',
              bad: _gpuPeak > _budgetMs,
            ),
            _row(
              'heap',
              heap == null
                  // an engine binary older than fjs_vm_heap; the rest of the
                  // panel still works
                  ? 'n/a'
                  : '${(heap.bytes / 1048576).toStringAsFixed(1)}MB·'
                        '${heap.objects}',
            ),
            _row('nodes', '${widget.engine.tree.nodeCount}'),
          ],
        ),
      ),
    );
  }

  /// Label hard left, value hard right — the numbers change every sample, and
  /// a column that jitters horizontally is unreadable at 10px.
  Widget _row(String label, String value, {bool bad = false}) {
    return Row(
      children: [
        Text(label, style: const TextStyle(color: Color(0xFF8E8E93))),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            maxLines: 1,
            style: bad ? const TextStyle(color: Color(0xFFFF453A)) : null,
          ),
        ),
      ],
    );
  }
}
