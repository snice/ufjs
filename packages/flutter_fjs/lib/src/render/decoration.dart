// The box every tag's content is wrapped in: padding, explicit size,
// background/border/shadow, clipping and margin — in the order CSS
// applies them.
import 'dart:async' show Timer;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import 'dashed_border.dart';
import 'length.dart';
import 'style.dart';
import 'style_parse.dart';
import '../widgets/control_scope.dart' show fjsWarnOnce;

/// Resolves a percentage border-radius against the box's own DEFINITE
/// width/height (`van-radio`'s `border-radius: 100%` circle). Null when any
/// corner carries a fraction but an axis is relative or content-sized —
/// relative sizes resolve in [_fractionRadiusIn] inside the size
/// LayoutBuilder (spec 079), and a content-sized axis keeps square corners
/// (css-compat.md). A relative length's `.px` is only its residual, not the
/// box, so relative axes never pass through here. Absolute px parts always
/// apply.
BorderRadius? _fractionRadius(FjsStyle style) {
  final parts = style.borderRadiusParts;
  if (parts == null || !parts.any((p) => p.fraction != 0)) return null;
  double? absPx(FjsLength? l) => l == null || l.isRelative ? null : l.px;
  final w = absPx(style.widthLength);
  final h = absPx(style.heightLength);
  if (w == null || h == null) return null;
  return _fractionRadiusIn(style, w, h);
}

/// The same resolution against a KNOWN painted size — the box the size
/// LayoutBuilder has just resolved (a declared `width: 50%` IS this many
/// pixels wide, so the corners come from the size the box really gets).
BorderRadius? _fractionRadiusIn(FjsStyle style, double width, double height) {
  final parts = style.borderRadiusParts!;
  Radius corner(BorderRadiusPart p) =>
      Radius.elliptical(p.px + p.fraction * width, p.px + p.fraction * height);
  return BorderRadius.only(
    topLeft: corner(parts[0]),
    topRight: corner(parts[1]),
    bottomRight: corner(parts[2]),
    bottomLeft: corner(parts[3]),
  );
}

/// A live track for [name] — `transition: …` declared AND longer than zero.
/// The gate every transition consumer uses: a 0s track still mounts its
/// wrapper (see _TransitionNode) but animates nothing, so the tween paths
/// skip it. `_normalizeTransitionProperty` camelized the names already
/// (`border-color` in CSS arrives as `borderColor`).
FjsTransitionTrack? _liveTrack(FjsStyle style, String name) {
  final track = style.transitions?.forProperty(name);
  return track != null && track.duration > Duration.zero ? track : null;
}

