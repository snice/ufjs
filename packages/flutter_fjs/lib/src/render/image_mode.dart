// Image mode mapping for the Flutter host. `mode` is an image prop rather
// than CSS, while the old `fit` prop remains a compatibility escape hatch.
import 'package:flutter/widgets.dart';

import '../mirror_tree.dart';
import 'style.dart';

class FjsImageMode {
  const FjsImageMode({
    required this.name,
    required this.fit,
    required this.alignment,
    this.fix,
  });

  final String name;
  final BoxFit fit;
  final Alignment alignment;
  final Axis? fix;
}

const Set<String> fjsImageModeNames = {
  'scaleToFill',
  'aspectFit',
  'aspectFill',
  'widthFix',
  'heightFix',
  'top',
  'bottom',
  'center',
  'left',
  'right',
  'top left',
  'top right',
  'bottom left',
  'bottom right',
};

FjsImageMode resolveFjsImageMode(
  MirrorNode node,
  FjsStyle style, {
  void Function(String message)? warn,
}) {
  final raw = node.props['mode'];
  final explicit = raw != null && raw.toString().isNotEmpty
      ? raw.toString()
      : null;
  if (explicit == null) {
    final legacy = style.fit;
    if (legacy != null) {
      return FjsImageMode(
        name: 'legacy',
        fit: legacy,
        alignment: Alignment.center,
      );
    }
    return const FjsImageMode(
      name: 'scaleToFill',
      fit: BoxFit.fill,
      alignment: Alignment.center,
    );
  }

  var mode = explicit;
  if (!fjsImageModeNames.contains(mode)) {
    warn?.call('image received unsupported mode="$mode"; using "scaleToFill".');
    mode = 'scaleToFill';
  }

  switch (mode) {
    case 'aspectFit':
      return const FjsImageMode(
        name: 'aspectFit',
        fit: BoxFit.contain,
        alignment: Alignment.center,
      );
    case 'aspectFill':
      return const FjsImageMode(
        name: 'aspectFill',
        fit: BoxFit.cover,
        alignment: Alignment.center,
      );
    case 'widthFix':
      return const FjsImageMode(
        name: 'widthFix',
        fit: BoxFit.contain,
        alignment: Alignment.center,
        fix: Axis.horizontal,
      );
    case 'heightFix':
      return const FjsImageMode(
        name: 'heightFix',
        fit: BoxFit.contain,
        alignment: Alignment.center,
        fix: Axis.vertical,
      );
    // uni-app's crop modes; this spec's table defines them as
    // aspect-preserving crop, so they are cover + an alignment. `center` is
    // the alignment-neutral one and is easy to leave out of a switch like
    // this — leaving it out silently downgraded it to scaleToFill.
    case 'center':
      return const FjsImageMode(
        name: 'center',
        fit: BoxFit.cover,
        alignment: Alignment.center,
      );
    case 'top':
      return const FjsImageMode(
        name: 'top',
        fit: BoxFit.cover,
        alignment: Alignment.topCenter,
      );
    case 'bottom':
      return const FjsImageMode(
        name: 'bottom',
        fit: BoxFit.cover,
        alignment: Alignment.bottomCenter,
      );
    case 'left':
      return const FjsImageMode(
        name: 'left',
        fit: BoxFit.cover,
        alignment: Alignment.centerLeft,
      );
    case 'right':
      return const FjsImageMode(
        name: 'right',
        fit: BoxFit.cover,
        alignment: Alignment.centerRight,
      );
    case 'top left':
      return const FjsImageMode(
        name: 'top left',
        fit: BoxFit.cover,
        alignment: Alignment.topLeft,
      );
    case 'top right':
      return const FjsImageMode(
        name: 'top right',
        fit: BoxFit.cover,
        alignment: Alignment.topRight,
      );
    case 'bottom left':
      return const FjsImageMode(
        name: 'bottom left',
        fit: BoxFit.cover,
        alignment: Alignment.bottomLeft,
      );
    case 'bottom right':
      return const FjsImageMode(
        name: 'bottom right',
        fit: BoxFit.cover,
        alignment: Alignment.bottomRight,
      );
    default:
      return const FjsImageMode(
        name: 'scaleToFill',
        fit: BoxFit.fill,
        alignment: Alignment.center,
      );
  }
}
