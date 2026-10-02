// specs/190: plain paragraphs that share their laid-out TextPainter.
//
// A RenderParagraph owns a TextPainter, and laying one out builds a native
// ui.Paragraph (SkParagraph shaping) — the single largest item in the 4050
// grid's mount frame on an iPhone (~25 ms of ~90), with the paragraphs'
// native disposal another ~12 ms of the unmount. Yet the grid has 2000
// paragraphs and FORTY distinct ones ("0".."39", one style, one width).
// Pages are like that in general: list rows repeat their labels, units,
// button captions, badges.
//
// A laid-out TextPainter is immutable for as long as nobody re-lays it out,
// and painting one at many offsets is what it is built for. So the painter
// is keyed by everything that decides its layout — the span (text + style),
// the paragraph settings, and the min / max width it is laid out at — and
// every render object with the same key paints the same one. Refcounted;
// unreferenced painters linger in a small LRU so a page that unmounts and
// mounts again (the 4050 screen's hide → show, a tab revisited) re-shapes
// nothing.
//
// Only the plain case comes here (widgets/text.dart decides): one run of
// text, no inline widgets, no recognizers, no selection, no fade. The class
// is still a RenderParagraph — whatever reads one (tests, geometry) keeps
// working, and the rarely used queries that are not overridden here (caret,
// selection boxes) fall back to the inherited private painter, laid out on
// demand.
import 'dart:collection';

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// Bypasses the shared painters (each paragraph shapes its own, as a plain
/// RichText does). Only the benchmark uses it.
@visibleForTesting
bool fjsDisableParagraphCache = false;

/// A [RichText] whose render object lays out through the shared painters.
/// Still a RichText, so `find.text` and the like see it.
class FjsPlainText extends RichText {
  FjsPlainText({
    super.key,
    required super.text,
    super.textAlign,
    super.textDirection,
    super.softWrap,
    super.overflow,
    super.textScaler,
    super.maxLines,
    super.locale,
    super.strutStyle,
    super.textWidthBasis,
    super.textHeightBehavior,
  });

  @override
  RenderParagraph createRenderObject(BuildContext context) =>
      RenderFjsParagraph(
        text,
        textAlign: textAlign,
        textDirection: textDirection ?? Directionality.of(context),
        softWrap: softWrap,
        overflow: overflow,
        textScaler: textScaler,
        maxLines: maxLines,
        strutStyle: strutStyle,
        textWidthBasis: textWidthBasis,
        textHeightBehavior: textHeightBehavior,
        locale: locale,
      );
}

class RenderFjsParagraph extends RenderParagraph {
  RenderFjsParagraph(
    super.text, {
    super.textAlign,
    required super.textDirection,
    super.softWrap,
    super.overflow,
    super.textScaler,
    super.maxLines,
    super.locale,
    super.strutStyle,
    super.textWidthBasis,
    super.textHeightBehavior,
  });

  // RenderParagraph treats a span change that only repaints (a colour, a
  // decoration) as paint-only and lets its own painter pick it up at paint.
  // The shared painter is keyed by the whole span and only swapped in
  // performLayout, so such a change must relayout here — otherwise the old
  // colour keeps painting (specs/191: the mode tabs' white-on-blue label
  // stayed white after the tab turned white).
  @override
  set text(InlineSpan value) {
    final changed = text.compareTo(value) != RenderComparison.identical;
    super.text = value;
    if (changed) markNeedsLayout();
  }

  // the same for an alignment change: paint-only there, part of the key here
  @override
  set textAlign(TextAlign value) {
    if (value == textAlign) return;
    super.textAlign = value;
    markNeedsLayout();
  }

  /// The span the shared painter actually paints — what a test reads to
  /// see a style change land.
  @visibleForTesting
  InlineSpan? get debugPaintedSpan => _shared?.painter.text;

  /// The painter this paragraph laid out with and paints.
  _Shared? _shared;
  bool _clips = false;

  double _maxWidthFor(double maxWidth) =>
      softWrap || overflow == TextOverflow.ellipsis ? maxWidth : double.infinity;