/// Applies [style]'s box properties to [content].
Widget decorateNode(
  FjsStyle style,
  Widget content, {
  EdgeInsets? defaultPadding,
  BorderRadius? defaultBorderRadius,

  /// Used when the style carries no background / border of its own — how a
  /// built-in tag states its default look (button's variants) without
  /// overriding what the page wrote.
  Color? defaultBackgroundColor,
  Color? defaultBorderColor,
  Decoration? foregroundDecoration,
  Key? foregroundKey,

  /// Per-node widget shape, not per-style: a press/hover-tracking node's
  /// decoration layer keeps the same wrapper whether or not the current
  /// state paints anything. Lived on [FjsStyle] until interned views were
  /// shared (specs/084); a `:active` background that comes and goes would
  /// otherwise remount the subtree (vant collapse arrow).
  bool keepsBox = false,
}) {
  Widget w = content;
  final padLengths = style.paddingLengths;
  final padTrack = _liveTrack(style, 'padding');
  if (padLengths != null && padLengths.hasRelative) {
    // A % padding references the containing block's WIDTH on every side
    // (CSS box model — `padding-top: 10%` is 10% of the width, not the
    // height). The reference is the constraint's incoming max width: the
    // parent's content box in normal flow, the flex container's width when
    // _flexChild passed its bound down, and unbounded inside a scroller —
    // where CSS resolves the percentage to 0 and so does resolveOrNull.
    w = LayoutBuilder(
      builder: (context, constraints) => _animatedEdges(
        padTrack,
        resolveEdgeLengths(
          padLengths,
          style.padding,
          defaultPadding,
          constraints.maxWidth,
        ),
        child: content,
      ),
    );
  } else {
    final padding = style.padding ?? defaultPadding;
    if (padding != null) w = _animatedEdges(padTrack, padding, child: w);
  }
  // The four sides, each through its own cascade; a built-in's default
  // hairline fills in only the sides the page said nothing about.
  final borders = style.boxBorders(defaultBorderColor: defaultBorderColor);
  final side = borders == null || borders.isNone ? null : borders;
  // A percentage radius references the box's own size. When the box's
  // width/height are definite (absolute px as authored) the corners resolve
  // right here — van-radio's circle, van-switch's knob. A content-sized box
  // with a percentage radius keeps square corners (css-compat.md); pulling
  // the size out of an arbitrary layout would need the whole decorated-box
  // build deferred behind a LayoutBuilder.
  var borderRadius =
      style.borderRadius ?? _fractionRadius(style) ?? defaultBorderRadius;
  // A % radius on a RELATIVE size (spec 079) resolves inside the size
  // LayoutBuilder below, against the size the box actually gets — a square
  // fallback would shrink a van-circle chip to a square. The side painters
  // sit OUTSIDE that builder, so the combo with a dashed or per-side stroke
  // keeps square corners and says so once (constitution V).
  var layoutRadius = false;
  if (style.borderRadiusParts?.any((p) => p.fraction != 0) == true &&
      (style.widthLength?.isRelative == true ||
          style.heightLength?.isRelative == true)) {
    if (side != null && (side.hasDashed || !side.isUniform)) {
      fjsWarnOnce(
        'fraction-radius-side-painter',
        'a % border-radius on a %/calc-sized box with a dashed or per-side '
        'border keeps square corners here',
      );
    } else {
      layoutRadius = true;
    }
  }
  final radiusPainted =
      (borderRadius != null && borderRadius != BorderRadius.zero) ||
      layoutRadius;
  // Which of the three painters a non-uniform set needs:
  //   uniform solid           -> Border.all, inside the BoxDecoration
  //   uniform dashed/dotted   -> FjsDashedBorderPainter (the long-standing path)
  //   mixed sides             -> without a radius Flutter's per-side [Border]
  //                              handles solid; with a radius, or whenever a
  //                              dashed side is in play, the side painter draws
  //                              it ([Border] only strokes solid, and a
  //                              non-uniform [Border] cannot meet a radius).
  final border = side == null
      ? null
      : side.isUniform && !side.hasDashed
      ? side.uniformBorder
      : !side.hasDashed && !radiusPainted
      ? Border(
          top: _borderSide(side.top),
          right: _borderSide(side.right),
          bottom: _borderSide(side.bottom),
          left: _borderSide(side.left),
        )
      : null;
  // A painted-over border reserves its own room — BoxDecoration.border does
  // that for the decoration case.
  final paintedOver = side != null && border == null;
  if (paintedOver) {
    w = Padding(
      padding: EdgeInsets.only(
        top: side.top?.width ?? 0,
        right: side.right?.width ?? 0,
        bottom: side.bottom?.width ?? 0,
        left: side.left?.width ?? 0,
      ),
      child: w,
    );
  }
  final background = style.backgroundColor ?? defaultBackgroundColor;
  final layers = style.backgroundLayers;
  // radiusPainted, not just hasDecoration: a %-only radius parses to null
  // in the absolute getter, and its corners resolve at layout (spec 079) —
  // the box must still take the decorated path or nothing paints them
  final decorated =
      layers != null ||
      keepsBox ||
      style.hasDecoration ||
      border != null ||
      background != null ||
      radiusPainted ||
      foregroundDecoration != null;
  // The sized/decorated box itself, given the pixels for this build. Pulled
  // out because a percentage size only becomes pixels inside a layout pass
  // (below); everything else about the box is the same either way.
  //
  // `transition: background-color …` / `border-color …` (or `all`, spec
  // 045): the decoration then animates through a TweenAnimationBuilder,
  // whose semantics are exactly the CSS transition's — the first frame takes
  // the value as-is, a changed target interpolates from wherever the
  // previous animation was. The builder stays in the tree whenever the
  // track is declared, not only while a background is set: vant's checkbox
  // goes from NO background to blue on check, and a builder that appears
  // together with its first color has nothing to animate from (the flip
  // snapped). BoxDecoration.lerp fades a missing color from transparent.
  // track.delay is NOT honored here: TweenAnimationBuilder has no delay hook
  // (transform/opacity keep their Timer-based delay in _TransitionNode); the
  // gap is registered in css-compat.md.
  //
  // track property names are camelized by _normalizeTransitionProperty
  // (`background-color` in CSS arrives as `backgroundColor`)
  FjsTransitionTrack? liveTrack(String name) => _liveTrack(style, name);

  final decorationTrack = style.gradient != null
      ? null
      : liveTrack('backgroundColor') ??
            (border is Border ? liveTrack('borderColor') : null);
  // declared track keeps the box even while it paints nothing yet
  final animatesDecoration = decorationTrack != null;
  // `box-sizing: content-box` (vant's tab nav: `height: 100%` plus a 15px
  // padding-bottom the underline sits in): width/height size the CONTENT,
  // the box adds its padding and border on top. fjs boxes are border-box
  // otherwise (css-compat.md). A % padding is left out of the sum.
  final contentBox = style.style['boxSizing'] == 'content-box';
  final EdgeInsets boxExtra = !contentBox
      ? EdgeInsets.zero
      : (style.padding ?? defaultPadding ?? EdgeInsets.zero) +
            EdgeInsets.only(
              top: side?.top?.width ?? 0,
              right: side?.right?.width ?? 0,
              bottom: side?.bottom?.width ?? 0,
              left: side?.left?.width ?? 0,
            );
  Widget sizedBox(
    Widget child,
    double? width,
    double? height, [
    BorderRadius? fractionRadius,
  ]) {
    if (contentBox) {
      if (width != null) width += boxExtra.horizontal;
      if (height != null) height += boxExtra.vertical;
    }
    // width/height (or `all`) tracks animate the resolved size the same way
    // (spec 045 追加). Size is a LAYOUT property: every animation frame
    // re-lays-out the subtree, which is exactly the cost a CSS width
    // transition has — gated by an explicit track so pages that don't ask
    // pay nothing. track.delay is not honored (same gap as background).
    final widthTrack = style.transitions?.forProperty('width');
    final heightTrack = style.transitions?.forProperty('height');
    final animatesWidth =
        width != null &&
        widthTrack != null &&
        widthTrack.duration > Duration.zero;
    final animatesHeight =
        height != null &&
        heightTrack != null &&
        heightTrack.duration > Duration.zero;
    Widget animateSize(Widget sized) {
      var out = sized;
      // a run that reaches its end is CSS's transitionend — vant's collapse
      // clears the fixed height on it (the renderer turns the notification
      // into the node's event, see [FjsSizeTransitionEnd])
      if (animatesHeight) {
        final inner = out;
        out = Builder(
          builder: (ctx) => TweenAnimationBuilder<double>(
            tween: Tween<double>(end: height),
            duration: heightTrack.duration,
            curve: heightTrack.curve,
            onEnd: () => const FjsSizeTransitionEnd().dispatch(ctx),
            builder: (_, h, inner) => SizedBox(height: h, child: inner),
            child: inner,
          ),
        );
      }
      if (animatesWidth) {
        final inner = out;
        out = Builder(
          builder: (ctx) => TweenAnimationBuilder<double>(
            tween: Tween<double>(end: width),
            duration: widthTrack.duration,
            curve: widthTrack.curve,
            onEnd: () => const FjsSizeTransitionEnd().dispatch(ctx),
            builder: (_, w, inner) => SizedBox(width: w, child: inner),
            child: inner,
          ),
        );
      }
      return out;
    }

    final decoration = BoxDecoration(
      color: background,
      gradient: style.gradient,
      // a % radius rides a relative size and resolves in the LayoutBuilder
      // that owns the box's width/height (spec 079)
      borderRadius: fractionRadius ?? borderRadius,
      border: border,
      boxShadow: style.boxShadows,
    );
    Widget buildBox(Decoration decoration, Widget? inner) {
      return Container(
        key: foregroundKey,
        // the animated axes move to the outer animated SizedBox — a tight
        // constraint the decorated box fills, so background/border track it
        width: animatesWidth ? null : width,
        height: animatesHeight ? null : height,
        decoration: decoration,
        foregroundDecoration: foregroundDecoration,
        // layered background images paint over the colour, under the
        // content, across the padding box — CSS's background-origin
        child: layers == null
            ? inner
            : DecoratedBox(
                decoration: _LayeredBackground(layers),
                child: inner ?? const SizedBox.expand(),
              ),
      );
    }

    if (decorated || animatesDecoration) {
      Widget out;
      if (!animatesDecoration) {
        out = buildBox(decoration, child);
      } else {
        out = TweenAnimationBuilder<Decoration>(
          tween: DecorationTween(end: decoration),
          duration: decorationTrack.duration,
          curve: decorationTrack.curve,
          builder: (_, value, inner) => buildBox(value, inner),
          child: child,
        );
      }
      return animateSize(out);
    }
    if (width != null || height != null) {
      // overflow: hidden with a fixed height (vant's collapse wrapper while
      // its height runs 0 → content): the content keeps its own height and
      // is clipped, as in CSS — squeezed into the box, a flex column paints
      // the overflow stripes instead
      // only while the height is a transition target: an overflow-hidden
      // box of FIXED height keeps bounding its content, so a child's
      // `height: 100%` still resolves against it (vant's tabs wrap → nav)
      final content = style.overflowHidden && height != null && animatesHeight
          ? OverflowBox(
              maxHeight: double.infinity,
              alignment: Alignment.topCenter,
              child: child,
            )
          : child;
      return animateSize(
        SizedBox(width: width, height: height, child: content),
      );
    }
    return child;
  }

  // A content-box size is the box's own: when padding pushes it past what
  // the parent offers (vant's nav: 100% of a 44px wrap + 15px padding), CSS
  // keeps it and lets it overflow — Flutter would clamp it back to 44.
  Widget box(
    Widget child,
    double? width,
    double? height, [
    BorderRadius? fractionRadius,
  ]) {
    final out = sizedBox(child, width, height, fractionRadius);
    if (!contentBox) return out;
    final looseWidth = width != null && boxExtra.horizontal > 0;
    final looseHeight = height != null && boxExtra.vertical > 0;
    return looseWidth || looseHeight
        ? FjsOverflowSize(
            looseWidth: looseWidth,
            looseHeight: looseHeight,
            child: out,
          )
        : out;
  }

  final widthLength = style.widthLength;
  final heightLength = style.heightLength;
  if (widthLength?.isRelative == true || heightLength?.isRelative == true) {
    // `50%` / `calc(100% - 32px)`: the reference is what the parent offers on
    // that axis, which is what CSS resolves a percentage against. An
    // unbounded axis has nothing to be a fraction of and falls back to auto,
    // again as in CSS.
    final inner = w;
    w = LayoutBuilder(
      builder: (context, constraints) {
        final width = widthLength?.resolveOrNull(constraints.maxWidth);
        final height = heightLength?.resolveOrNull(constraints.maxHeight);
        return box(
          inner,
          width,
          height,
          // the corners come from the size the box actually gets (spec 079);
          // an unbounded axis leaves the size null and the corners square
          layoutRadius && width != null && height != null
              ? _fractionRadiusIn(style, width, height)
              : null,
        );
      },
    );
  } else {
    // widthLength covers every absolute form including calc() — a
    // pure-absolute calc folds to px here, e.g. vant's
    // `--van-switch-width: calc(1.8em + 4px)` (em already rewritten by the
    // engine). style.width's parseLength would drop the calc silently and
    // the box collapsed to auto.
    w = box(w, widthLength?.px, heightLength?.px);
  }
  if (paintedOver) {
    // `transition: border-color` (or `all`, spec 078): the uniform solid
    // stroke lerps inside the BoxDecoration (decorationTrack above), but
    // dashed sides and per-side borders paint here — their colours tween
    // over the painter, geometry (widths, kinds) always taking the end
    // style, since CSS transitions only the colour.
    final borderColorTrack = liveTrack('borderColor');
    if (borderColorTrack != null) {
      final content = w;
      w = TweenAnimationBuilder<FjsBoxBorders>(
        tween: _BoxBordersTween(end: side),
        duration: borderColorTrack.duration,
        curve: borderColorTrack.curve,
        builder: (_, borders, inner) => CustomPaint(
          foregroundPainter: borders.isUniform
              ? FjsDashedBorderPainter(
                  width: borders.top!.width,
                  color: borders.top!.color,
                  kind: borders.top!.kind,
                  borderRadius: borderRadius,
                )
              : FjsSideBorderPainter(
                  borders: borders,
                  borderRadius: borderRadius,
                ),
          child: inner,
        ),
        child: content,
      );
    } else {
      w = CustomPaint(
        foregroundPainter: side.isUniform
            ? FjsDashedBorderPainter(
                width: side.top!.width,
                color: side.top!.color,
                kind: side.top!.kind,
                borderRadius: borderRadius,
              )
            : FjsSideBorderPainter(borders: side, borderRadius: borderRadius),
        child: w,
      );
    }
  }
  if (style.hasRelativeConstraints) {
    final inner = w;
    w = LayoutBuilder(
      builder: (context, outer) {
        final constraints = style.constraintsIn(outer);
        return constraints == null
            ? inner
            : ConstrainedBox(constraints: constraints, child: inner);
      },
    );
  } else {
    final constraints = style.constraints;
    if (constraints != null)
      w = ConstrainedBox(constraints: constraints, child: w);
  }
  if (style.overflowHidden) {
    // the scope tells flex boxes inside that their overflow is clipped here:
    // the same geometry is web's scrollWidth > clientWidth, not an error
    // (see RenderFjsFlex.cssOverflowClip)
    w = FjsClipScope(
      child: borderRadius != null
          ? ClipRRect(borderRadius: borderRadius, child: w)
          : ClipRect(child: w),
    );
  }
  // margin sits OUTSIDE the sized/decorated box, as in CSS: it must not eat
  // into width/height, the background must not paint through it, and the
  // overflow clip stays aligned with the box's own corners.
  //
  // Out-of-flow boxes are the exception: their margin offsets the box from
  // the inset (CSS resolves `top: 0; margin-top: 4px` to a border box at 4
  // without shrinking a declared height), so positionedChild folds the
  // margin into the positioned insets and this Padding is skipped — inside
  // the tight Positioned slot it would squeeze the box instead (vant's
  // badge dot came out 8x4).
  final outOfFlow = style.position == 'absolute' || style.position == 'fixed';
  final marginLengths = style.marginLengths;
  final marginTrack = _liveTrack(style, 'margin');
  if (!outOfFlow) {
    if (marginLengths != null && marginLengths.hasRelative) {
      // same reference as padding: the incoming max width, every side. The
      // builder runs at LAYOUT time, after `w` has been reassigned by every
      // later branch — capture the current value, or the builder closes over
      // the LayoutBuilder itself and the box recurses into a freeze.
      final inner = w;
      w = LayoutBuilder(
        builder: (context, constraints) => _animatedEdges(
          marginTrack,
          resolveEdgeLengths(
            marginLengths,
            style.margin,
            null,
            constraints.maxWidth,
          ),
          child: inner,
        ),
      );
    } else if (style.margin != null) {
      w = _animatedEdges(marginTrack, style.margin!, child: w);
    }
  }
  // `position: relative` nudges the painted box; the slot it was laid out
  // in — and therefore every sibling — stays put, as in CSS
  if (style.hasRelativeOffset) {
    // dx measures against the containing block's width, dy against its
    // height (spec 044); both are the constraints this box was offered
    final inner = w;
    w = LayoutBuilder(
      builder: (context, constraints) {
        final offset = style.relativeOffsetIn(
          constraints.maxWidth,
          constraints.maxHeight,
        );
        return offset == Offset.zero
            ? inner
            : Transform.translate(offset: offset, child: inner);
      },
    );
  } else {
    final shift = style.relativeOffset;
    if (shift != Offset.zero) w = Transform.translate(offset: shift, child: w);
  }
  return w;
}

