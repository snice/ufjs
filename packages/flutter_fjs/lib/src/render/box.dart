// specs/191: a node's background box, and its margin, as ONE render object.
//
// decorateNode used to stack `Padding(margin) → DecoratedBox(background)`
// for every decorated node with a margin — the 4050 grid's cell, a card in
// a list. Two Elements and two RenderObjects per node, 4000 + 4000 on that
// grid, allocated at mount, promoted, collected at unmount. And
// DecoratedBox.createRenderObject resolves an ImageConfiguration from the
// context (createLocalImageConfiguration): four inherited dependencies —
// the asset bundle, the device pixel ratio, the locale, the text direction —
// registered per node and unregistered again at unmount. Only a background
// IMAGE reads that configuration.
//
// [FjsBox] is still a DecoratedBox (and its render object a
// RenderDecoratedBox), so whatever looks for one — tests, the geometry
// module — keeps finding it. What differs:
//
//  * an optional [margin] laid out the way RenderPadding does it: the child
//    sits inside the margin, the box paints and hit-tests the inner rect
//    only, exactly what the Padding above a DecoratedBox did;
//  * a decoration without images (the common BoxDecoration: colour,
//    gradient, border, radius, shadow) takes a configuration that carries
//    only the text direction, read WITHOUT a dependency. One with an image
//    resolves the full configuration, dependencies and all, as before.
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

class FjsBox extends DecoratedBox {
  const FjsBox({
    super.key,
    required super.decoration,
    this.margin = EdgeInsets.zero,
    super.child,
  });

  final EdgeInsets margin;

  /// Whether painting can need more than the text direction.
  bool get _needsImages {
    final d = decoration;
    return d is! BoxDecoration || d.image != null;
  }

  ImageConfiguration _configuration(BuildContext context) => _needsImages
      ? createLocalImageConfiguration(context)
      : ImageConfiguration(
          textDirection: context
              .getInheritedWidgetOfExactType<Directionality>()
              ?.textDirection,
        );

  @override
  RenderDecoratedBox createRenderObject(BuildContext context) => RenderFjsBox(
    decoration: decoration,
    margin: margin,
    configuration: _configuration(context),
  );

  @override
  void updateRenderObject(
    BuildContext context,
    covariant RenderFjsBox renderObject,
  ) {
    renderObject
      ..decoration = decoration
      ..configuration = _configuration(context)
      ..margin = margin;
  }
}

/// A RenderDecoratedBox with a margin around it. With a zero margin it
/// behaves exactly as its superclass; the overrides below only add the
/// offset.
class RenderFjsBox extends RenderDecoratedBox {
  RenderFjsBox({
    required super.decoration,
    required EdgeInsets margin,
    super.configuration,
  }) : _margin = margin;

  EdgeInsets get margin => _margin;
  EdgeInsets _margin;
  set margin(EdgeInsets value) {
    if (value == _margin) return;
    _margin = value;
    markNeedsLayout();
  }

  bool get _hasMargin => _margin != EdgeInsets.zero;

  /// The decorated (border) box inside the margin, in local coordinates.
  Rect get _inner => Rect.fromLTWH(
    _margin.left,
    _margin.top,
    _max(0, size.width - _margin.horizontal),
    _max(0, size.height - _margin.vertical),
  );

  // ---- layout: RenderPadding's ---------------------------------------------

  @override
  double computeMinIntrinsicWidth(double height) {
    if (!_hasMargin) return super.computeMinIntrinsicWidth(height);
    final c = child;
    final inner = _max(0, height - _margin.vertical);
    return _margin.horizontal + (c == null ? 0 : c.getMinIntrinsicWidth(inner));
  }

  @override
  double computeMaxIntrinsicWidth(double height) {
    if (!_hasMargin) return super.computeMaxIntrinsicWidth(height);
    final c = child;
    final inner = _max(0, height - _margin.vertical);
    return _margin.horizontal + (c == null ? 0 : c.getMaxIntrinsicWidth(inner));
  }

