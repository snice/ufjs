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

import 'package:flutter/rendering.dart'
    show RenderObjectWithLayoutCallbackMixin;
import 'package:flutter/gestures.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import 'mirror_tree.dart';
import 'registry/host.dart';

/// Where the last tap landed, recorded by the tap detector (gesture.dart)
/// just before it dispatches the tap — the click that JS then asks about.
Offset? lastTapPosition;

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
    _reflow(tree, flushPending);
    final element = tree.node(id.toInt())?.element;
    if (element is! Element || !element.mounted) return null;
    final box = element.findRenderObject();
    if (box is! RenderBox || !box.attached || !box.hasSize) return null;
    final origin = box.localToGlobal(Offset.zero);
    return '[${_num(origin.dx)},${_num(origin.dy)},'
        '${_num(box.size.width)},${_num(box.size.height)}]';
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
