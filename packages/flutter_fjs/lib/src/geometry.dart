// Synchronous layout reads for the JS side (DOM getBoundingClientRect, and
// the pointer position of the last tap for a click's clientX/clientY).
//
// Component libraries measure before they act: vant's Rate reads each
// star's rect on every click, its Slider turns `clientX - rect.left` into a
// value. The DOM answers those synchronously, so these do too — a sync host
// call. Like the DOM's, a rect read forces a reflow first ([_reflow]): the
// JS side flushed its pending ops, and the tree they changed is rebuilt and
// laid out before measuring. Coordinates are
// logical pixels in the window's space, the same space touch events report
// (touch.dart), so a rect and a touch point can be subtracted.

import 'dart:convert';

import 'package:flutter/rendering.dart'
    show RenderObjectWithLayoutCallbackMixin;
import 'package:flutter/gestures.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import 'mirror_tree.dart';
import 'registry/host.dart';
import 'render/style.dart' show FjsStyle;
import 'widgets/text.dart' show fjsTextStyle;

/// Where the last tap landed, recorded by the tap detector (gesture.dart)
/// just before it dispatches the tap — the click that JS then asks about.
Offset? lastTapPosition;

/// navMount's JS_Call+pump. Nested so a host callback that re-enters is
/// still suppressed. Specs/086: a page's mount-time `useRect` must not pull
/// first-paint layout onto the JS stack (~160ms on vant-form, which froze
/// the Navigator transition). Specs/073 same-tick unhide reads run *after*
/// this window and still force a reflow.
int _suppressReflow = 0;

/// Runs [fn] so `fjs.ui.rect` answers from the last laid-out frame (null /
/// zeros when the node has no box yet) instead of calling [_reflow].
T runWithoutGeometryReflow<T>(T Function() fn) {
  _suppressReflow++;
  try {
    return fn();
  } finally {
    _suppressReflow--;
  }
}

String _num(double v) => v.toStringAsFixed(2);

/// Registers `fjs.ui.rect(id)` → `"[left,top,width,height]"` (null when the
/// node is not laid out) and `fjs.ui.pointer()` → `"[x,y]"` of the last
/// tap (null before the first).
///
/// [flushPending] delivers the host's queued UI notification now (the
/// engine batches it into a microtask): a page root JS just created is only
/// placed under its route by that tree-level signal — without it the forced
/// reflow has no widgets to lay out, and everything a page measures while
/// it mounts reads 0 (vant's swipe width, its tabs underline).
void registerGeometryHostModules({
  required HostRegistry host,
  required MirrorTree tree,
  VoidCallback? flushPending,
}) {
  // before any font loads: the settling window starts at the change itself
  _watchFonts();
  host.register('fjs.ui.rect', (args) {
    final id = args.isEmpty ? null : args[0];
    if (id is! num) return null;
    // During navMount the mirror tree already has the new nodes (applyFrame
    // ran) but Flutter has not built them. Forcing layout here is the first
    // paint of the incoming route, paid on the JS call stack. Skip it; the
    // engine's post-dispatch notify lays the page out on the next frame.
    if (_suppressReflow == 0) _reflow(tree, flushPending);
    final element = tree.node(id.toInt())?.element;
    if (element is! Element || !element.mounted) return null;
    final box = element.findRenderObject();
    if (box is! RenderBox || !box.attached || !box.hasSize) return null;
    final origin = box.localToGlobal(Offset.zero);
    return '[${_num(origin.dx)},${_num(origin.dy)},'
        '${_num(box.size.width)},${_num(box.size.height)}]';
  });

  host.register('fjs.ui.measureText', (args) {
    final styleJson = args.isNotEmpty ? args[0]?.toString() : null;
    final text = args.length > 1 ? args[1]?.toString() ?? '' : '';
    final maxWidth = args.length > 2 && args[2] is num
        ? (args[2] as num).toDouble()
        : double.infinity;
    // The text a node renders is a Text widget: it merges the app's
    // DefaultTextStyle (the theme's font and spacing) and scales by
    // MediaQuery. A bare TextPainter did neither and measured ~2.5%
    // narrower, so vant's cut left "展开" wrapping to a third line. Any
    // mounted page node carries the same inherited context.
    BuildContext? context;
    for (final id in tree.rootChildren) {
      final element = tree.node(id)?.element;
      if (element is Element && element.mounted) {
        context = element;
        break;
      }
    }
    return measureTextBlock(styleJson, text, maxWidth, context: context);
  });

  host.register('fjs.ui.pointer', (args) {
    final p = lastTapPosition;
    return p == null ? null : '[${_num(p.dx)},${_num(p.dy)}]';
  });
}

