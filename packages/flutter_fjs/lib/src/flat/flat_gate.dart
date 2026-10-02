// specs/193 — the gate that decides whether a subtree is painted by one flat
// display surface or goes down the ordinary widget path.
//
// Rule of thumb: refuse, never approximate. A subtree enters only if every node
// in it is something the engine reproduces exactly (flat_style.dart's
// whitelist, backed by test/flat_parity_test.dart); otherwise the whole subtree
// — or just this root candidate, with its children getting their own chance —
// keeps the ordinary renderer and the page looks the same, only slower.
//
// The root is the TOPMOST node that qualifies: [accept] runs when a node's view
// builds, so a qualifying ancestor claims the subtree before its descendants
// are ever built. When something under a root stops qualifying (an `onTap`
// appears, a style leaves the subset) the root's signal rebuilds it, [accept]
// says no, and the node's children are built as ordinary views that each ask
// again.
//
// Cost: [accept] is O(1) for the common reject (the node itself), and the
// subtree walk is memoised on the MirrorNode (flatPure / flatSize), cleared up
// the parent chain by MirrorTree.flushDirty — so asking at every level of a
// deep page does not go quadratic.
import 'package:flutter/foundation.dart';
import 'package:flutter/semantics.dart';

import '../mirror_tree.dart';
import '../registry/host.dart' show HostRegistry;
import '../render/renderer.dart' show FjsNodeRenderer;
import 'flat_style.dart';

/// `auto`: flat when the gate says so, the platform has no semantics client and
/// the subtree is big enough to be worth a surface. `off`: never. `force`:
/// whenever the subtree is pure, regardless of semantics or size (tests,
/// benches, simulator comparisons — the simulator reports semantics enabled).
enum FjsFlatMode { auto, off, force }

FjsFlatMode fjsFlatMode = switch (const String.fromEnvironment('FJS_FLAT')) {
  'off' => FjsFlatMode.off,
  'force' => FjsFlatMode.force,
  _ => FjsFlatMode.auto,
};

/// Whether a semantics client is attached. Overridable because flutter_test
/// keeps one attached for every test (so, by design, `auto` never goes flat in
/// the existing widget tests — their behaviour is untouched).
@visibleForTesting
bool Function() fjsFlatSemanticsEnabled = () => SemanticsBinding.instance.semanticsEnabled;

/// Subtrees smaller than this stay ordinary in `auto` mode. Offline the surface
/// mounts cheaper at EVERY size (test/flat_threshold_bench_test.dart: 48% of the
/// ordinary cost at 4 nodes, 24% at 16, 8% at 512 — its fixed cost is ~0.24 ms),
/// so the floor is not about mount. It is about layers: each surface is its own
/// repaint boundary, and a page of hundreds of tiny pure subtrees would hand the
/// compositor hundreds of layers, a cost no offline bench sees. 16 is the
/// conservative end of the measured range; lower it only with a device profile
/// of such a page (specs/193 T042).
int fjsFlatMinNodes = 16;

class FjsFlatStats {
  /// Why subtrees stayed ordinary: key → how many verdicts. Verdicts are
  /// memoised, so this counts distinct subtree evaluations, not frames.
  static final Map<String, int> rejected = {};
  static int surfaces = 0;

  static void reset() {
    rejected.clear();
    surfaces = 0;
  }

  static void reject(String reason) {
    final first = !rejected.containsKey(reason);
    rejected[reason] = (rejected[reason] ?? 0) + 1;
    if (first) {
      assert(() {
        debugPrint('[flat] subtree stays ordinary: $reason');
        return true;
      }());
    }
  }
}

/// Props a flat node may carry. `repaintBoundary` only asks for a paint layer,
/// which the surface is anyway.
const Set<String> _allowedProps = {'repaintBoundary'};

abstract final class FlatGate {
  static bool accept(MirrorNode node, MirrorTree tree, {required bool isRoot}) {
    final mode = fjsFlatMode;
    if (mode == FjsFlatMode.off) return false;
    // a page root's children stretch / grow by their own rule (growChildren)
    if (isRoot) return false;
    if (mode == FjsFlatMode.auto && fjsFlatSemanticsEnabled()) {
      return false;
    }
    final size = pureSize(node, tree);
    if (size < 0) return false;
    return mode == FjsFlatMode.force || size >= fjsFlatMinNodes;
  }

  /// Visible node count of [node]'s subtree when every node in it can be flat,
  /// else -1.
  static int pureSize(MirrorNode node, MirrorTree tree) {
    if (node.flatPure == 1) return node.flatSize;
    if (node.flatPure == 2) return -1;
    final size = _compute(node, tree);
    node.flatPure = size < 0 ? 2 : 1;
    node.flatSize = size < 0 ? 0 : size;
    return size;
  }

  static int _compute(MirrorNode n, MirrorTree tree) {
    if (FjsNodeRenderer.isHidden(n)) return -1;
    if (n.tag != 'view' && n.tag != 'text') {
      FjsFlatStats.reject('tag=${n.tag}');
      return -1;
    }
    for (final k in n.props.keys) {
      if (!_allowedProps.contains(k)) {
        FjsFlatStats.reject('prop:$k');
        return -1;
      }
    }
    if (n.activeStyle != null || n.hoverStyle != null) {
      FjsFlatStats.reject('pseudo-style');
      return -1;
    }
    final verdict = flatVerdictOf(n);
    final style = verdict.style;
    if (style == null) {
      FjsFlatStats.reject('style:${verdict.rejected}');
      return -1;
    }
    if (n.tag == 'text') {
      if (n.children.isNotEmpty) {
        FjsFlatStats.reject('text-with-children');
        return -1;
      }
      final t = n.text;
      if (t == null || t.isEmpty) {
        FjsFlatStats.reject('text-empty');
        return -1;
      }
      return 1;
    }
    // a bare string in a view is synthesised into a text child by the ordinary
    // path (node_adapters.dart): not modelled
    final own = n.text;
    if (own != null && own.trim().isNotEmpty) {
      FjsFlatStats.reject('view-text');
      return -1;
    }
    var total = 1;
    for (final id in n.children) {
      final k = tree.node(id);
      if (k == null || FjsNodeRenderer.isHidden(k)) continue;
      final sub = pureSize(k, tree);
      if (sub < 0) return -1;
      // an item with a cross size of its own under a stretching parent is
      // wrapped in Align / FjsUncappedCross by the ordinary path: not modelled
      final ks = flatVerdictOf(k).style!;
      final crossSized = style.row ? ks.height != null : ks.width != null;
      if (crossSized && style.align == FlatAlign.stretch) {
        FjsFlatStats.reject('cross-size-under-stretch');
        return -1;
      }
      total += sub;
    }
    return total;
  }
}

/// `fjs.dev.flat(mode)` → the mode now in force (`auto` | `off` | `force`), for
/// A/B-ing the flat surface on a device without rebuilding the app
/// (examples/hello-js `__flat4050.setFlat`). Not registered in release builds,
/// and every node is rebuilt so the change shows on the next frame. Takes no
/// argument to just read the mode.
void registerFlatDevModule({required HostRegistry host, required MirrorTree tree}) {
  if (kReleaseMode) return;
  host.register('fjs.dev.flat', (args) {
    final want = args.isEmpty ? null : args[0]?.toString();
    final next = switch (want) {
      'auto' => FjsFlatMode.auto,
      'off' => FjsFlatMode.off,
      'force' => FjsFlatMode.force,
      _ => null,
    };
    if (next != null && next != fjsFlatMode) {
      fjsFlatMode = next;
      tree.pingAll();
    }
    return fjsFlatMode.name;
  });
}