/// Padding / margin that interpolates while [track] is live —
/// `transition: padding` / `transition: margin` (spec 078). The tween holds
/// the RESOLVED pixels: a % side met its reference already (relative values
/// resolve inside the LayoutBuilder that hands the constraint down), so
/// EdgeInsets.lerp is the CSS transition per side. track.delay is not
/// honoured — TweenAnimationBuilder has no delay hook, the same gap
/// background-color lives with (css-compat.md) — and no transitionend is
/// dispatched (only width/height need one, for vant's collapse).
Widget _animatedEdges(
  FjsTransitionTrack? track,
  EdgeInsets edges, {
  required Widget child,
}) {
  if (track == null || track.duration <= Duration.zero) {
    return Padding(padding: edges, child: child);
  }
  return TweenAnimationBuilder<EdgeInsets>(
    tween: EdgeInsetsTween(end: edges),
    duration: track.duration,
    curve: track.curve,
    builder: (_, value, inner) => Padding(padding: value, child: inner),
    child: child,
  );
}

/// Lerps a box-border set for `transition: border-color` (spec 078):
/// colours interpolate between sides present on BOTH ends; a side that
/// appears or disappears takes the end state at once — CSS transitions only
/// the colour, and `FjsBoxBorders` forgets a 0-width side's colour
/// (style.dart's boxBorders), so there is nothing older to lerp from.
class _BoxBordersTween extends Tween<FjsBoxBorders> {
  _BoxBordersTween({required super.end});

