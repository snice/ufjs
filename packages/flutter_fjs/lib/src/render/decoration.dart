// The box every tag's content is wrapped in: padding, explicit size,
// background/border/shadow, clipping and margin — in the order CSS
// applies them.
import 'dart:async' show Timer;

import 'package:flutter/material.dart';

import 'dashed_border.dart';
import 'length.dart';
import 'style.dart';
import 'style_parse.dart';

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
}) {
  Widget w = content;
  final padLengths = style.paddingLengths;
  if (padLengths != null && padLengths.hasRelative) {
    // A % padding references the containing block's WIDTH on every side
    // (CSS box model — `padding-top: 10%` is 10% of the width, not the
    // height). The reference is the constraint's incoming max width: the
    // parent's content box in normal flow, the flex container's width when
    // _flexChild passed its bound down, and unbounded inside a scroller —
    // where CSS resolves the percentage to 0 and so does resolveOrNull.
    w = LayoutBuilder(
      builder: (context, constraints) => Padding(
        padding: resolveEdgeLengths(
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
    if (padding != null) w = Padding(padding: padding, child: w);
  }
  // The four sides, each through its own cascade; a built-in's default
  // hairline fills in only the sides the page said nothing about.
  final borders = style.boxBorders(defaultBorderColor: defaultBorderColor);
  final side = borders == null || borders.isNone ? null : borders;
  final borderRadius = style.borderRadius ?? defaultBorderRadius;
  final radiusPainted =
      borderRadius != null && borderRadius != BorderRadius.zero;
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
  final decorated =
      style.hasDecoration ||
      border != null ||
      background != null ||
      foregroundDecoration != null;
  // The sized/decorated box itself, given the pixels for this build. Pulled
  // out because a percentage size only becomes pixels inside a layout pass
  // (below); everything else about the box is the same either way.
  //
  // `transition: background-color …` (or `all`, spec 045): a solid
  // background then animates through a TweenAnimationBuilder, whose
  // semantics are exactly the CSS transition's — the first frame takes the
  // value as-is, a changed target interpolates from wherever the previous
  // animation was. track.delay is NOT honored here: TweenAnimationBuilder
  // has no delay hook (transform/opacity keep their Timer-based delay in
  // _TransitionNode); the gap is registered in css-compat.md.
  final backgroundTrack = background != null && style.gradient == null
      // track property names are camelized by _normalizeTransitionProperty
      // (`background-color` in CSS arrives as `backgroundColor`)
      ? style.transitions?.forProperty('backgroundColor')
      : null;
  final animatesBackground =
      backgroundTrack != null && backgroundTrack.duration > Duration.zero;
  Widget box(Widget child, double? width, double? height) {
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
      if (animatesHeight) {
        out = TweenAnimationBuilder<double>(
          tween: Tween<double>(end: height),
          duration: heightTrack.duration,
          curve: heightTrack.curve,
          builder: (_, h, inner) => SizedBox(height: h, child: inner),
          child: out,
        );
      }
      if (animatesWidth) {
        out = TweenAnimationBuilder<double>(
          tween: Tween<double>(end: width),
          duration: widthTrack.duration,
          curve: widthTrack.curve,
          builder: (_, w, inner) => SizedBox(width: w, child: inner),
          child: out,
        );
      }
      return out;
    }

    Widget buildBox(Color? color) {
      return Container(
        key: foregroundKey,
        // the animated axes move to the outer animated SizedBox — a tight
        // constraint the decorated box fills, so background/border track it
        width: animatesWidth ? null : width,
        height: animatesHeight ? null : height,
        decoration: BoxDecoration(
          color: color,
          gradient: style.gradient,
          borderRadius: borderRadius,
          border: border,
          boxShadow: style.boxShadows,
        ),
        foregroundDecoration: foregroundDecoration,
        child: child,
      );
    }

    if (decorated) {
      Widget out;
      if (!animatesBackground) {
        out = buildBox(background);
      } else {
        out = TweenAnimationBuilder<Color?>(
          tween: ColorTween(end: background),
          duration: backgroundTrack.duration,
          curve: backgroundTrack.curve,
          builder: (_, color, inner) => buildBox(color ?? background),
          child: child,
        );
      }
      return animateSize(out);
    }
    if (width != null || height != null) {
      return animateSize(SizedBox(width: width, height: height, child: child));
    }
    return child;
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
      builder: (context, constraints) => box(
        inner,
        widthLength?.resolveOrNull(constraints.maxWidth),
        heightLength?.resolveOrNull(constraints.maxHeight),
      ),
    );
  } else {
    w = box(w, style.width, style.height);
  }
  if (paintedOver) {
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
    w = borderRadius != null
        ? ClipRRect(borderRadius: borderRadius, child: w)
        : ClipRect(child: w);
  }
  // margin sits OUTSIDE the sized/decorated box, as in CSS: it must not eat
  // into width/height, the background must not paint through it, and the
  // overflow clip stays aligned with the box's own corners
  final marLengths = style.marginLengths;
  if (marLengths != null && marLengths.hasRelative) {
    // same reference as padding: the incoming max width, every side. The
    // builder runs at LAYOUT time, after `w` has been reassigned by every
    // later branch — capture the current value, or the builder closes over
    // the LayoutBuilder itself and the box recurses into a freeze.
    final inner = w;
    w = LayoutBuilder(
      builder: (context, constraints) => Padding(
        padding: resolveEdgeLengths(
          marLengths,
          style.margin,
          null,
          constraints.maxWidth,
        ),
        child: inner,
      ),
    );
  } else if (style.margin != null) {
    w = Padding(padding: style.margin!, child: w);
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

  if (transitions?.hasAnimatedTrack != true &&
      !wantsTransform &&
      !wantsOpacity) {
    return content;
  }
  return _TransitionNode(
    key: key == null ? null : ValueKey<Object>(key),
    transform: transform,
    opacity: opacity,
    transformTrack: animatesTransform ? transformTrack : null,
    opacityTrack: animatesOpacity ? opacityTrack : null,
    stableTransform: wantsTransform,
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
    required this.stableTransform,
    required this.child,
    this.transformTrack,
    this.opacityTrack,
  });

  final Matrix4 transform;
  final double opacity;
  final bool stableTransform;
  final FjsTransitionTrack? transformTrack;
  final FjsTransitionTrack? opacityTrack;
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

  @override
  void initState() {
    super.initState();
    _transformEnd = widget.transform.clone();
    _opacityEnd = widget.opacity;
    _syncControllers(oldWidget: null);
  }

  @override
  void didUpdateWidget(covariant _TransitionNode oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncControllers(oldWidget: oldWidget);
    if (!_sameMatrix(widget.transform, oldWidget.transform)) {
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
      _transformBegin = null;
      return;
    }
    _transformBegin = _currentTransform(oldWidget.transform).clone();
    _transformEnd = widget.transform.clone();
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
    if (track.delay <= Duration.zero) {
      controller.forward();
      setDelayTimer(null);
      return;
    }
    setDelayTimer(
      Timer(track.delay, () {
        if (!mounted) return;
        if (controller.value == 0) controller.forward();
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
        if (widget.stableTransform) {
          w = Transform(
            transform: _currentTransform(widget.transform),
            alignment: Alignment.center,
            child: w,
          );
        }
        final opacity = _currentOpacity(widget.opacity).clamp(0.0, 1.0);
        if (opacity < 1 || widget.opacityTrack != null) {
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
