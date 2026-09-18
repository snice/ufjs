// Dashed / dotted borders. Flutter's [Border] only strokes solid, so a
// `border: 1px dashed #ccc` is painted here instead: the same rounded box
// the decoration would have drawn, walked with PathMetrics and stroked in
// pieces.
//
// CSS does not define the dash lengths (every browser picks its own), so
// these are chosen to read like Chrome's at the widths a phone UI uses:
// dashes and gaps three times the border width, dots one width across with
// two between.
import 'dart:math' as math;
import 'dart:ui' show PointMode;

import 'package:flutter/material.dart';

import 'style.dart';
import 'style_parse.dart' show FjsBorderStyle;

/// Strokes `path` in dashed / dotted pieces; a solid [kind] is the caller's
/// to draw directly (one full stroke).
void strokeDashes(
  Canvas canvas,
  Path path, {
  required double width,
  required Color color,
  required FjsBorderStyle kind,
}) {
  final paint = Paint()
    ..color = color
    ..strokeWidth = width
    ..strokeCap = StrokeCap.round
    ..style = PaintingStyle.stroke;

  if (kind == FjsBorderStyle.dotted) {
    final dots = <Offset>[];
    for (final metric in path.computeMetrics()) {
      for (var d = 0.0; d < metric.length; d += width * 3) {
        final tangent = metric.getTangentForOffset(d);
        if (tangent != null) dots.add(tangent.position);
      }
    }
    canvas.drawPoints(PointMode.points, dots, paint);
    return;
  }

  paint.strokeCap = StrokeCap.butt;
  final dash = width * 3;
  final gap = width * 3;
  for (final metric in path.computeMetrics()) {
    var start = 0.0;
    while (start < metric.length) {
      final end = math.min(start + dash, metric.length);
      canvas.drawPath(metric.extractPath(start, end), paint);
      start = end + gap;
    }
  }
}

class FjsDashedBorderPainter extends CustomPainter {
  const FjsDashedBorderPainter({
    required this.width,
    required this.color,
    required this.kind,
    this.borderRadius,
  });

  final double width;
  final Color color;
  final FjsBorderStyle kind;
  final BorderRadius? borderRadius;

  @override
  void paint(Canvas canvas, Size size) {
    if (width <= 0 || size.isEmpty) return;
    // the stroke straddles the path, so walk the box inset by half a width
    // — same footprint a solid Border of this width would paint
    final rect = (Offset.zero & size).deflate(width / 2);
    if (rect.width <= 0 || rect.height <= 0) return;
    final path = Path();
    if (borderRadius != null) {
      path.addRRect(
        borderRadius!.toRRect(Offset.zero & size).deflate(width / 2),
      );
    } else {
      path.addRect(rect);
    }
    strokeDashes(canvas, path, width: width, color: color, kind: kind);
  }

  @override
  bool shouldRepaint(FjsDashedBorderPainter old) =>
      old.width != width ||
      old.color != color ||
      old.kind != kind ||
      old.borderRadius != borderRadius;
}

/// Which side of the box a stroke path runs along.
enum FjsBoxSidePosition { top, right, bottom, left }