  @override
  FjsBoxBorders lerp(double t) {
    FjsBorderSide? side(FjsBorderSide? a, FjsBorderSide? b) {
      if (a == null || b == null) return b;
      return (
        width: b.width,
        color: Color.lerp(a.color, b.color, t)!,
        kind: b.kind,
      );
    }

    return FjsBoxBorders(
      top: side(begin?.top, end?.top),
      right: side(begin?.right, end?.right),
      bottom: side(begin?.bottom, end?.bottom),
      left: side(begin?.left, end?.left),
    );
  }
}

/// Marks the subtree inside a box that clips its content — CSS
/// `overflow: hidden` (the ClipRect below), scroll containers. Flex boxes
/// inside read it to skip Flutter's debug "overflowed" indicator: content
/// running past them is clipped here before anyone sees it, which is not
/// an error condition on web either (see RenderFjsFlex.cssOverflowClip).
class FjsClipScope extends InheritedWidget {
  const FjsClipScope({super.key, required super.child});

  @override
  bool updateShouldNotify(FjsClipScope oldWidget) => false;

  static bool of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<FjsClipScope>() != null;
}

/// Resolves a relative-capable edge set into [EdgeInsets]: a `%`/calc side
/// against [reference] (unbounded → 0, the CSS fallback for an indefinite
/// containing block), an absolute side from the merged EdgeInsets the
/// style already carries, and an undeclared side from [fallback] (the
/// tag's default padding, or nothing for margin).
EdgeInsets resolveEdgeLengths(
  FjsEdgeLengths lengths,
  EdgeInsets? absolute,
  EdgeInsets? fallback,
  double reference,
) {
  double side(FjsLength? length, double? abs, double? def) {
    if (length != null && length.isRelative) {
      return length.resolveOrNull(reference) ?? 0;
    }
    return abs ?? def ?? 0;
  }

  return EdgeInsets.fromLTRB(
    side(lengths.left, absolute?.left, fallback?.left),
    side(lengths.top, absolute?.top, fallback?.top),
    side(lengths.right, absolute?.right, fallback?.right),
    side(lengths.bottom, absolute?.bottom, fallback?.bottom),
  );
}

