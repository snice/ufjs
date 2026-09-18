// Touch events, shaped like the DOM's: touchstart / touchmove / touchend /
// touchcancel, with `touches`, `targetTouches` and `changedTouches`.
//
// The JS half is fjs-runtime's src/ui/touch.ts, which decodes the payload
// written here; the web adapter builds the same objects from pointer
// events. One page's drag code therefore runs unchanged on both.
//
// Three things this has to get right:
//
//   * Ordering. A move is coalesced to one dispatch per frame (a packet can
//     carry several), but a start/end/cancel flushes the pending move first,
//     so JS never sees a move after the end it happened before.
//   * The gesture arena. A Listener keeps receiving pointers no matter who
//     wins the arena, so touch events alone would fight an enclosing
//     scrollable rather than beat it. `touch-action` puts a recognizer in
//     the arena that claims the pointer — the same declaration a browser
//     needs, doing the same job.
//   * Cancellation. When something else does win (a scroll takes over), the
//     web fires touchcancel; losing the arena is exactly that signal.
import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../widgets/dispatch.dart';
import 'style.dart';

/// Pointer travel that turns a press into a gesture this node claims. Below
/// Flutter's own [kTouchSlop] (18) on purpose: a scrollable claims at 18, so
/// claiming at 8 means the node wins the arena while the finger is still
/// inside the scrollable's own dead zone. A mouse is precise, and Flutter
/// scrolls it after a single pixel, so the same race is run at 1.
const double _kClaimSlop = 8;
const double _kClaimSlopPrecise = 1;

/// `touch-action`, the CSS property, minus the values that mean nothing off
/// the web (`pinch-zoom`, `pan-left`...).
enum TouchAction {
  /// The default: gestures go to whoever normally handles them, and a
  /// parent scroller taking over cancels the touches.
  auto,

  /// This node handles everything; nothing else gets the pointer.
  none,

  /// A parent may still pan horizontally; vertical drags are this node's.
  panX,

  /// A parent may still pan vertically; horizontal drags are this node's.
  panY,
}

TouchAction parseTouchAction(Object? value) {
  switch (value?.toString()) {
    case 'none':
      return TouchAction.none;
    case 'pan-x':
      return TouchAction.panX;
    case 'pan-y':
      return TouchAction.panY;
    default:
      // 'auto', 'manipulation', anything unknown
      return TouchAction.auto;
  }
}

const _touchProps = <String>[
  'onTouchstart',
  'onTouchmove',
  'onTouchend',
  'onTouchcancel',
];

/// Whether the node listens for any touch event.
bool hasTouchEvents(MirrorNode node) {
  for (final prop in _touchProps) {
    if (node.props[prop] == true) return true;
  }
  return false;
}

/// One pointer that is currently down. Coordinates are global logical
/// pixels — fjs has no scrolling window, so client/page/screen are one and
/// the same number.
class _TouchPoint {
  _TouchPoint(this.identifier, this.position);

  final int identifier;
  Offset position;
}

/// Every pointer down anywhere in the app: the DOM's `touches`. Keyed by
/// pointer id, in the order the fingers landed.
final Map<int, _TouchPoint> _activeTouches = <int, _TouchPoint>{};

/// Drops every pointer the app thinks is down. Tests only: a widget test
/// can abandon a finger mid-gesture, and the next test would see it in
/// `touches`.
@visibleForTesting
void debugResetTouches() => _activeTouches.clear();

/// Whether the node needs the touch listener: it listens for touch events,
/// or it declares a `touch-action` (worth honouring even with no listener —
/// it is how a page stops a scroller from stealing a drag it handles some
/// other way).
bool needsTouchNode(MirrorNode node, FjsStyle style) =>
    hasTouchEvents(node) ||
    parseTouchAction(style.touchAction) != TouchAction.auto;

/// Wraps [content] when [needsTouchNode] says so.
Widget touchNode(
  MirrorNode node,
  FjsStyle style,
  Widget content,
  FjsDispatch dispatch,
) {
  final action = parseTouchAction(style.touchAction);
  if (!hasTouchEvents(node) && action == TouchAction.auto) return content;
  return FjsTouchNode(
    key: ValueKey<int>(node.id),
    node: node,
    action: action,
    dispatch: dispatch,
    child: content,
  );
}

