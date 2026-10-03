// specs/194 — "only the paint changed": a style update that touches nothing but
// colours is applied in place to the node's mounted render objects instead of
// rebuilding the node's widget chain.
//
// Why it exists: a theme switch sends one SET_STYLE per node (3176 of 3332 in
// hello-js's 主题压测 screen) and every one of them used to rebuild that node's
// whole chain (margin → size → decoration → padding → flex / paragraph) — about
// 80–100 ms of a 107 ms switch (specs/194 §结论) — for a result that moves
// nothing: after the rebuild 2 of 13053 render objects needed layout, 12728
// needed paint.
//
// Where it runs: MirrorTree.flushDirty, before any signal is raised — i.e.
// outside build, layout and paint, where touching render objects is legal. Not
// inside the node view's build: mutating render objects from a build is unsafe,
// and by then the setState has already cost its scheduling.
//
// Why the parent is not marked dirty either: `_touch` marks it because the
// parent's build reads children's `display` / `position` / `flexGrow`
// (docs/architecture.md「重建粒度」). A colour change reads none of those.
//
// Why a stale widget is safe: the element keeps the OLD widget while the render
// object carries the new colour. Every later rebuild builds a fresh widget from
// `node.style` (already the new value) and updateRenderObject writes the same
// colour back; nothing is cached below the `_FjsNodeView` instance, so no
// "identical widget, skipped update" can leave the old colour behind.
//
// The rule is refuse, never approximate (constitution V): the fast path is taken
// only when it is provably the same picture, every other case falls back to the
// ordinary rebuild, and each fallback is counted by reason.
import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../mirror_tree.dart';
import '../registry/host.dart' show HostRegistry;
import '../widgets/text.dart' show FjsTextEnvData, fjsPlainTextSpec;
import 'paragraph.dart';
import 'style.dart';

/// Master switch. `--dart-define=FJS_PAINT_ONLY=off` starts with it off; tests
/// and `fjs.dev.paintOnly` flip it.
/// specs/196 switch: `--dart-define=FJS_TEXT_ONLY=off`, or `fjs.dev.textOnly`.
bool fjsTextOnlyEnabled = const String.fromEnvironment('FJS_TEXT_ONLY') != 'off';

bool fjsPaintOnlyEnabled = const String.fromEnvironment('FJS_PAINT_ONLY') != 'off';

class FjsPaintOnlyStats {
  static int applied = 0;

  /// specs/196: text-content updates applied in place / refused, by reason.
  static int textApplied = 0;
  static final Map<String, int> textFallbacks = {};

  static bool textFallback(String reason) {
    textFallbacks[reason] = (textFallbacks[reason] ?? 0) + 1;
    return false;
  }

  /// Why updates stayed on the ordinary path: reason → count.
  static final Map<String, int> fallbacks = {};

  static void reset() {
    applied = 0;
    fallbacks.clear();
    textApplied = 0;
    textFallbacks.clear();
  }

  static bool fallback(String reason) {
    fallbacks[reason] = (fallbacks[reason] ?? 0) + 1;
    return false;
  }
}

const int paintBg = 1, paintColor = 2;

/// Keys a paint-only update may change.
const Set<String> _paintKeys = {'backgroundColor', 'color', 'borderColor'};

/// What changed between two entries, or why it cannot be applied in place.
class _EntryDiff {
  const _EntryDiff(this.flags, this.reason);
  final int flags;
  final String? reason; // null = paint-only
}

const _EntryDiff _same = _EntryDiff(0, null);

// old entry → new entry → diff. Theme switches repeat the same few pairs
// thousands of times; each is computed once.
final Expando<Map<FjsStyleEntry, _EntryDiff>> _diffs = Expando('paintOnlyDiff');

_EntryDiff _diffEntries(FjsStyleEntry a, FjsStyleEntry b) {
  if (identical(a, b)) return _same;
  final memo = (_diffs[a] ??= <FjsStyleEntry, _EntryDiff>{});
  return memo[b] ??= _computeDiff(a, b);
}

_EntryDiff _computeDiff(FjsStyleEntry a, FjsStyleEntry b) {
  final am = a.map, bm = b.map;
  if (am.length != bm.length) return const _EntryDiff(0, 'keys');
  var flags = 0;
  for (final k in am.keys) {
    if (!bm.containsKey(k)) return const _EntryDiff(0, 'keys');
    final v = am[k];
    if (_paintKeys.contains(k)) {
      if (v != bm[k]) {
        if (k == 'backgroundColor') flags |= paintBg;
        if (k == 'color') flags |= paintColor;
        // borderColor only matters through a visible border, refused below
      }
    } else if (v != bm[k]) {
      return const _EntryDiff(0, 'non-paint-key');
    }
    if (k.startsWith('transition') || k.startsWith('animation')) {
      return const _EntryDiff(0, 'transition');
    }
    if (k == 'backgroundImage' || k == 'background') {
      return const _EntryDiff(0, 'background-image');
    }
  }
  // a visible border takes its colour from `color` / `borderColor`; repainting
  // that means replacing the Border, which is not modelled
  if (_hasVisibleBorder(am) || _hasVisibleBorder(bm)) {
    return const _EntryDiff(0, 'border');
  }
  return _EntryDiff(flags, null);
}