/// Applies `transform` — the outermost wrapper a node gets, so it moves the
/// input layers with the paint the way CSS does: the finger keeps holding
/// the block it picked up. Layout is untouched, which is the point — a
/// translate costs a repaint, not a relayout, and that is what a drag can
/// afford every frame. The origin is the box centre, CSS's default.
///
/// [stable] keeps the wrapper in the tree even with no transform declared.
/// A node that gains one mid-gesture would otherwise change the shape of
/// the widget chain above its pointer listener, which rebuilds the listener
/// from scratch — dropping the very drag that set the transform. Nodes that
/// can be dragged (the ones with touch handlers) therefore always carry the
/// wrapper; the rest only pay for it once they ask for a transform.
Widget transitionNode(
  FjsStyle style,
  Widget content, {
  required Object? key,
  bool stableTransform = false,
  bool stableOpacity = false,
  VoidCallback? onTransitionEnd,
}) {
  final transitions = style.transitions;
  final transformTrack = transitions?.forProperty('transform');
  final opacityTrack = transitions?.forProperty('opacity');
  final transform = style.transform ?? Matrix4.identity();
  final opacity = style.opacity ?? 1.0;
  final wantsTransform =
      stableTransform ||
      style.transform != null ||
      (transformTrack != null && transformTrack.duration > Duration.zero);
  final wantsOpacity =
      stableOpacity ||
      style.opacity != null ||
      (opacityTrack != null && opacityTrack.duration > Duration.zero);
  final animatesTransform =
      transformTrack != null &&
      transformTrack.duration > Duration.zero &&
      wantsTransform;
  final animatesOpacity =
      opacityTrack != null &&
      opacityTrack.duration > Duration.zero &&
      wantsOpacity;

  // `%` translations resolve against the box's own size, known only at
  // layout — FractionalTranslation does exactly that. It wraps OUTSIDE the
  // matrix: CSS applies the list left to right, and `%` translations lead
  // in the idioms that use them (see [parseTransformFraction]). When the
  // transform track animates, the node owns the fraction and tweens it with
  // the matrix (one CSS transform, one transition) — vant's popup slide IS
  // a fraction flip (`enter-from: translate3d(0, 100%, 0)`), and a static
  // wrapper here would jump instead of slide.
  final fraction = style.transformFraction;
  // Any declared transition keeps the wrapper, a 0s one too: vant's marquee
  // sits at `transition-duration: 0s` with no transform, then sets both in
  // one change. Inserting the wrapper at that moment would mount it at the
  // END value (initState has no before-change style) — a jump, and no
  // transitionend; CSS transitions from the old value.
  if (transitions == null && !wantsTransform && !wantsOpacity) {
    return fraction == null
        ? content
        : FractionalTranslation(translation: fraction, child: content);
  }
  return _TransitionNode(
    key: key == null ? null : ValueKey<Object>(key),
    transform: transform,
    opacity: opacity,
    fraction: fraction,
    transformTrack: animatesTransform ? transformTrack : null,
    opacityTrack: animatesOpacity ? opacityTrack : null,
    stableTransform: wantsTransform,
    stableOpacity: stableOpacity,
    onTransitionEnd: onTransitionEnd,
    child: content,
  );
}