/// One side's stroke path: the straight edge between the corner radii plus
/// HALF of each adjacent corner arc. CSS gives a side its corners up to the
/// arc midpoint and the neighbouring side the rest, so two adjacent sides of
/// the same color join seamlessly, and an absent neighbour leaves the corner
/// half bare — both as browsers do.
///
/// `rect` is expected inset by half of each side's own stroke width (the
/// stroke straddles the path). Corner radii are taken as declared; per-side
/// widths usually differ by a pixel or two, and re-fitting the arcs to the
/// inset corners is accuracy nobody can see at hairline widths.
Path fjsBorderSidePath(
  FjsBoxSidePosition which,
  Rect rect,
  BorderRadius? radius,
) {
  double clampRadius(double r, double alongEdge, double acrossEdge) =>
      math.min(r, math.min(alongEdge, acrossEdge) / 2);
  final tl = clampRadius(radius?.topLeft.x ?? 0, rect.width, rect.height);
  final tr = clampRadius(radius?.topRight.x ?? 0, rect.width, rect.height);
  final br = clampRadius(radius?.bottomRight.x ?? 0, rect.width, rect.height);
  final bl = clampRadius(radius?.bottomLeft.x ?? 0, rect.width, rect.height);
  Rect corner(double x, double y, double r) =>
      Rect.fromCircle(center: Offset(x, y), radius: r);
  const q = math.pi / 4;
  final p = Path();
  switch (which) {
    case FjsBoxSidePosition.top:
      tl > 0
          ? p.arcTo(corner(rect.left + tl, rect.top + tl, tl), 5 * q, q, false)
          : p.moveTo(rect.left, rect.top);
      p.lineTo(rect.right - tr, rect.top);
      if (tr > 0)
        p.arcTo(corner(rect.right - tr, rect.top + tr, tr), 6 * q, q, false);
    case FjsBoxSidePosition.right:
      tr > 0
          ? p.arcTo(corner(rect.right - tr, rect.top + tr, tr), 7 * q, q, false)
          : p.moveTo(rect.right, rect.top);
      p.lineTo(rect.right, rect.bottom - br);
      if (br > 0)
        p.arcTo(corner(rect.right - br, rect.bottom - br, br), 0, q, false);
    case FjsBoxSidePosition.bottom:
      br > 0
          ? p.arcTo(corner(rect.right - br, rect.bottom - br, br), q, q, false)
          : p.moveTo(rect.right, rect.bottom);
      p.lineTo(rect.left + bl, rect.bottom);
      if (bl > 0)
        p.arcTo(corner(rect.left + bl, rect.bottom - bl, bl), 2 * q, q, false);
    case FjsBoxSidePosition.left:
      bl > 0
          ? p.arcTo(
              corner(rect.left + bl, rect.bottom - bl, bl),
              3 * q,
              q,
              false,
            )
          : p.moveTo(rect.left, rect.bottom);
      p.lineTo(rect.left, rect.top + tl);
      if (tl > 0)
        p.arcTo(corner(rect.left + tl, rect.top + tl, tl), 4 * q, q, false);
  }
  return p;
}

/// Paints [FjsBoxBorders] whose sides are not one uniform solid stroke —
/// mixed sides (a lone `border-bottom`), per-side widths, or dashed / dotted
/// sides. Each present side is stroked on its own path; see [_sidePath] for
/// the corner ownership.
class FjsSideBorderPainter extends CustomPainter {
  const FjsSideBorderPainter({required this.borders, this.borderRadius});

  final FjsBoxBorders borders;
  final BorderRadius? borderRadius;

  @override
  void paint(Canvas canvas, Size size) {
    if (borders.isNone || size.isEmpty) return;
    // inset each edge by half of ITS width, so the stroke stays inside the
    // box the way a BorderSide does
    final rect = Rect.fromLTRB(
      (borders.left?.width ?? 0) / 2,
      (borders.top?.width ?? 0) / 2,
      size.width - (borders.right?.width ?? 0) / 2,
      size.height - (borders.bottom?.width ?? 0) / 2,
    );
    if (rect.width <= 0 || rect.height <= 0) return;
    void stroke(FjsBorderSide? side, FjsBoxSidePosition which) {
      if (side == null || side.width <= 0) return;
      final path = fjsBorderSidePath(which, rect, borderRadius);
      if (side.kind == FjsBorderStyle.solid) {
        canvas.drawPath(
          path,
          Paint()
            ..color = side.color
            ..strokeWidth = side.width
            ..style = PaintingStyle.stroke,
        );
      } else {
        strokeDashes(
          canvas,
          path,
          width: side.width,
          color: side.color,
          kind: side.kind,
        );
      }
    }

    stroke(borders.top, FjsBoxSidePosition.top);
    stroke(borders.right, FjsBoxSidePosition.right);
    stroke(borders.bottom, FjsBoxSidePosition.bottom);
    stroke(borders.left, FjsBoxSidePosition.left);
  }

  @override
  bool shouldRepaint(FjsSideBorderPainter old) =>
      old.borders != borders || old.borderRadius != borderRadius;
}