  @override
  double computeMinIntrinsicHeight(double width) {
    if (!_hasMargin) return super.computeMinIntrinsicHeight(width);
    final c = child;
    final inner = _max(0, width - _margin.horizontal);
    return _margin.vertical + (c == null ? 0 : c.getMinIntrinsicHeight(inner));
  }

  @override
  double computeMaxIntrinsicHeight(double width) {
    if (!_hasMargin) return super.computeMaxIntrinsicHeight(width);
    final c = child;
    final inner = _max(0, width - _margin.horizontal);
    return _margin.vertical + (c == null ? 0 : c.getMaxIntrinsicHeight(inner));
  }

  @override
  Size computeDryLayout(covariant BoxConstraints constraints) {
    if (!_hasMargin) return super.computeDryLayout(constraints);
    final c = child;
    if (c == null) {
      return constraints.constrain(Size(_margin.horizontal, _margin.vertical));
    }
    final inner = c.getDryLayout(constraints.deflate(_margin));
    return constraints.constrain(
      Size(_margin.horizontal + inner.width, _margin.vertical + inner.height),
    );
  }

  @override
  double? computeDryBaseline(
    covariant BoxConstraints constraints,
    TextBaseline baseline,
  ) {
    if (!_hasMargin) return super.computeDryBaseline(constraints, baseline);
    final c = child;
    if (c == null) return null;
    final result = c.getDryBaseline(constraints.deflate(_margin), baseline);
    return result == null ? null : result + _margin.top;
  }

  @override
  double? computeDistanceToActualBaseline(TextBaseline baseline) {
    final c = child;
    if (c == null) return null;
    final result = c.getDistanceToActualBaseline(baseline);
    return result == null ? null : result + _margin.top;
  }

  @override
  void performLayout() {
    if (!_hasMargin) return super.performLayout();
    final c = child;
    if (c == null) {
      size = constraints.constrain(Size(_margin.horizontal, _margin.vertical));
      return;
    }
    c.layout(constraints.deflate(_margin), parentUsesSize: true);
    size = constraints.constrain(
      Size(_margin.horizontal + c.size.width, _margin.vertical + c.size.height),
    );
  }

  // ---- paint / hit test: the decoration on the inner rect ------------------

  @override
  void paint(PaintingContext context, Offset offset) {
    if (!_hasMargin) return super.paint(context, offset);
    // RenderDecoratedBox paints at [offset] across [size]: hand it the inner
    // rect by painting it as if this box were the inner one. Its paint also
    // paints the child at the same offset — the child sits at the inner
    // rect's origin, which is where it belongs.
    final inner = _inner;
    _withSize(inner.size, () => super.paint(context, offset + inner.topLeft));
  }

  @override
  bool hitTestSelf(Offset position) {
    if (!_hasMargin) return super.hitTestSelf(position);
    final inner = _inner;
    if (!inner.contains(position)) return false;
    return _withSize(
      inner.size,
      () => super.hitTestSelf(position - inner.topLeft),
    );
  }

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) {
    if (!_hasMargin) {
      return super.hitTestChildren(result, position: position);
    }
    final c = child;
    if (c == null) return false;
    final at = Offset(_margin.left, _margin.top);
    return result.addWithPaintOffset(
      offset: at,
      position: position,
      hitTest: (result, transformed) => c.hitTest(result, position: transformed),
    );
  }

  @override
  void applyPaintTransform(RenderObject child, Matrix4 transform) {
    if (_hasMargin) transform.translateByDouble(_margin.left, _margin.top, 0, 1);
    super.applyPaintTransform(child, transform);
  }

  @override
  Rect get paintBounds => Offset.zero & size;

  /// Runs [body] with [size] reading as [inner] — RenderDecoratedBox sizes
  /// its painting and hit area by `size`, and a margin is outside both.
  T _withSize<T>(Size inner, T Function() body) {
    _sizeOverride = inner;
    try {
      return body();
    } finally {
      _sizeOverride = null;
    }
  }

  Size? _sizeOverride;

  @override
  Size get size => _sizeOverride ?? super.size;
}

double _max(double a, double b) => a > b ? a : b;