@Deprecated(
  'Use transitionNode so CSS transition can animate transform/opacity.',
)
Widget transformNode(FjsStyle style, Widget content, {bool stable = false}) {
  final transform = style.transform;
  if (transform == null && !stable) return content;
  return Transform(
    transform: transform ?? Matrix4.identity(),
    alignment: Alignment.center,
    child: content,
  );
}

class _TransitionNode extends StatefulWidget {
  const _TransitionNode({
    super.key,
    required this.transform,
    required this.opacity,
    this.fraction,
    this.transformTrack,
    this.opacityTrack,
    required this.stableTransform,
    this.stableOpacity = false,
    this.onTransitionEnd,
    required this.child,
  });

  final Matrix4 transform;
  final double opacity;

  /// The `%` part of the transform list, tweened with the matrix by the
  /// transform track (see [transitionNode]).
  final Offset? fraction;

  final bool stableTransform;
  final bool stableOpacity;
  final FjsTransitionTrack? transformTrack;
  final FjsTransitionTrack? opacityTrack;

  /// CSS `transitionend`: a transform/opacity transition ran to its end.
  /// A retarget mid-flight is a cancel and does not call it.
  final VoidCallback? onTransitionEnd;
  final Widget child;

  @override
  State<_TransitionNode> createState() => _TransitionNodeState();
}

