// specs/193 — the flat display surface's layout engine.
//
// NOT a CSS flexbox. The ordinary renderer lays a node out through a chain of
// Flutter widgets —
//
//   Padding(margin) → ConstrainedBox(tight width/height, only when sized)
//     → FjsBox (paint only) → Padding(padding) → FjsFlex | paragraph
//
// — plus, around each flex item, FjsShrinkCross markers and Flexible, and
// FjsFlex's own two-pass shrink-then-stretch. The result is a Flutter
// constraint protocol with a few CSS accents (row default align-items:center,
// stretch degrading to start under an unbounded cross axis…). Re-deriving that
// from the CSS spec would draw the same page differently, so this file mirrors
// the chain function by function: BoxConstraints in, Size out, with
// deflate/enforce/constrain semantics and RenderFlex's algorithm as Flutter
// 3.41 has them (plan §3.2, §6). Parity is not argued here, it is tested:
// test/flat_parity_test.dart renders the same tree both ways and compares every
// rect and every pixel.
//
// What is per node: one FlatNode object (style template, children, the last
// constraints it was laid out with, its size and offset). A layout call with
// the constraints a clean node already has returns its cached size — the same
// early-out RenderObject.layout has — so a one-text change re-lays only the
// dirty path (marked up the parent chain) and whatever its new size disturbs.
import 'dart:math' as math;

import 'package:flutter/rendering.dart';

import '../mirror_tree.dart';
import '../render/paragraph.dart';
import '../render/renderer.dart' show FjsNodeRenderer;
import '../widgets/text.dart';
import 'flat_style.dart';

/// Counters the tests and the bench read.
class FlatStats {
  static int relaidNodes = 0;
  static int paintedNodes = 0;
  static void reset() {
    relaidNodes = 0;
    paintedNodes = 0;
  }
}

class FlatNode {
  FlatNode(this.node, this.parent, this.style, this.isText);

  final MirrorNode node;
  final FlatNode? parent;
  FlatStyle style;
  final bool isText;
  final List<FlatNode> kids = [];

  /// Style entry this node's [style] was read from; a SET_STYLE swaps it.
  Object? entry;
  String? text;

  // ---- layout cache ----------------------------------------------------------
  bool dirty = true;
  BoxConstraints? lastC;

  /// The constraints [_layoutFlex] last ran with (the content box), so a child
  /// can ask what its parent's effective alignment was.
  BoxConstraints? flexC;

  /// Outer size, margin included (what the parent sees).
  Size size = Size.zero;

  /// Position inside the parent's CONTENT box (its padding edge origin), set by
  /// the parent's flex pass every time it runs.
  Offset offset = Offset.zero;

  /// The decorated box inside the margin: where the background paints.
  Size borderSize = Size.zero;

  /// Union of this node's outer rect and every descendant's, in its own
  /// coordinates (children may overflow); lets paint skip a subtree.
  Rect bounds = Rect.zero;

  // ---- text ------------------------------------------------------------------
  FjsPlainTextSpec? spec;

  /// Shared through the engine's cache (many nodes have the same text and
  /// style — the 4050 grid has 40 distinct paragraphs for 2000 nodes); the
  /// engine owns the handle, nodes only borrow it.
  FjsSharedPainter? painter;
  double _keyMin = -1, _keyMax = -1;
  bool clips = false;
}

class _Item {
  _Item.node(this.node, this.flex, this.tight) : gap = 0;
  _Item.gap(this.gap) : node = null, flex = 0, tight = false;
  final FlatNode? node;
  final double gap;
  final int flex;
  final bool tight;
  double main = 0, cross = 0;
}

class FlatEngine {
  FlatNode? root;
  FjsTextEnvData? _env;
  final Map<int, FlatNode> byId = {};

  /// Why the last [pack] refused, for the gate's rejected-reason counter.
  String? rejectedReason;

  // Spec and painter caches. Keyed by FlatStyle identity (interned: shared by
  // every node with that style) and text, then by spec identity and the
  // incoming min/max width. Without them every text node builds its own span,
  // strut and cache key — measured as the largest item of the Dart engine's
  // mount, against 40 distinct paragraphs for 2000 nodes (specs/193 T015).
  final Map<FlatStyle, Map<String, FjsPlainTextSpec?>> _specs = {};
  final Map<FjsPlainTextSpec, Map<(double, double), FjsSharedPainter>> _painters = {};
  int _painterCount = 0;
  static const int _painterCap = 2048;

