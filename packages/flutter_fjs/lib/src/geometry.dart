// Synchronous layout reads for the JS side (DOM getBoundingClientRect, and
// the pointer position of the last tap for a click's clientX/clientY).
//
// Component libraries measure before they act: vant's Rate reads each
// star's rect on every click, its Slider turns `clientX - rect.left` into a
// value. The DOM answers those synchronously, so these do too — a sync host
// call, served from the render tree of the last frame. Coordinates are
// logical pixels in the window's space, the same space touch events report
// (touch.dart), so a rect and a touch point can be subtracted.

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
void registerGeometryHostModules({
  required HostRegistry host,
  required MirrorTree tree,
}) {
  host.register('fjs.ui.rect', (args) {
    final id = args.isEmpty ? null : args[0];
    if (id is! num) return null;
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