bool _hasVisibleBorder(Map<String, Object?> m) {
  final borders = FjsStyle({'style': m}).boxBorders();
  return borders != null && !borders.isNone;
}

/// Classifies a SET_STYLE on [node] (called from MirrorTree.applyFrame with the
/// entries before and after): returns the paint flags (>= 0) when the update
/// can be applied in place, or -1 when it needs the ordinary rebuild.
int classifyPaintOnly(
  MirrorNode node,
  FjsStyleEntry? oldStyle,
  FjsStyleEntry? newStyle,
  FjsStyleEntry? oldActive,
  FjsStyleEntry? newActive,
) {
  int no(String reason) {
    FjsPaintOnlyStats.fallback(reason);
    return -1;
  }

  if (!fjsPaintOnlyEnabled) return -1;
  // a node's first style (its mount) or a cleared one: nothing to compare, and
  // not worth a counter entry — every node passes through here once
  if (oldStyle == null || newStyle == null) return -1;
  if (node.hoverStyle != null) return no('hover');
  // pressed by its owner (a pseudo-element of a pressed ancestor): the node's
  // own `pressed` flag does not see that, so it is not tracked here
  if (node.prop('pressWithOwner') == true) return no('press-with-owner');
  final tag = node.tag;
  if (tag == 'view') {
    if (node.prop('htmlBlock') == true) return no('html-block');
    final own = node.text;
    if (own != null && own.trim().isNotEmpty) return no('view-text'); // bare string = text child
  } else if (tag == 'text') {
    if (node.children.isNotEmpty || node.prop('richSpans') != null) return no('rich-text');
  } else {
    return no('tag');
  }
  final base = _diffEntries(oldStyle, newStyle);
  if (base.reason != null) return no(base.reason!);
  // the pressed variant travels with the base style on a theme switch; it must
  // be paint-only too, or absent on both sides
  if ((oldActive == null) != (newActive == null)) return no('active-appears');
  if (oldActive != null) {
    final a = _diffEntries(oldActive, newActive!);
    if (a.reason != null) return no('active-${a.reason}');
  }
  return base.flags;
}

/// A node's own decoration box and paragraph, found by walking down from its
/// outermost render object. The walk stops at anything that can hold several
/// children (a flex's children are other nodes), so a decoration below it is
/// never taken for this node's.
({RenderDecoratedBox? box, RenderFjsParagraph? paragraph}) _ownChain(RenderObject root) {
  RenderDecoratedBox? box;
  RenderFjsParagraph? paragraph;
  RenderObject? r = root;
  for (var depth = 0; r != null && depth < 12; depth++) {
    if (r is RenderDecoratedBox && box == null) box = r;
    if (r is RenderFjsParagraph) {
      paragraph = r;
      break;
    }
    if (r is ContainerRenderObjectMixin) break;
    RenderObject? only;
    var n = 0;
    r.visitChildren((c) {
      only = c;
      n++;
    });
    if (n != 1) break;
    r = only;
  }
  return (box: box, paragraph: paragraph);
}

/// Applies a classified update to [node]'s mounted render objects. False means
/// nothing was (fully) applied and the caller must rebuild the node.
bool applyPaintOnly(MirrorNode node, int flags) {
  final needsBg = (flags & paintBg) != 0;
  final needsText = node.tag == 'text' && (flags & paintColor) != 0;
  // nothing this node paints changed (a box's own `color` colours only its
  // text, which are nodes of their own; a border colour with no border)
  if (!needsBg && !needsText) {
    FjsPaintOnlyStats.applied++;
    return true;
  }
  final e = node.element;
  if (e is! Element || !e.mounted) return FjsPaintOnlyStats.fallback('unmounted');
  if (node.pressed) return FjsPaintOnlyStats.fallback('pressed');
  final root = e.findRenderObject();
  if (root == null || !root.attached) return FjsPaintOnlyStats.fallback('unattached');

  final chain = _ownChain(root);
  final box = chain.box;
  final paragraph = chain.paragraph;

  final style = FjsStyle.of(node);
  if ((flags & paintBg) != 0) {
    final bg = style.backgroundColor;
    if (box == null) return FjsPaintOnlyStats.fallback('no-box');
    final d = box.decoration;
    if (d is! BoxDecoration) return FjsPaintOnlyStats.fallback('decoration');
    if (d.color != bg) {
      box.decoration = BoxDecoration(
        color: bg,
        image: d.image,
        border: d.border,
        borderRadius: d.borderRadius,
        boxShadow: d.boxShadow,
        gradient: d.gradient,
        backgroundBlendMode: d.backgroundBlendMode,
        shape: d.shape,
      );
    }
  }
  if (node.tag == 'text' && (flags & paintColor) != 0) {
    if (paragraph == null) return FjsPaintOnlyStats.fallback('no-paragraph');
    final env = FjsTextEnvData.peek(e);
    if (env == null) return FjsPaintOnlyStats.fallback('no-text-env');
    final spec = fjsPlainTextSpec(env, node.text, style);
    if (spec == null) return FjsPaintOnlyStats.fallback('text-spec');
    if (!paragraph.recolorPaintOnly(spec.span)) {
      return FjsPaintOnlyStats.fallback('paragraph-size');
    }
  }
  FjsPaintOnlyStats.applied++;
  return true;
}