  void _dropPainters() {
    for (final m in _painters.values) {
      for (final h in m.values) {
        h.release();
      }
    }
    _painters.clear();
    _painterCount = 0;
    for (final n in byId.values) {
      n.painter = null;
      n._keyMin = n._keyMax = -1;
      if (n.isText) n.dirty = true;
    }
  }

  void dispose() {
    for (final m in _painters.values) {
      for (final h in m.values) {
        h.release();
      }
    }
    _painters.clear();
    _painterCount = 0;
    _specs.clear();
    byId.clear();
    root = null;
  }

  // ---- pack -------------------------------------------------------------------

  /// (Re)builds the node tree under [rootNode]. Returns false (and sets
  /// [rejectedReason]) when something under it is not flat-able — the gate
  /// normally filtered that already, this is the belt to its braces.
  bool pack(MirrorTree tree, MirrorNode rootNode, FjsTextEnvData env) {
    dispose();
    _env = env;
    rejectedReason = null;
    FlatNode? build(MirrorNode m, FlatNode? parent) {
      final v = flatVerdictOf(m);
      if (v.style == null) {
        rejectedReason = v.rejected;
        return null;
      }
      final isText = m.tag == 'text';
      final n = FlatNode(m, parent, v.style!, isText)..entry = m.style;
      byId[m.id] = n;
      if (isText) {
        n.text = m.text;
        if (!_refreshSpec(n)) {
          rejectedReason = 'text';
          return null;
        }
        return n;
      }
      for (final id in m.children) {
        final k = tree.node(id);
        if (k == null || FjsNodeRenderer.isHidden(k)) continue;
        final fk = build(k, n);
        if (fk == null) return null;
        n.kids.add(fk);
      }
      return n;
    }

    final r = build(rootNode, null);
    if (r == null) {
      dispose();
      return false;
    }
    root = r;
    return true;
  }

  bool _refreshSpec(FlatNode n) {
    final env = _env;
    if (env == null) return false;
    n.painter = null;
    n._keyMin = n._keyMax = -1;
    final byText = _specs[n.style] ??= {};
    final t = n.text ?? '';
    n.spec = byText.containsKey(t)
        ? byText[t]
        : (byText[t] = fjsPlainTextSpec(env, t, n.style.style));
    return n.spec != null;
  }

  /// A new text environment (scaler, ambient style…): every paragraph re-keys.
  /// Returns false if some text can no longer be flat-ed.
  bool setEnv(FjsTextEnvData env) {
    if (identical(env, _env)) return true;
    _env = env;
    _specs.clear();
    _dropPainters();
    for (final n in byId.values) {
      if (n.isText) {
        if (!_refreshSpec(n)) return false;
        markDirty(n);
      }
    }
    return true;
  }

  void markDirty(FlatNode n) {
    for (FlatNode? p = n; p != null; p = p.parent) {
      p.dirty = true;
    }
  }

  /// Applies a changed mirror node in place. Returns false when the change is
  /// structural (children differ) or the style left the supported subset — the
  /// caller re-packs, or lets the gate fall back.
  bool refresh(MirrorTree tree, MirrorNode m) {
    final n = byId[m.id];
    if (n == null) return false;
    if (!n.isText) {
      // children, as the pack would collect them
      var i = 0;
      for (final id in m.children) {
        final k = tree.node(id);
        if (k == null || FjsNodeRenderer.isHidden(k)) continue;
        if (i >= n.kids.length || n.kids[i].node.id != id) return false;
        i++;
      }
      if (i != n.kids.length) return false;
    }
    var changed = false;
    if (!identical(n.entry, m.style)) {
      final v = flatVerdictOf(m);
      if (v.style == null) {
        rejectedReason = v.rejected;
        return false;
      }
      n.style = v.style!;
      n.entry = m.style;
      changed = true;
      if (n.isText) {
        n.text = m.text;
        if (!_refreshSpec(n)) return false;
      }
    }
    if (n.isText && n.text != m.text) {
      n.text = m.text;
      if (!_refreshSpec(n)) return false;
      changed = true;
    }
    if (changed) markDirty(n);
    return true;
  }

