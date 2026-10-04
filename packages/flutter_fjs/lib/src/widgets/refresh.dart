// `refresh` tag, custom-header mode (specs/206): the first element child is
// header CONTENT the JS side renders (vant-style pull texts, specs/205's
// wrapper); the second is the scrollable. Native owns geometry — the header
// rides a transform above the content and both translate with the pull —
// because "scrolled to top + drag distance" only exists at the scroll layer
// (a pure-JS track is starved by the gesture arena, specs/205 §7.8①). JS
// only hears status LINES via `statusChange`, so a gesture costs a handful
// of round-trips, not one per frame.
//
// The mechanics are RefreshIndicator's (this SDK build is notification
// driven — no recognizer of its own): the child scrollable must be the one
// reporting, drags past the top arrive as ScrollUpdates with negative delta
// (bouncing physics) or OverscrollNotifications (clamping), and the finger
// lifting shows up as the first dragDetails == null update (iOS bounce-back)
// or as ScrollEnd (clamping, no bounce follows). A depth == 0 gate keeps
// notifications from deeper nested scrollers out.
//
// The numbers are vant's (pull-refresh): threshold = head height (50),
// ease halves the excess past 50 and past 100, release-past-threshold holds
// at the head height until JS sets the `refreshing` prop false, then the
// collapse runs 300ms. Vant parity of the drag FEEL is not claimed — the
// scroll physics' own overscroll friction applies before the ease.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart' show MirrorNode, fjsBool;
import 'dispatch.dart';

enum _PullStatus { idle, pulling, loosing, loading }

class FjsRefresh extends StatefulWidget {
  const FjsRefresh({
    super.key,
    required this.node,
    required this.dispatch,
    required this.header,
    required this.child,
  });

  final MirrorNode node;
  final FjsDispatch dispatch;

  /// First element child: JS-rendered header content, translated natively.
  final Widget header;

  /// Second element child: the scrollable the pull rides on.
  final Widget child;

  @override
  State<FjsRefresh> createState() => _FjsRefreshState();
}