// ---- specs/196: "only the text changed" -------------------------------------
//
// A SET_TEXT on a plain `text` node changes what one RenderFjsParagraph shows
// and nothing about the node's widget chain, yet used to rebuild the chain and
// the parent's (77–88% of a 200-text update's LAYOUT stage on a device). The
// same shape as the paint-only path above, with one difference: a new string
// changes metrics and the semantics label, so the span goes through the
// paragraph's ordinary `text` setter (markNeedsLayout + markNeedsSemanticsUpdate)
// and Flutter propagates the relayout itself. Nothing is bypassed.
//
// Refused (and counted by reason in [FjsPaintOnlyStats.textFallbacks]) whenever
// the update is more than a string swap: a text becoming empty or non-empty
// (the parent's build filters hidden children), anything that is not a plain
// childless `text`, a parent that is not a plain `view` (a span's paragraph, an
// html block's inline paragraph and a `display: contents` box are built from
// their children), a `button` anywhere above (it collects its subtree's text
// into one label), a transition (its builder closure holds the old string), a
// pressed node (paints the pressed style, which `fjsPlainTextSpec` would not
// know).

/// Whether a SET_TEXT on [node] ([oldText] → its current text) can be applied in
/// place. Called from MirrorTree.applyFrame.
bool classifyTextOnly(MirrorNode node, String? oldText, MirrorTree tree) {
  bool no(String reason) => FjsPaintOnlyStats.textFallback(reason);
  if (!fjsTextOnlyEnabled) return false;
  if (node.tag != 'text' || node.children.isNotEmpty || node.prop('richSpans') != null) {
    return no('not-plain-text');
  }
  // a node's first text (its mount): nothing to swap and not worth a counter
  // entry — every text node passes through here once
  if (oldText == null) return false;
  final text = node.text ?? '';
  if (oldText.isEmpty || text.isEmpty) return no('visibility');
  if (node.hoverStyle != null || node.prop('pressWithOwner') == true) return no('state-style');
  final map = node.styleMap;
  if (map['display']?.toString() == 'contents') return no('display-contents');
  for (final k in map.keys) {
    if (k.startsWith('transition') || k.startsWith('animation')) return no('transition');
  }
  final pid = tree.parentIdOf(node.id);
  final parent = pid == null ? null : tree.node(pid);
  if (parent == null || parent.tag != 'view' || parent.prop('htmlBlock') == true) return no('parent');
  if (parent.styleMap['display']?.toString() == 'contents') return no('parent-contents');
  for (var a = pid; a != null && a != 0; a = tree.parentIdOf(a)) {
    if (tree.node(a)?.tag == 'button') return no('button');
  }
  return true;
}

/// Applies a classified SET_TEXT. False: nothing changed, rebuild the node.
bool applyTextOnly(MirrorNode node) {
  final e = node.element;
  if (e is! Element || !e.mounted) return FjsPaintOnlyStats.textFallback('unmounted');
  if (node.pressed) return FjsPaintOnlyStats.textFallback('pressed');
  final root = e.findRenderObject();
  if (root == null || !root.attached) return FjsPaintOnlyStats.textFallback('unattached');
  final paragraph = _ownChain(root).paragraph;
  if (paragraph == null) return FjsPaintOnlyStats.textFallback('no-paragraph');
  final style = FjsStyle.of(node);
  if (style.transitions != null) return FjsPaintOnlyStats.textFallback('transition');
  final env = FjsTextEnvData.peek(e);
  if (env == null) return FjsPaintOnlyStats.textFallback('no-text-env');
  final spec = fjsPlainTextSpec(env, node.text, style);
  if (spec == null) return FjsPaintOnlyStats.textFallback('text-spec');
  paragraph.text = spec.span;
  FjsPaintOnlyStats.textApplied++;
  return true;
}

/// `fjs.dev.paintOnly(mode)` → whether the fast path is on after the call
/// (`'on'` / `'off'`; no argument just reads it). Dev builds only, for A/B-ing
/// on a device without rebuilding (hello-js `__themeBench.setPaintOnly`).
void registerPaintOnlyDevModule({required HostRegistry host}) {
  if (kReleaseMode) return;
  host.register('fjs.dev.textOnly', (args) {
    final want = args.isEmpty ? null : args[0]?.toString();
    if (want == 'on') fjsTextOnlyEnabled = true;
    if (want == 'off') fjsTextOnlyEnabled = false;
    return fjsTextOnlyEnabled ? 'on' : 'off';
  });
  host.register('fjs.dev.paintOnly', (args) {
    final want = args.isEmpty ? null : args[0]?.toString();
    if (want == 'on') fjsPaintOnlyEnabled = true;
    if (want == 'off') fjsPaintOnlyEnabled = false;
    return fjsPaintOnlyEnabled ? 'on' : 'off';
  });
}