  // ---- layout -------------------------------------------------------------------

  /// Lays the whole tree out under [c]. [rootShrinkToFit] answers
  /// `_shrinkToFit()` for the root's own flex, which only the real render
  /// tree above the surface can say.
  Size layoutRoot(BoxConstraints c, {required bool rootShrinkToFit}) {
    final r = root!;
    _rootShrink = rootShrinkToFit;
    final s = _layout(r, c);
    r.offset = Offset.zero;
    return s;
  }

  bool _rootShrink = false;

  Size _layout(FlatNode n, BoxConstraints c) {
    if (!n.dirty && n.lastC == c) return n.size;
    n.lastC = c;
    n.dirty = false;
    FlatStats.relaidNodes++;
    final st = n.style;
    final m = st.margin;
    final p = st.padding;

    // Padding(margin): child gets c.deflate(margin)
    final c1 = m == EdgeInsets.zero ? c : c.deflate(m);
    // ConstrainedBox(tightFor) — width/height are floored at padding (+border,
    // none here), decorateNode's border-box rule
    var cp = c1;
    if (st.hasSize) {
      var w = st.width, h = st.height;
      if (w != null && w < p.horizontal) w = p.horizontal;
      if (h != null && h < p.vertical) h = p.vertical;
      cp = BoxConstraints.tightFor(width: w, height: h).enforce(c1);
    }
    // Padding(padding): content gets cp.deflate(padding), the box is
    // cp.constrain(content + padding)
    final c3 = p == EdgeInsets.zero ? cp : cp.deflate(p);
    final Size content = n.isText ? _layoutText(n, c3) : _layoutFlex(n, c3);
    final padded = p == EdgeInsets.zero
        ? content
        : cp.constrain(Size(p.horizontal + content.width, p.vertical + content.height));
    n.borderSize = padded;
    // Padding(margin): size = c.constrain(margin + child)
    n.size = m == EdgeInsets.zero
        ? padded
        : c.constrain(Size(m.horizontal + padded.width, m.vertical + padded.height));

    var b = Offset.zero & n.size;
    final ox = m.left + p.left, oy = m.top + p.top;
    for (final k in n.kids) {
      b = b.expandToInclude(k.bounds.shift(Offset(ox, oy) + k.offset));
    }
    n.bounds = b;
    return n.size;
  }

  Size _layoutText(FlatNode n, BoxConstraints c) {
    final spec = n.spec!;
    // RenderFjsParagraph.performLayout: shared painter keyed by the incoming
    // min / max width, size = constrain(painter.size)
    if (n.painter == null || n._keyMin != c.minWidth || n._keyMax != c.maxWidth) {
      if (_painterCount >= _painterCap) _dropPainters();
      final byWidth = _painters[spec] ??= {};
      n.painter = byWidth[(c.minWidth, c.maxWidth)] ??= () {
        _painterCount++;
        return fjsAcquirePlainPainter(
          text: spec.span,
          textAlign: spec.textAlign,
          textDirection: spec.textDirection,
          softWrap: spec.softWrap,
          overflow: spec.overflow,
          textScaler: spec.textScaler,
          maxLines: spec.maxLines,
          locale: spec.locale,
          strutStyle: spec.strutStyle,
          textWidthBasis: spec.textWidthBasis,
          textHeightBehavior: spec.textHeightBehavior,
          minWidth: c.minWidth,
          maxWidth: c.maxWidth,
        );
      }();
      n._keyMin = c.minWidth;
      n._keyMax = c.maxWidth;
    }
    final painter = n.painter!.painter;
    final textSize = painter.size;
    final size = c.constrain(textSize);
    n.clips =
        spec.overflow != TextOverflow.visible &&
        (size.width < textSize.width ||
            size.height < textSize.height ||
            painter.didExceedMaxLines);
    return size;
  }

  /// Whether this node's flex lays out in two passes because its flex parent
  /// marked it shrink-to-fit (FjsShrinkStretchFlex._shrinkToFit): the marker is
  /// active when the parent does not stretch this item and the item has no
  /// cross-axis size of its own.
  bool _shrinkToFit(FlatNode n) {
    final p = n.parent;
    if (p == null) return _rootShrink;
    final pst = p.style;
    final crossLength = pst.row ? n.style.height : n.style.width;
    if (crossLength != null) return false;
    return _effectiveAlign(p, p.flexC) != FlatAlign.stretch;
  }