  _Key _keyAt(double minWidth, double maxWidth) => _Key(
    text,
    textAlign,
    textDirection,
    maxLines,
    overflow == TextOverflow.ellipsis,
    textScaler,
    locale,
    strutStyle,
    textWidthBasis,
    textHeightBehavior,
    minWidth,
    maxWidth,
  );

  /// A painter laid out at [minWidth] / [maxWidth] — shared, not retained.
  TextPainter _peek(double minWidth, double maxWidth) =>
      _paragraphCache.peek(_keyAt(minWidth, maxWidth));

  @override
  double computeMinIntrinsicWidth(double height) =>
      _peek(0, double.infinity).minIntrinsicWidth;

  @override
  double computeMaxIntrinsicWidth(double height) =>
      _peek(0, double.infinity).maxIntrinsicWidth;

  @override
  double computeMinIntrinsicHeight(double width) =>
      _peek(width, _maxWidthFor(width)).height;

  @override
  double computeMaxIntrinsicHeight(double width) =>
      _peek(width, _maxWidthFor(width)).height;

  @override
  Size computeDryLayout(covariant BoxConstraints constraints) =>
      constraints.constrain(
        _peek(constraints.minWidth, _maxWidthFor(constraints.maxWidth)).size,
      );

  @override
  double computeDryBaseline(
    covariant BoxConstraints constraints,
    TextBaseline baseline,
  ) => _peek(
    constraints.minWidth,
    _maxWidthFor(constraints.maxWidth),
  ).computeDistanceToActualBaseline(TextBaseline.alphabetic);

  @override
  double computeDistanceToActualBaseline(TextBaseline baseline) =>
      _shared!.painter.computeDistanceToActualBaseline(TextBaseline.alphabetic);

  @override
  void performLayout() {
    final c = constraints;
    final key = _keyAt(c.minWidth, _maxWidthFor(c.maxWidth));
    final old = _shared;
    if (old == null || old.key != key) {
      _shared = _paragraphCache.acquire(key);
      if (old != null) _paragraphCache.release(old);
    }
    final painter = _shared!.painter;
    final textSize = painter.size;
    size = c.constrain(textSize);
    // RenderParagraph's overflow rule, minus fade (never routed here)
    _clips =
        overflow != TextOverflow.visible &&
        (size.width < textSize.width ||
            size.height < textSize.height ||
            painter.didExceedMaxLines);
  }

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      false; // a plain run has no span recognizers and no inline children

  @override
  void paint(PaintingContext context, Offset offset) {
    final shared = _shared;
    if (shared == null) return;
    final canvas = context.canvas;
    if (_clips) {
      canvas
        ..save()
        ..clipRect(offset & size);
    }
    shared.painter.paint(canvas, offset);
    if (_clips) canvas.restore();
  }

  @override
  void systemFontsDidChange() {
    super.systemFontsDidChange();
    _paragraphCache.clear();
    final old = _shared;
    _shared = null;
    if (old != null) _paragraphCache.release(old);
    markNeedsLayout();
  }

  @override
  void dispose() {
    final old = _shared;
    _shared = null;
    if (old != null) _paragraphCache.release(old);
    super.dispose();
  }
}

/// Everything a TextPainter's layout depends on. TextSpan equality is deep
/// (text + style), so equal paragraphs from different nodes meet here.
@immutable
class _Key {
  const _Key(
    this.text,
    this.textAlign,
    this.textDirection,
    this.maxLines,
    this.ellipsis,
    this.textScaler,
    this.locale,
    this.strutStyle,
    this.textWidthBasis,
    this.textHeightBehavior,
    this.minWidth,
    this.maxWidth,
  );

  final InlineSpan text;
  final TextAlign textAlign;
  final TextDirection textDirection;
  final int? maxLines;
  final bool ellipsis;
  final TextScaler textScaler;
  final Locale? locale;
  final StrutStyle? strutStyle;
  final TextWidthBasis textWidthBasis;
  final TextHeightBehavior? textHeightBehavior;
  final double minWidth;
  final double maxWidth;