class FjsTouchNode extends StatefulWidget {
  const FjsTouchNode({
    super.key,
    required this.node,
    required this.action,
    required this.dispatch,
    required this.child,
  });

  final MirrorNode node;
  final TouchAction action;
  final FjsDispatch dispatch;
  final Widget child;

  @override
  State<FjsTouchNode> createState() => _FjsTouchNodeState();
}

class _FjsTouchNodeState extends State<FjsTouchNode> {
  /// Pointers that went down on this node: the DOM's `targetTouches`.
  final Set<int> _own = <int>{};
  final Set<int> _pendingMoves = <int>{};
  bool _moveScheduled = false;
  double _moveStamp = 0;
  late final _TouchActionRecognizer _recognizer = _TouchActionRecognizer(
    debugOwner: this,
    onLost: _cancelPointer,
  );

  @override
  void dispose() {
    // a node torn down mid-drag: tell JS, or it waits for an end that can
    // never come
    if (_own.isNotEmpty) {
      _flushMoves();
      _dispatch(FjsEvent.touchCancel, _own.toList(), removing: true);
      for (final pointer in _own) {
        _activeTouches.remove(pointer);
      }
      _own.clear();
    }
    _recognizer.dispose();
    super.dispose();
  }

  bool _listens(String prop) => widget.node.props[prop] == true;

  void _onDown(PointerDownEvent event) {
    _captureOrigin();
    _flushMoves();
    _activeTouches[event.pointer] = _TouchPoint(event.pointer, event.position);
    _own.add(event.pointer);
    // in the arena even with `touch-action: auto`: it never claims then,
    // but losing to a scroller is how touchcancel is noticed
    _recognizer.action = widget.action;
    _recognizer.addPointer(event);
    if (_listens('onTouchstart')) {
      _dispatch(FjsEvent.touchStart, [event.pointer], stamp: _ms(event));
    }
  }

  void _onMove(PointerMoveEvent event) {
    _captureOrigin();
    final point = _activeTouches[event.pointer];
    if (point == null) return;
    point.position = event.position;
    if (!_own.contains(event.pointer) || !_listens('onTouchmove')) return;
    _pendingMoves.add(event.pointer);
    _moveStamp = _ms(event);
    if (_moveScheduled) return;
    // one dispatch per batch of pointer packets: a platform can deliver
    // several moves for the same frame, and JS only cares about where the
    // finger ended up
    _moveScheduled = true;
    scheduleMicrotask(_flushMoves);
  }

  void _flushMoves() {
    _moveScheduled = false;
    if (_pendingMoves.isEmpty) return;
    final changed = _pendingMoves.toList();
    _pendingMoves.clear();
    _dispatch(FjsEvent.touchMove, changed, stamp: _moveStamp);
  }

  void _onUp(PointerUpEvent event) => _end(event, FjsEvent.touchEnd);

  void _onCancel(PointerCancelEvent event) => _end(event, FjsEvent.touchCancel);

  void _end(PointerEvent event, int type) {
    if (!_own.contains(event.pointer)) return;
    _flushMoves();
    final point = _activeTouches[event.pointer];
    if (point != null) point.position = event.position;
    final listens = type == FjsEvent.touchEnd
        ? _listens('onTouchend')
        : _listens('onTouchcancel');
    if (listens) {
      _dispatch(type, [event.pointer], stamp: _ms(event), removing: true);
    }
    _activeTouches.remove(event.pointer);
    _own.remove(event.pointer);
  }

  /// The arena took the gesture away from this node — the web's touchcancel.
  void _cancelPointer(int pointer) {
    if (!_own.contains(pointer)) return;
    _flushMoves();
    if (_listens('onTouchcancel')) {
      _dispatch(FjsEvent.touchCancel, [pointer], removing: true);
    }
    _activeTouches.remove(pointer);
    _own.remove(pointer);
  }

  double _ms(PointerEvent event) => event.timeStamp.inMicroseconds / 1000.0;