class _TransitionNodeState extends State<_TransitionNode>
    with TickerProviderStateMixin {
  AnimationController? _transformController;
  AnimationController? _opacityController;
  Animation<double>? _transformAnimation;
  Animation<double>? _opacityAnimation;
  Timer? _transformDelay;
  Timer? _opacityDelay;
  Matrix4? _transformBegin;
  Matrix4? _transformEnd;
  double? _opacityBegin;
  double? _opacityEnd;
  Offset? _fractionBegin;
  Offset? _fractionEnd;

  @override
  void initState() {
    super.initState();
    _transformEnd = widget.transform.clone();
    _opacityEnd = widget.opacity;
    _fractionEnd = widget.fraction ?? Offset.zero;
    _syncControllers(oldWidget: null);
  }

  @override
  void didUpdateWidget(covariant _TransitionNode oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncControllers(oldWidget: oldWidget);
    if (!_sameMatrix(widget.transform, oldWidget.transform) ||
        widget.fraction != oldWidget.fraction) {
      _retargetTransform(oldWidget);
    }
    if (widget.opacity != oldWidget.opacity) {
      _retargetOpacity(oldWidget);
    }
  }

  void _syncControllers({_TransitionNode? oldWidget}) {
    if (widget.transformTrack == null) {
      _transformDelay?.cancel();
      _transformDelay = null;
      _transformAnimation = null;
      _transformBegin = null;
      _transformEnd = widget.transform.clone();
      _fractionBegin = null;
      _fractionEnd = widget.fraction ?? Offset.zero;
    }
    if (widget.opacityTrack == null) {
      _opacityDelay?.cancel();
      _opacityDelay = null;
      _opacityAnimation = null;
      _opacityBegin = null;
      _opacityEnd = widget.opacity;
    }
    _transformController = _syncController(
      controller: _transformController,
      oldTrack: oldWidget?.transformTrack,
      nextTrack: widget.transformTrack,
    );
    _opacityController = _syncController(
      controller: _opacityController,
      oldTrack: oldWidget?.opacityTrack,
      nextTrack: widget.opacityTrack,
    );
  }

  AnimationController? _syncController({
    required AnimationController? controller,
    required FjsTransitionTrack? oldTrack,
    required FjsTransitionTrack? nextTrack,
  }) {
    if (nextTrack == null) {
      controller?.dispose();
      return null;
    }
    if (controller == null) {
      return AnimationController(vsync: this, duration: nextTrack.duration)
        ..value = 1;
    }
    if (oldTrack?.duration != nextTrack.duration) {
      controller.duration = nextTrack.duration;
    }
    return controller;
  }

  void _retargetTransform(_TransitionNode oldWidget) {
    final controller = _transformController;
    if (controller == null) {
      _transformEnd = widget.transform.clone();
      _fractionEnd = widget.fraction ?? Offset.zero;
      _transformBegin = null;
      return;
    }
    _transformBegin = _currentTransform(oldWidget.transform).clone();
    _transformEnd = widget.transform.clone();
    // `transform: none` is the identity — a dropped fraction tweens to zero,
    // it does not disappear mid-flight
    _fractionBegin = oldWidget.fraction ?? Offset.zero;
    _fractionEnd = widget.fraction ?? Offset.zero;
    _transformDelay?.cancel();
    _run(
      controller,
      widget.transformTrack!,
      (animation) => _transformAnimation = animation,
      (timer) => _transformDelay = timer,
    );
  }

  void _retargetOpacity(_TransitionNode oldWidget) {
    final controller = _opacityController;
    if (controller == null) {
      _opacityEnd = widget.opacity;
      _opacityBegin = null;
      return;
    }
    _opacityBegin = _currentOpacity(oldWidget.opacity);
    _opacityEnd = widget.opacity;
    _opacityDelay?.cancel();
    _run(
      controller,
      widget.opacityTrack!,
      (animation) => _opacityAnimation = animation,
      (timer) => _opacityDelay = timer,
    );
  }

  void _run(
    AnimationController controller,
    FjsTransitionTrack track,
    void Function(Animation<double>) setAnimation,
    void Function(Timer?) setDelayTimer,
  ) {
    controller.stop();
    controller.duration = track.duration;
    setAnimation(CurvedAnimation(parent: controller, curve: track.curve));
    controller.value = 0;
    // TickerFuture completes only when the run reaches its end — a stop()
    // from a retarget leaves it pending, which is CSS's transitioncancel
    void start() => controller.forward().then((_) {
      if (mounted) widget.onTransitionEnd?.call();
    });
    if (track.delay <= Duration.zero) {
      start();
      setDelayTimer(null);
      return;
    }
    setDelayTimer(
      Timer(track.delay, () {
        if (!mounted) return;
        if (controller.value == 0) start();
      }),
    );
  }

  Matrix4 _currentTransform(Matrix4 fallback) {
    final begin = _transformBegin;
    final end = _transformEnd;
    final animation = _transformAnimation;
    if (begin == null || end == null || animation == null) return fallback;
    return Matrix4Tween(begin: begin, end: end).transform(animation.value);
  }

  /// The tweened `%` translation while the transform track runs; the
  /// element's own fraction otherwise.
  Offset? _currentFraction() {
    final animation = _transformAnimation;
    if (_fractionBegin == null || _fractionEnd == null || animation == null) {
      return widget.fraction;
    }
    return Offset.lerp(_fractionBegin, _fractionEnd, animation.value);
  }

  double _currentOpacity(double fallback) {
    final begin = _opacityBegin;
    final end = _opacityEnd;
    final animation = _opacityAnimation;
    if (begin == null || end == null || animation == null) return fallback;
    return begin + (end - begin) * animation.value;
  }

  @override
  void dispose() {
    _transformDelay?.cancel();
    _opacityDelay?.cancel();
    _transformController?.dispose();
    _opacityController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final listeners = [
      if (_transformController != null) _transformController!,
      if (_opacityController != null) _opacityController!,
    ];
    final listenable = listeners.isEmpty
        ? const AlwaysStoppedAnimation<double>(1)
        : Listenable.merge(listeners);
    return AnimatedBuilder(
      animation: listenable,
      child: widget.child,
      builder: (context, child) {
        Widget w = child!;
        // `%` translations lead the transform list: translation outside the
        // matrix, tweened with it
        final fraction = _currentFraction();
        if (fraction != null) {
          w = FractionalTranslation(translation: fraction, child: w);
        }
        if (widget.stableTransform) {
          w = Transform(
            transform: _currentTransform(widget.transform),
            alignment: Alignment.center,
            child: w,
          );
        }
        final opacity = _currentOpacity(widget.opacity).clamp(0.0, 1.0);
        if (opacity < 1 ||
            widget.opacityTrack != null ||
            widget.stableOpacity) {
          w = Opacity(opacity: opacity, child: w);
        }
        return w;
      },
    );
  }
}