  @override
  bool operator ==(Object other) =>
      other is _Key &&
      other.minWidth == minWidth &&
      other.maxWidth == maxWidth &&
      other.textAlign == textAlign &&
      other.textDirection == textDirection &&
      other.maxLines == maxLines &&
      other.ellipsis == ellipsis &&
      other.textScaler == textScaler &&
      other.locale == locale &&
      other.strutStyle == strutStyle &&
      other.textWidthBasis == textWidthBasis &&
      other.textHeightBehavior == textHeightBehavior &&
      other.text == text;

  @override
  int get hashCode => Object.hash(
    text,
    textAlign,
    textDirection,
    maxLines,
    ellipsis,
    textScaler,
    locale,
    strutStyle,
    textWidthBasis,
    textHeightBehavior,
    minWidth,
    maxWidth,
  );

  TextPainter layOut() => TextPainter(
    text: text,
    textAlign: textAlign,
    textDirection: textDirection,
    textScaler: textScaler,
    maxLines: maxLines,
    ellipsis: ellipsis ? '…' : null,
    locale: locale,
    strutStyle: strutStyle,
    textWidthBasis: textWidthBasis,
    textHeightBehavior: textHeightBehavior,
  )..layout(minWidth: minWidth, maxWidth: maxWidth);
}

class _Shared {
  _Shared(this.key, this.painter);

  final _Key key;
  final TextPainter painter;
  int refs = 0;
}

final _paragraphCache = _ParagraphCache();

class _ParagraphCache {
  /// Unreferenced painters kept for a remount. Bounded: each holds a native
  /// paragraph.
  static const _idleLimit = 1024;

  final _live = <_Key, _Shared>{};

  /// Insertion order is recency: release appends, reuse removes.
  final _idle = LinkedHashMap<_Key, _Shared>();

  _Shared _lookup(_Key key) {
    if (fjsDisableParagraphCache) return _Shared(key, key.layOut());
    final live = _live[key];
    if (live != null) return live;
    final idle = _idle.remove(key);
    if (idle != null) return _live[key] = idle;
    return _live[key] = _Shared(key, key.layOut());
  }

  _Shared acquire(_Key key) {
    final shared = _lookup(key);
    shared.refs++;
    return shared;
  }

  void release(_Shared shared) {
    if (--shared.refs > 0) return;
    if (fjsDisableParagraphCache) {
      shared.painter.dispose();
      return;
    }
    if (!identical(_live[shared.key], shared)) {
      // cleared while held (system fonts changed): nobody else has it
      shared.painter.dispose();
      return;
    }
    _live.remove(shared.key);
    _idle[shared.key] = shared;
    if (_idle.length > _idleLimit) {
      final oldest = _idle.keys.first;
      _idle.remove(oldest)!.painter.dispose();
    }
  }

  /// A painter for an intrinsic / dry query: lives in the idle set (so the
  /// layout that usually follows at the same width reuses it) unless some
  /// paragraph already holds it.
  TextPainter peek(_Key key) {
    final live = _live[key];
    if (live != null) return live.painter;
    var idle = _idle.remove(key);
    if (idle == null) {
      idle = _Shared(key, key.layOut());
      if (fjsDisableParagraphCache) {
        // not retained: the caller reads it right away
        final painter = idle.painter;
        scheduleDispose(painter);
        return painter;
      }
    }
    _idle[key] = idle;
    if (_idle.length > _idleLimit) {
      final oldest = _idle.keys.first;
      _idle.remove(oldest)!.painter.dispose();
    }
    return idle.painter;
  }

  void scheduleDispose(TextPainter painter) {
    WidgetsBinding.instance.addPostFrameCallback((_) => painter.dispose());
  }

  void clear() {
    for (final s in _idle.values) {
      s.painter.dispose();
    }
    _idle.clear();
    // live ones are disposed by their last holder (release sees them gone)
    _live.clear();
  }
}
