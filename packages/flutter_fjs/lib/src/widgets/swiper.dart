// `swiper` tag -> PageView, plus the properties that need a controller or a
// timer: current, autoplay, circular, vertical and the indicator dots.
//
// `circular` and the index the page sees are defined once in
// fjs-runtime/src/scroll/metrics.ts (`wrapIndex`) and mirrored in
// render/scroll_metrics.dart: whatever an unbounded PageView counts
// internally, `@change` always reports a real index, so a page never sees a
// clone's page number.
import 'dart:async';

import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/scroll_metrics.dart';
import '../render/style.dart';
import '../render/style_parse.dart';
import 'control_scope.dart' show fjsWarnOnce;
import 'dispatch.dart';
import 'scroll_behavior.dart';

/// The indicator's geometry, matching `.fjs-swiper-dot` in the web base
/// stylesheet — WeUI's defaults, which the mini program shares.
const double fjsSwiperDotSize = 8;
const double fjsSwiperDotGap = 4;
const double fjsSwiperDotInset = 16;
const Color fjsSwiperDotColor = Color(0x4D000000); // rgba(0, 0, 0, .3)
const Color fjsSwiperDotActiveColor = Color(0xFF000000);

const int _defaultInterval = 5000;
const int _defaultDuration = 500;

/// Roughly where an unbounded (circular) PageView starts — far enough from
/// either end that a user cannot swipe off it. The real origin is this
/// rounded DOWN to a multiple of the page count: the index wraps modulo that
/// count, so an origin of 100000 with 3 pages would open on page 1
/// (100000 % 3), not page 0.
const int _circularOriginHint = 100000;

class FjsSwiper extends StatefulWidget {
  const FjsSwiper({
    super.key,
    required this.node,
    required this.style,
    required this.dispatch,
    required this.pages,
  });

  final MirrorNode node;
  final FjsStyle style;
  final FjsDispatch dispatch;
  final List<Widget> pages;

  @override
  State<FjsSwiper> createState() => _FjsSwiperState();
}

class _FjsSwiperState extends State<FjsSwiper> {
  PageController? _controller;
  Timer? _timer;

  /// The real index on screen.
  int _index = 0;

  /// Last `current` the page asked for. Only a CHANGE moves the pager —
  /// otherwise a re-render would drag the user's own swipe back, the same
  /// rule scroll-top and input's value follow.
  int? _lastRequestedCurrent;

  /// True while a finger is down: autoplay waits rather than yanking the
  /// page out from under it.
  bool _held = false;

  /// Where a programmatic animation is headed.
  ///
  /// `animateToPage` walks THROUGH every page in between and PageView
  /// reports each one; a page that asked for `current = 2` expects to hear
  /// about 2, not about 1 and then 2. The pages passed over update the
  /// index silently, and only the landing is reported — which is what the
  /// web adapter does by construction.
  int? _animatingTo;

  int get _count => widget.pages.length;

  /// The unbounded pager's origin, aligned so `origin % count == 0`.
  int _circularOrigin() =>
      _count == 0 ? 0 : (_circularOriginHint ~/ _count) * _count;
  bool get _circular => fjsBool(widget.node.props['circular']) && _count > 1;
  bool get _vertical => fjsBool(widget.node.props['vertical']);
  bool get _autoplay => fjsBool(widget.node.props['autoplay']);

  int _intProp(String key, int fallback) {
    final raw = widget.node.props[key];
    if (raw is num) return raw.toInt();
    return int.tryParse('${raw ?? ''}') ?? fallback;
  }

  Duration get _duration =>
      Duration(milliseconds: _intProp('duration', _defaultDuration));

  @override
  void initState() {
    super.initState();
    _index = _clampCurrent(_intProp('current', 0));
    _lastRequestedCurrent = widget.node.props['current'] == null
        ? null
        : _index;
    _controller = PageController(
      initialPage: _circular ? _circularOrigin() + _index : _index,
    );
    _restartTimer();
  }

  @override
  void didUpdateWidget(covariant FjsSwiper oldWidget) {
    super.didUpdateWidget(oldWidget);
    final raw = widget.node.props['current'];
    if (raw != null) {
      final target = _clampCurrent(_intProp('current', _index));
      if (target != _lastRequestedCurrent) {
        _lastRequestedCurrent = target;
        _animateTo(target);
      }
    }
    _restartTimer();
  }