  /// The alignment [n]'s flex runs with: its declared one, except a stretching
  /// column under an unbounded width starts (flex.dart: LayoutBuilder's
  /// `effectiveCrossAlignment`, FjsShrinkStretchFlex.startsNow).
  FlatAlign _effectiveAlign(FlatNode n, BoxConstraints? c) {
    final st = n.style;
    if (st.align == FlatAlign.stretch && !st.row && c != null && !c.hasBoundedWidth) {
      return FlatAlign.start;
    }
    return st.align;
  }

  Size _layoutFlex(FlatNode n, BoxConstraints c) {
    final st = n.style;
    n.flexC = c;
    final row = st.row;
    final crossBounded = row ? c.hasBoundedHeight : c.hasBoundedWidth;
    final effective = _effectiveAlign(n, c);
    final measureCross = st.align == FlatAlign.stretch && row && !crossBounded;
    final crossTight = row ? c.hasTightHeight : c.hasTightWidth;

    final items = <_Item>[];
    final maxMain = row ? c.maxWidth : c.maxHeight;
    var i = 0;
    for (final k in n.kids) {
      if (st.gap != null && i > 0) items.add(_Item.gap(st.gap!));
      final g = k.style.grow;
      items.add(
        _Item.node(k, g > 0 ? g.round().clamp(1, 9999) : 0, maxMain.isFinite),
      );
      i++;
    }

    if (effective != FlatAlign.stretch ||
        crossTight ||
        !(measureCross || (crossBounded && _shrinkToFit(n)))) {
      return _flexPass(n, c, items, effective);
    }
    // two passes (FjsShrinkStretchFlex.performLayout): measure with `center`,
    // then stretch with the cross axis tight at what the measuring pass found
    final measured = _flexPass(n, c, items, FlatAlign.center);
    final cross = row ? measured.height : measured.width;
    final tight = row
        ? c.copyWith(minHeight: cross, maxHeight: cross)
        : c.copyWith(minWidth: cross, maxWidth: cross);
    return _flexPass(n, tight, items, FlatAlign.stretch);
  }

  /// RenderFlex.performLayout (mainAxisSize.min, ltr, vertical down).
  Size _flexPass(FlatNode n, BoxConstraints c, List<_Item> items, FlatAlign align) {
    final st = n.style;
    final row = st.row;
    final maxMain = row ? c.maxWidth : c.maxHeight;
    final maxCross = row ? c.maxHeight : c.maxWidth;
    final canFlex = maxMain < double.infinity;
    final stretch = align == FlatAlign.stretch;

    double mainOf(Size s) => row ? s.width : s.height;
    double crossOf(Size s) => row ? s.height : s.width;

    var crossSize = 0.0, allocated = 0.0, totalFlex = 0.0;
    _Item? lastFlex;
    for (final it in items) {
      if (it.flex > 0) {
        totalFlex += it.flex;
        lastFlex = it;
        continue;
      }
      final BoxConstraints ic = stretch
          ? (row
                ? BoxConstraints.tightFor(height: maxCross)
                : BoxConstraints.tightFor(width: maxCross))
          : (row
                ? BoxConstraints(maxHeight: maxCross)
                : BoxConstraints(maxWidth: maxCross));
      final Size s = it.node != null
          ? _layout(it.node!, ic)
          : (row
                ? BoxConstraints.tightFor(width: it.gap)
                : BoxConstraints.tightFor(height: it.gap)).enforce(ic).constrain(Size.zero);
      it.main = mainOf(s);
      it.cross = crossOf(s);
      allocated += it.main;
      crossSize = math.max(crossSize, it.cross);
    }
    final freeSpace = math.max(0.0, (canFlex ? maxMain : 0.0) - allocated);
    var allocatedFlex = 0.0;
    if (totalFlex > 0) {
      final spacePerFlex = freeSpace / totalFlex;
      for (final it in items) {
        if (it.flex <= 0) continue;
        final maxExtent = canFlex
            ? (identical(it, lastFlex) ? freeSpace - allocatedFlex : spacePerFlex * it.flex)
            : double.infinity;
        final minExtent = it.tight ? maxExtent : 0.0;
        final BoxConstraints ic = stretch
            ? (row
                  ? BoxConstraints(minWidth: minExtent, maxWidth: maxExtent, minHeight: maxCross, maxHeight: maxCross)
                  : BoxConstraints(minWidth: maxCross, maxWidth: maxCross, minHeight: minExtent, maxHeight: maxExtent))
            : (row
                  ? BoxConstraints(minWidth: minExtent, maxWidth: maxExtent, maxHeight: maxCross)
                  : BoxConstraints(maxWidth: maxCross, minHeight: minExtent, maxHeight: maxExtent));
        final s = _layout(it.node!, ic);
        it.main = mainOf(s);
        it.cross = crossOf(s);
        allocated += it.main;
        allocatedFlex += maxExtent;
        crossSize = math.max(crossSize, it.cross);
      }
    }
    final Size size = c.constrain(row ? Size(allocated, crossSize) : Size(crossSize, allocated));
    final actualMain = row ? size.width : size.height;
    final actualCross = row ? size.height : size.width;
    final remaining = math.max(0.0, actualMain - allocated);
    final count = items.length;
    double leading = 0, between = 0;
    switch (st.justify) {
      case FlatJustify.start:
        break;
      case FlatJustify.end:
        leading = remaining;
      case FlatJustify.center:
        leading = remaining / 2;
      case FlatJustify.between:
        if (count > 1) between = remaining / (count - 1);
      case FlatJustify.around:
        if (count > 0) {
          between = remaining / count;
          leading = between / 2;
        }
      case FlatJustify.evenly:
        if (count > 0) {
          between = remaining / (count + 1);
          leading = between;
        }
    }
    var pos = leading;
    for (final it in items) {
      final k = it.node;
      if (k != null) {
        final crossPos = switch (align) {
          FlatAlign.start || FlatAlign.stretch => 0.0,
          FlatAlign.end => actualCross - it.cross,
          FlatAlign.center => (actualCross - it.cross) / 2.0,
        };
        k.offset = row ? Offset(pos, crossPos) : Offset(crossPos, pos);
      }
      pos += it.main + between;
    }
    return size;
  }