class _FjsRefreshState extends State<FjsRefresh>
    with SingleTickerProviderStateMixin {
  static const _animationDuration = Duration(milliseconds: 300);

  double get _headHeight {
    final raw = widget.node.props['headHeight'];
    final v = raw is num ? raw.toDouble() : double.tryParse('${raw ?? ''}');
    return v ?? 50;
  }

  _PullStatus _status = _PullStatus.idle;

  /// Last value the `refreshing` prop had. Only the FLIP is the signal —
  /// a rebuild with an unchanged prop must not re-run a transition (the
  /// checkbox `_lastProp` shape, specs/122); without it, any unrelated
  /// rebuild during the hold would collapse the header, because the prop
  /// reads false all through a native-triggered refresh until JS sets it
  /// true (the wrapper does, mirroring vant's model).
  bool _lastRefreshing = false;

  /// Raw drag distance this gesture accumulated (vant compares THIS against
  /// the threshold; the eased value only drives the visual).
  double _raw = 0;

  /// True when the current drag BEGAN at the top edge. Vant only arms a
  /// pull from a touchstart at scrollTop 0; without this a drag that starts
  /// mid-list (content moving down toward the top) reads as negative
  /// scroll deltas and would be counted as a pull on the way up.
  bool _armed = false;

  /// Eased distance the header and the content currently sit at.
  double _offset = 0;

  late final AnimationController _snap = AnimationController(
    vsync: this,
    duration: _animationDuration,
  );
  late final CurvedAnimation _snapCurve = CurvedAnimation(
    parent: _snap,
    curve: Curves.ease,
  );
  Tween<double> _snapTween = Tween<double>(begin: 0, end: 0);

  @override
  void initState() {
    super.initState();
    _lastRefreshing = fjsBool(widget.node.props['refreshing']);
    if (_lastRefreshing) {
      // Mounted mid-refresh: JS set the prop, it knows the status — no
      // event (the edge events register the initial state silently too).
      _status = _PullStatus.loading;
      _offset = _headHeight;
    }
    _snap.addListener(
      () => setState(() => _offset = _snapTween.evaluate(_snapCurve)),
    );
  }

  @override
  void didUpdateWidget(covariant FjsRefresh oldWidget) {
    super.didUpdateWidget(oldWidget);
    final refreshing = fjsBool(widget.node.props['refreshing']);
    if (refreshing == _lastRefreshing) return;
    _lastRefreshing = refreshing;
    if (!refreshing) {
      // JS is done: collapse, report normal so the header text resets with
      // the motion (vant's close()).
      setState(() {
        _status = _PullStatus.idle;
        _raw = 0;
        _animateTo(0);
      });
      _emitStatus('normal');
    } else if (_status != _PullStatus.loading) {
      // JS-started refresh (no pull happened): hold at the head height.
      setState(() {
        _status = _PullStatus.loading;
        _raw = 0;
        _animateTo(_headHeight);
      });
      _emitStatus('loading');
    }
  }

  @override
  void dispose() {
    _snap.dispose();
    super.dispose();
  }

  /// Vant's ease (pull-refresh PullRefresh.js): 1:1 up to the head height,
  /// halved past it, halved again past twice the head height.
  double _ease(double distance) {
    final head = _headHeight;
    if (distance <= head) return distance;
    if (distance < head * 2) return head + (distance - head) / 2;
    return head * 1.5 + (distance - head * 2) / 4;
  }

  void _emitStatus(String status) {
    if (widget.node.props['onStatuschange'] != true) return;
    widget.dispatch(
      widget.node.id,
      FjsEvent.statusChange,
      text: '{"status":"$status"}',
    );
  }

  void _setPulling() {
    final next = _raw > _headHeight
        ? _PullStatus.loosing
        : _PullStatus.pulling;
    if (next == _status) return;
    setState(() => _status = next);
    _emitStatus(next == _PullStatus.loosing ? 'loosing' : 'pulling');
  }

  /// Finger lifted. Past the threshold: hold at the head height and fire
  /// `refresh` (vant's order — the model flip, then the loading status).
  /// Below it: flip to idle immediately and let the collapse play (vant's
  /// setStatus(0), the text resets while the track transitions back).
  void _release() {
    if (_status == _PullStatus.loosing) {
      setState(() {
        _status = _PullStatus.loading;
        _raw = 0;
        _animateTo(_headHeight);
      });
      widget.dispatch(widget.node.id, FjsEvent.refresh);
      _emitStatus('loading');
    } else if (_status == _PullStatus.pulling) {
      // vant flips to normal immediately and lets the track transition back.
      setState(() {
        _status = _PullStatus.idle;
        _raw = 0;
        _animateTo(0);
      });
      _emitStatus('normal');
    }
  }

  void _animateTo(double target) {
    _snapTween = Tween<double>(begin: _offset, end: target);
    _snap.forward(from: 0);
  }

  bool _onScrollNotification(ScrollNotification notification) {
    // Only the scrollable this refresh wraps may drive the pull — a deeper
    // nested scroller (a picker column, another list) must not (the same
    // predicate RefreshIndicator applies).
    if (notification.depth != 0) return false;
    if (_status == _PullStatus.loading) return false;

    if (notification is ScrollStartNotification) {
      _armed = false;
      if (notification.dragDetails == null) return false;
      final metrics = notification.metrics;
      final atTop = (metrics.axisDirection == AxisDirection.down &&
              metrics.extentBefore == 0) ||
          (metrics.axisDirection == AxisDirection.up &&
              metrics.extentAfter == 0);
      if (!atTop) return false;
      _armed = true;
      // A drag can begin while a collapse is still playing; freeze the
      // animation where it is and let the next update move from there.
      _snap.stop();
      setState(() {
        _raw = 0;
        _offset = 0;
      });
      return false;
    }

    final update =
        notification is ScrollUpdateNotification ? notification : null;
    final overscroll =
        notification is OverscrollNotification ? notification : null;
    if (update == null && overscroll == null) {
      if (notification is ScrollEndNotification) {
        _armed = false;
        _release();
      }
      return false;
    }
    final delta = update != null
        ? update.scrollDelta ?? 0
        : overscroll!.overscroll;

    // dragDetails == null means the movement is ballistic (iOS bounce-back)
    // or a programmatic settle — the finger is off the screen by then.
    final dragged = update != null
        ? update.dragDetails != null
        : overscroll!.dragDetails != null;
    if (!dragged) {
      _release();
      return false;
    }

    if (!_armed) return false;

    // Scrolling UP (content moving down past the top) is the pull.
    final pull = (notification.metrics.axisDirection == AxisDirection.down)
        ? -delta
        : delta;
    setState(() {
      _raw += pull;
      if (_raw < 0) _raw = 0;
      _offset = _ease(_raw);
    });
    // Deltas while the finger is still moving down the list floor out at 0;
    // only an actual overshoot makes this a pull (and an event).
    if (_raw > 0) _setPulling();
    return false;
  }

  /// The Material glow ripple would fight the custom header at the top edge
  /// (RefreshIndicator disallows it the same way while dragging).
  bool _onGlow(OverscrollIndicatorNotification notification) {
    if (notification.depth != 0 || !notification.leading) return false;
    if (_status == _PullStatus.pulling || _status == _PullStatus.loosing) {
      notification.disallowIndicator();
      return true;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final head = _headHeight;
    return ClipRect(
      child: NotificationListener<ScrollNotification>(
        onNotification: _onScrollNotification,
        child: NotificationListener<OverscrollIndicatorNotification>(
          onNotification: _onGlow,
          child: Stack(
            clipBehavior: Clip.hardEdge,
            children: [
              // The content is pushed down by the pull, exactly like vant's
              // translated track — a paint offset, so the scrollable's
              // layout (and scroll position) never reflows mid-gesture.
              Transform.translate(offset: Offset(0, _offset), child: widget.child),
              Positioned(
                left: 0,
                right: 0,
                top: _offset - head,
                height: head,
                child: widget.header,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