  /// Encodes and sends one event. [changed] is `changedTouches`; with
  /// [removing] set they are already on their way out, so they are listed
  /// only there — as in the DOM, where an ended finger is gone from
  /// `touches` by the time the handler runs.
  void _dispatch(
    int type,
    List<int> changed, {
    double? stamp,
    bool removing = false,
  }) {
    final buffer = StringBuffer('{"ts":');
    buffer.write(_round(stamp ?? _moveStamp));
    // The node's own origin. Points are reported in page coordinates, and a
    // page cannot convert them itself — there is no getBoundingClientRect
    // here — so the one side that knows the box sends it, and ui/touch.ts
    // turns it into the DOM's offsetX/offsetY. A `<canvas>` hit-tests
    // against exactly that.
    final origin = _lastOrigin;
    if (origin != null) {
      buffer
        ..write(',"o":[')
        ..write(_round(origin.dx))
        ..write(',')
        ..write(_round(origin.dy))
        ..write(']');
    }
    final id = widget.node.props['id'];
    if (id != null) {
      buffer
        ..write(',"id":')
        ..write(_jsonString(id.toString()));
    }
    final excluded = removing ? changed.toSet() : const <int>{};
    final touches = <_TouchPoint>[
      for (final entry in _activeTouches.entries)
        if (!excluded.contains(entry.key)) entry.value,
    ];
    final target = <_TouchPoint>[
      for (final pointer in _own)
        if (!excluded.contains(pointer) && _activeTouches[pointer] != null)
          _activeTouches[pointer]!,
    ];
    final changedPoints = <_TouchPoint>[
      for (final pointer in changed)
        if (_activeTouches[pointer] != null) _activeTouches[pointer]!,
    ];
    final touchesJson = _encodePoints(touches);
    buffer
      ..write(',"touches":')
      ..write(touchesJson);
    // `tt` and `changed` ride along only when they differ from `touches` —
    // with one finger down they never do, which is every frame of a drag
    final targetJson = _encodePoints(target);
    if (targetJson != touchesJson) {
      buffer
        ..write(',"tt":')
        ..write(targetJson);
    }
    final changedJson = _encodePoints(changedPoints);
    if (changedJson != touchesJson) {
      buffer
        ..write(',"changed":')
        ..write(changedJson);
    }
    buffer.write('}');
    widget.dispatch(widget.node.id, type, text: buffer.toString());
  }

  /// Last known top-left of this node in page coordinates.
  ///
  /// Cached because the final event of a sequence can be a cancel sent while
  /// the node is being torn down, and a defunct element has no render object
  /// to ask — the cancel still has to carry usable coordinates.
  Offset? _lastOrigin;

  /// Reads the box's position. Only ever called from a live pointer
  /// handler: an event dispatched while the node is being torn down (the
  /// teardown cancel) runs against a defunct element, where asking for the
  /// render object throws — that path uses the cached value instead.
  void _captureOrigin() {
    final box = context.findRenderObject();
    if (box is RenderBox && box.hasSize) {
      _lastOrigin = box.localToGlobal(Offset.zero);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      // the element's own box takes the touch, and what is behind it does
      // not — as in the DOM, where only the topmost target is hit
      behavior: HitTestBehavior.opaque,
      onPointerDown: _onDown,
      onPointerMove: _onMove,
      onPointerUp: _onUp,
      onPointerCancel: _onCancel,
      child: widget.child,
    );
  }
}

String _encodePoints(List<_TouchPoint> points) {
  final buffer = StringBuffer('[');
  for (var i = 0; i < points.length; i++) {
    if (i > 0) buffer.write(',');
    final p = points[i];
    buffer
      ..write('[')
      ..write(p.identifier)
      ..write(',')
      ..write(_round(p.position.dx))
      ..write(',')
      ..write(_round(p.position.dy))
      ..write(']');
  }
  buffer.write(']');
  return buffer.toString();
}