  // ---- geometry -------------------------------------------------------------------

  /// [n]'s outer (margin-box) rect in the surface's coordinates.
  Rect rectOf(FlatNode n) {
    var o = Offset.zero;
    for (FlatNode? x = n; x != null; x = x.parent) {
      o += x.offset;
      final p = x.parent;
      if (p != null) {
        o += Offset(p.style.margin.left + p.style.padding.left, p.style.margin.top + p.style.padding.top);
      }
    }
    return o & n.size;
  }

  // ---- paint ------------------------------------------------------------------------

  final Paint _paint = Paint();

  /// Paints the tree with its origin at [origin]; subtrees whose bounds miss
  /// [visible] (surface coordinates; null = everything) are skipped.
  void paint(Canvas canvas, Offset origin, Rect? visible) {
    final r = root;
    if (r == null) return;
    _paintNode(canvas, r, origin, visible);
  }

  void _paintNode(Canvas canvas, FlatNode n, Offset at, Rect? visible) {
    if (visible != null && !n.bounds.shift(at).overlaps(visible)) return;
    FlatStats.paintedNodes++;
    final st = n.style;
    final m = st.margin, p = st.padding;
    final boxAt = at + Offset(m.left, m.top);
    final bg = st.background;
    if (bg != null || st.radius != null) {
      // BoxDecoration (color + borderRadius, no border / shadow / gradient)
      final rect = boxAt & n.borderSize;
      if (bg != null) {
        _paint.color = bg;
        final rad = st.radius;
        if (rad == null || rad == BorderRadius.zero) {
          canvas.drawRect(rect, _paint);
        } else {
          canvas.drawRRect(rad.toRRect(rect), _paint);
        }
      }
    }
    final contentAt = boxAt + Offset(p.left, p.top);
    if (n.isText) {
      final painter = n.painter?.painter;
      if (painter != null) {
        if (n.clips) {
          canvas
            ..save()
            ..clipRect(contentAt & painter.size);
          painter.paint(canvas, contentAt);
          canvas.restore();
        } else {
          painter.paint(canvas, contentAt);
        }
      }
      return;
    }
    for (final k in n.kids) {
      _paintNode(canvas, k, contentAt + k.offset, visible);
    }
  }
}