/// The DOM's forced synchronous reflow: builds and lays out whatever the
/// ops applied so far changed, so a node that JS just un-hid measures its
/// real size instead of the last frame's 0 (vant's collapse reads the
/// content's `offsetHeight` in the tick that shows it). Skipped while a
/// frame is building, laying out or painting — the tree cannot be touched
/// then, and the last frame's answer is the only one there is.
///
/// Also skipped for the duration of [runWithoutGeometryReflow] (navMount):
/// that path's dirty set is the incoming page, and flushing it here would
/// freeze the push transition. Same-tick unhide after the page is live
/// still comes through.
void _reflow(MirrorTree tree, [VoidCallback? flushPending]) {
  final WidgetsBinding binding;
  try {
    binding = WidgetsBinding.instance;
  } on FlutterError {
    return; // a headless engine (pure-Dart tests): nothing is laid out
  }
  if (binding.schedulerPhase == SchedulerPhase.persistentCallbacks) return;
  if (_fontsSettling) return;
  final root = binding.rootElement;
  if (root == null) return;
  final signalled = tree.flushDirty();
  flushPending?.call();
  binding.buildOwner?.buildScope(root);
  // A view under a LayoutBuilder rebuilds in that builder's own layout
  // pass, and in the idle phase the builder defers asking for one to the
  // next frame — a sync reflow would never reach it. Ask directly: the
  // nearest LayoutBuilder above each still-dirty view schedules its layout
  // callback, and the flushLayout below rebuilds and lays it out.
  for (final id in signalled) {
    final e = tree.node(id)?.element;
    if (e is! Element || !e.mounted || !e.dirty) continue;
    e.visitAncestorElements((a) {
      if (a.widget is! ConstrainedLayoutBuilder) return true;
      final ro = a.renderObject;
      if (ro is RenderObjectWithLayoutCallbackMixin) {
        ro.scheduleLayoutCallback();
      }
      return false;
    });
  }
  binding.rootPipelineOwner.flushLayout();
}

/// True from a system-fonts change (fjs loads its icon fonts at start-up)
/// until the next frame. Every RenderParagraph queued a frame callback on
/// that change and asserts it is not detached before the callback runs —
/// Flutter's "no tree mutation between idle and the next frame" invariant,
/// which a forced rebuild would break. Reads in that window get the last
/// frame's layout, as they did before reflow existed.
bool _fontsSettling = false;
bool _watchingFonts = false;

void _watchFonts() {
  if (_watchingFonts) return;
  final PaintingBinding painting;
  try {
    painting = PaintingBinding.instance;
  } on FlutterError {
    return; // headless engine: no fonts, no layout, no reflow
  }
  _watchingFonts = true;
  painting.systemFonts.addListener(() {
    _fontsSettling = true;
    SchedulerBinding.instance.scheduleFrameCallback(
      (_) => _fontsSettling = false,
    );
  });
}

/// Reports every pointer DOWN anywhere in the app — page, overlay, modal —
/// as the deepest fjs node under it (0 when none). This is the document-level
/// touch stream DOM code listens to: vant's click-away (number keyboard,
/// popover) watches `document` for a touchstart outside its own box. Returns
/// the remover; null for a headless engine.
VoidCallback? watchGlobalPointer({
  required MirrorTree tree,
  required void Function(int nodeId, double x, double y) onDown,
}) {
  final GestureBinding gestures;
  try {
    gestures = GestureBinding.instance;
  } on FlutterError {
    return null;
  }
  void route(PointerEvent event) {
    if (event is! PointerDownEvent) return;
    onDown(_nodeAt(tree, event), event.position.dx, event.position.dy);
  }

  gestures.pointerRouter.addGlobalRoute(route);
  return () => gestures.pointerRouter.removeGlobalRoute(route);
}

/// The deepest fjs node whose render box the pointer hit.
int _nodeAt(MirrorTree tree, PointerEvent event) {
  final result = HitTestResult();
  WidgetsBinding.instance.hitTestInView(result, event.position, event.viewId);
  // render object → node, built for this one lookup (a tap, not a frame)
  final owners = <RenderObject, int>{};
  for (final node in tree.allNodes) {
    final element = node.element;
    if (element is! Element || !element.mounted) continue;
    final ro = element.findRenderObject();
    if (ro != null) owners[ro] = node.id;
  }
  for (final entry in result.path) {
    final target = entry.target;
    if (target is! RenderObject) continue;
    // the hit target may sit inside a node's own wrappers: climb to the
    // nearest render object a node owns
    RenderObject? r = target;
    while (r != null) {
      final id = owners[r];
      if (id != null) return id;
      r = r.parent;
    }
  }
  return 0;
}

/// A paragraph's laid-out size at [maxWidth], without a node: what a DOM
/// library gets from a detached `<div>`'s `offsetHeight` after writing its
/// `innerText`. vant's TextEllipsis binary-searches the longest prefix that
/// fits `rows + 0.5` lines this way (specs/128). [styleJson] is a resolved
/// style map (camelCase, as the style engine sends it); the TextStyle and
/// strut are the ones a single-run text node renders with (text.dart), so
/// the measured break points are the ones that will be painted.
/// Answers `"[width,height,lines]"`.
String measureTextBlock(
  String? styleJson,
  String text,
  double maxWidth, {
  BuildContext? context,
}) {
  Map<String, Object?> props = const {};
  if (styleJson != null && styleJson.isNotEmpty) {
    try {
      final decoded = jsonDecode(styleJson);
      if (decoded is Map<String, Object?>) props = decoded;
    } on FormatException {
      // an unreadable style measures as the default text style
    }
  }
  final own = fjsTextStyle(FjsStyle(props));
  final inherited = context == null ? null : DefaultTextStyle.of(context);
  final textStyle = inherited?.style.merge(own) ?? own;
  final painter =
      TextPainter(
        text: TextSpan(text: text, style: textStyle),
        strutStyle: StrutStyle.fromTextStyle(textStyle, forceStrutHeight: true),
        textDirection: TextDirection.ltr,
        textScaler: context == null
            ? TextScaler.noScaling
            : MediaQuery.textScalerOf(context),
        textHeightBehavior: inherited?.textHeightBehavior,
      )..layout(
        maxWidth: maxWidth.isFinite && maxWidth > 0
            ? maxWidth
            : double.infinity,
      );
  final lines = painter.computeLineMetrics().length;
  final result =
      '[${_num(painter.width)},${_num(painter.height)},${lines == 0 ? 1 : lines}]';
  painter.dispose();
  return result;
}