bool _sameMatrix(Matrix4 a, Matrix4 b) {
  final av = a.storage;
  final bv = b.storage;
  for (var i = 0; i < av.length; i++) {
    if (av[i] != bv[i]) return false;
  }
  return true;
}

/// A resolved side as a Flutter [BorderSide]; absent sides stay `none`.
BorderSide _borderSide(FjsBorderSide? side) => side == null
    ? BorderSide.none
    : BorderSide(color: side.color, width: side.width);

/// A width/height transition ran to its end — CSS `transitionend` for the
/// size tracks, which live in the decoration layer and know no node id.
/// The renderer catches it at the node that declared the transition
/// (renderer.dart), so a child's never reaches its parent.
class FjsSizeTransitionEnd extends Notification {
  const FjsSizeTransitionEnd();
}

/// Lays its child out free of the parent's cap on the chosen axes and takes
/// the child's size clamped to its own constraints: the child keeps a size
/// it declared and paints past the edge it overflows (a clipping ancestor
/// trims it, as `overflow: hidden` does on the web).
class FjsOverflowSize extends SingleChildRenderObjectWidget {
  const FjsOverflowSize({
    super.key,
    required this.looseWidth,
    required this.looseHeight,
    super.child,
  });

  final bool looseWidth;
  final bool looseHeight;

  @override
  RenderFjsOverflowSize createRenderObject(BuildContext context) =>
      RenderFjsOverflowSize(looseWidth, looseHeight);

  @override
  void updateRenderObject(
    BuildContext context,
    RenderFjsOverflowSize renderObject,
  ) {
    renderObject
      ..looseWidth = looseWidth
      ..looseHeight = looseHeight;
  }
}

class RenderFjsOverflowSize extends RenderShiftedBox {
  RenderFjsOverflowSize(this._looseWidth, this._looseHeight) : super(null);

  bool _looseWidth;
  set looseWidth(bool v) {
    if (v == _looseWidth) return;
    _looseWidth = v;
    markNeedsLayout();
  }

  bool _looseHeight;
  set looseHeight(bool v) {
    if (v == _looseHeight) return;
    _looseHeight = v;
    markNeedsLayout();
  }

  @override
  void performLayout() {
    final c = child;
    if (c == null) {
      size = constraints.smallest;
      return;
    }
    c.layout(
      BoxConstraints(
        minWidth: _looseWidth ? 0 : constraints.minWidth,
        maxWidth: _looseWidth ? double.infinity : constraints.maxWidth,
        minHeight: _looseHeight ? 0 : constraints.minHeight,
        maxHeight: _looseHeight ? double.infinity : constraints.maxHeight,
      ),
      parentUsesSize: true,
    );
    size = constraints.constrain(c.size);
    (c.parentData! as BoxParentData).offset = Offset.zero;
  }

  @override
  bool hitTest(BoxHitTestResult result, {required Offset position}) =>
      // the overflowing part is still the child's
      hitTestChildren(result, position: position);
}

/// Paints [FjsBackgroundLayer]s, last layer first (CSS stacks the first on
/// top).
class _LayeredBackground extends Decoration {
  const _LayeredBackground(this.layers);

  final List<FjsBackgroundLayer> layers;

  @override
  BoxPainter createBoxPainter([VoidCallback? onChanged]) =>
      _LayeredBackgroundPainter(layers);
}

class _LayeredBackgroundPainter extends BoxPainter {
  _LayeredBackgroundPainter(this.layers);

  final List<FjsBackgroundLayer> layers;

  @override
  void paint(Canvas canvas, Offset offset, ImageConfiguration configuration) {
    final size = configuration.size;
    if (size == null || size.isEmpty) return;
    for (final layer in layers.reversed) {
      final rect = layer.rectIn(size).shift(offset);
      if (rect.isEmpty) continue;
      canvas.drawRect(
        rect,
        Paint()..shader = layer.gradient.createShader(rect),
      );
    }
  }
}