/// Hundredths of a pixel is finer than any screen, and keeps the payload
/// short — this runs on every move.
String _round(double value) {
  final rounded = (value * 100).roundToDouble() / 100;
  if (rounded == rounded.roundToDouble() && rounded.abs() < 1e15) {
    return rounded.toInt().toString();
  }
  return rounded.toString();
}

String _jsonString(String value) {
  final buffer = StringBuffer('"');
  for (final rune in value.runes) {
    switch (rune) {
      case 0x22:
        buffer.write(r'\"');
      case 0x5c:
        buffer.write(r'\\');
      case 0x0a:
        buffer.write(r'\n');
      case 0x0d:
        buffer.write(r'\r');
      case 0x09:
        buffer.write(r'\t');
      default:
        if (rune < 0x20) {
          buffer.write('\\u${rune.toRadixString(16).padLeft(4, '0')}');
        } else {
          buffer.writeCharCode(rune);
        }
    }
  }
  buffer.write('"');
  return buffer.toString();
}

/// The arena half of `touch-action`.
///
/// It claims the pointer for the node — which is what stops an enclosing
/// scrollable, since the arena lets exactly one member win — and reports
/// back when somebody else claims it first, so the node can fire
/// touchcancel.
///
/// It never wins by default: at pointer-up it rejects itself, leaving the
/// node's own tap (and any parent's) to resolve the arena as it would
/// without touch listeners. Only movement makes it claim.
class _TouchActionRecognizer extends OneSequenceGestureRecognizer {
  _TouchActionRecognizer({required this.onLost, super.debugOwner});

  TouchAction action = TouchAction.auto;
  final void Function(int pointer) onLost;

  final Map<int, Offset> _origin = <int, Offset>{};
  final Map<int, double> _slop = <int, double>{};
  final Set<int> _selfResolved = <int>{};

  @override
  void addAllowedPointer(PointerDownEvent event) {
    startTrackingPointer(event.pointer, event.transform);
    _origin[event.pointer] = event.position;
    _slop[event.pointer] = event.kind == PointerDeviceKind.touch
        ? _kClaimSlop
        : _kClaimSlopPrecise;
    // `touch-action: none` is a declaration made before the gesture starts:
    // the parent scrollable should not get a chance to claim a fast first
    // move in the same arena round.
    if (action == TouchAction.none) {
      _selfResolved.add(event.pointer);
      resolvePointer(event.pointer, GestureDisposition.accepted);
    }
  }

  @override
  void handleEvent(PointerEvent event) {
    final origin = _origin[event.pointer];
    if (origin == null) return;
    if (event is PointerMoveEvent) {
      if (_claims(
        event.position - origin,
        _slop[event.pointer] ?? _kClaimSlop,
      )) {
        _selfResolved.add(event.pointer);
        resolvePointer(event.pointer, GestureDisposition.accepted);
      }
      return;
    }
    if (event is PointerUpEvent || event is PointerCancelEvent) {
      _selfResolved.add(event.pointer);
      resolvePointer(event.pointer, GestureDisposition.rejected);
      _forget(event.pointer);
      stopTrackingPointer(event.pointer);
    }
  }

  bool _claims(Offset delta, double slop) {
    switch (action) {
      case TouchAction.auto:
        return false;
      case TouchAction.none:
        return delta.distance > slop;
      case TouchAction.panX:
        // the parent keeps horizontal panning; this node takes vertical
        return delta.dy.abs() > slop && delta.dy.abs() > delta.dx.abs();
      case TouchAction.panY:
        return delta.dx.abs() > slop && delta.dx.abs() > delta.dy.abs();
    }
  }

  @override
  void rejectGesture(int pointer) {
    super.rejectGesture(pointer);
    // rejected by the arena, not by us: something else owns the gesture now
    if (!_selfResolved.remove(pointer)) onLost(pointer);
    _forget(pointer);
    stopTrackingPointer(pointer);
  }

  @override
  void acceptGesture(int pointer) {
    _selfResolved.remove(pointer);
  }

  void _forget(int pointer) {
    _origin.remove(pointer);
    _slop.remove(pointer);
  }

  @override
  void didStopTrackingLastPointer(int pointer) {}

  @override
  String get debugDescription => 'fjs touch-action';
}