  /// Out-of-range `current` lands on the last page rather than doing
  /// nothing — and says so (constitution V).
  int _clampCurrent(int value) {
    if (_count == 0) return 0;
    if (value >= 0 && value < _count) return value;
    fjsWarnOnce(
      'swiper-current:${widget.node.id}',
      '<swiper> node ${widget.node.id}: current=$value is outside '
          '0..${_count - 1}; clamped.',
    );
    return value < 0 ? 0 : _count - 1;
  }

  void _animateTo(int target) {
    final controller = _controller;
    if (controller == null || !controller.hasClients || _count == 0) return;
    final page = _circular
        // step to the nearest copy of `target`, so a jump from the last page
        // to the first animates forward rather than rewinding the whole list
        ? (controller.page ?? 0).round() + _shortestStep(_index, target, _count)
        : target;
    _animatingTo = target;
    controller
        .animateToPage(page, duration: _duration, curve: Curves.easeOut)
        .whenComplete(() => _animatingTo = null);
  }

  /// How many pages to move to get from [from] to [to] the short way round.
  static int _shortestStep(int from, int to, int count) {
    final forward = (to - from) % count;
    final backward = forward - count;
    return forward <= -backward ? forward : backward;
  }

  void _restartTimer() {
    _timer?.cancel();
    _timer = null;
    if (!_autoplay || _count <= 1) return;
    final interval = Duration(
      milliseconds: _intProp('interval', _defaultInterval),
    );
    _timer = Timer.periodic(interval, (_) {
      if (!mounted || _held) return;
      final controller = _controller;
      if (controller == null || !controller.hasClients) return;
      if (_circular) {
        controller.nextPage(duration: _duration, curve: Curves.easeOut);
      } else {
        // A non-circular pager stops at the end, the way the mini program's
        // does — it does not rewind to the first page.
        if (_index >= _count - 1) return;
        controller.nextPage(duration: _duration, curve: Curves.easeOut);
      }
    });
  }

  void _onPageChanged(int page) {
    final real = _circular ? fjsWrapIndex(page, _count) : page;
    if (real == _index) return;
    final target = _animatingTo;
    if (target != null && real != target) {
      // passing through on the way somewhere: keep the index honest, say
      // nothing
      _index = real;
      setState(() {});
      return;
    }
    if (target != null) _animatingTo = null;
    _index = real;
    // The page number a page sees is always a real one, never a clone's.
    widget.dispatch(widget.node.id, FjsEvent.pageChanged, text: '$real');
    setState(() {}); // repaint the dots
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_count == 0) return const SizedBox.shrink();
    final pager = ScrollConfiguration(
      behavior: const FjsMouseDragScrollBehavior(),
      child: PageView.builder(
        controller: _controller,
        scrollDirection: _vertical ? Axis.vertical : Axis.horizontal,
        // Unbounded when circular: the index wraps instead of the list
        // ending, which is what makes the last page turn into the first.
        itemCount: _circular ? null : _count,
        onPageChanged: _onPageChanged,
        itemBuilder: (_, page) => widget.pages[fjsWrapIndex(page, _count)],
      ),
    );

    return Listener(
      // Autoplay pauses under a finger rather than swapping the page mid
      // gesture.
      onPointerDown: (_) => _held = true,
      onPointerUp: (_) => _held = false,
      onPointerCancel: (_) => _held = false,
      child: SizedBox(
        height: widget.style.height ?? 200,
        child: fjsBool(widget.node.props['indicatorDots'])
            ? Stack(children: [pager, _dots()])
            : pager,
      ),
    );
  }

  Widget _dots() {
    final color =
        parseColor(widget.node.props['indicatorColor']) ?? fjsSwiperDotColor;
    final active =
        parseColor(widget.node.props['indicatorActiveColor']) ??
        fjsSwiperDotActiveColor;
    final dots = [
      for (var i = 0; i < _count; i++)
        Container(
          width: fjsSwiperDotSize,
          height: fjsSwiperDotSize,
          margin: EdgeInsets.all(fjsSwiperDotGap / 2),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: i == _index ? active : color,
          ),
        ),
    ];
    return Positioned(
      // vertical pages put the dots down the right edge, as the mini program
      // does
      left: _vertical ? null : 0,
      right: _vertical ? fjsSwiperDotInset : 0,
      bottom: _vertical ? 0 : fjsSwiperDotInset,
      top: _vertical ? 0 : null,
      child: IgnorePointer(
        child: _vertical
            ? Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: dots,
              )
            : Row(mainAxisAlignment: MainAxisAlignment.center, children: dots),
      ),
    );
  }
}
