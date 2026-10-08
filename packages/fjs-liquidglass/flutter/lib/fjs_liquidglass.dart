// Flutter side of the fjs module "liquidglass": the widget behind
// <glass-surface />.
//
// fjs autolinks this — the generated host depends on this package and calls
// FjsLiquidglass.register(engine) before runApp, as the module's
// package.json "fjs.flutter" field says.
//
// <glass-surface /> is a LEAF glass layer, not a container: a registry
// builder only receives (node, children, dispatch), and the CSS that decides
// a node's layout (flex-direction, gap, align) is applied by the renderer's
// view adapter, not handed to the builder. A container version would have to
// re-implement flex here. As a leaf, the page positions it absolutely to fill
// its parent and draws the content as its siblings on top. That also happens
// to be what liquid_glass_widgets wants: glass is a platter under controls,
// never a wrapper around other glass.
//
// We do not call LiquidGlassWidgets.wrap(): the package says it is only
// needed for app-wide theme / adaptive quality, and wrapping the app root
// would mean touching the host's main.dart. Light/dark comes in as a prop
// instead of through its brightness resolver.
import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

class FjsLiquidglass {
  static bool _registered = false;

  static void register(FjsEngine engine) {
    engine.components.register('glass-surface', _build);
    if (!_registered) {
      _registered = true;
      // Shader pre-warm is async asset I/O only; widgets render without it
      // (loaded on demand), it just spares the first frame a placeholder —
      // the same "warm the first load" move iconmind makes.
      unawaited(
        LiquidGlassWidgets.initialize(enablePerformanceMonitor: false).catchError(
          (Object e) => debugPrint('[liquidglass] shader pre-warm failed: $e'),
        ),
      );
    }
  }

  /// Props cross the boundary as JSON: a number may arrive as `20` or `20.0`.
  static double? _double(Object? v) => v is num ? v.toDouble() : null;

  /// What the props ask for, resolved — split from the builder so the mapping
  /// (the part that must agree with the web twin) is testable without a
  /// widget tree.
  @visibleForTesting
  static GlassSpec specFor(Map<String, Object?> props) {
    final radius = _double(props['radius']) ?? 0;
    // `blur` is the web's backdrop-filter radius; the material here frosts
    // with `frost`, which the preset tunes to 14 at the web default of 20, so
    // the same number gives the same amount of frosting on both ends.
    final blur = _double(props['blur']) ?? 20;
    final refraction = (_double(props['refraction']) ?? 0).clamp(0.0, 1.0);
    final dark = props['dark'] == true;
    final pressed = props['pressed'] == true;
    final tint = parseColor(props['tint']);

    // The package's iOS 27 `glassEffect(.regular)` presets are the look the
    // design asks for (dark body, bright rim light, paraxial lens band); an
    // earlier hand-rolled LiquidGlassSettings read as washed-out grey. They
    // are only drawn in full on the premium tier — refraction 0 is the
    // documented fallback: the standard tier approximates them (frost and
    // specular), which is plain frosted glass.
    final base = dark ? LiquidGlassSettings.ios27Dark : LiquidGlassSettings.ios27Light;
    return GlassSpec(
      radius: radius,
      quality: refraction > 0 ? GlassQuality.premium : GlassQuality.standard,
      settings: base.copyWith(
        glassColor: tint,
        frost: blur * 0.7,
        // 12 + 34r lands on the preset's 32 at the usual refraction of 0.6
        thickness: 12 + 34 * refraction,
        rimLight: pressed ? base.rimLight * 1.4 : base.rimLight,
      ),
    );
  }

  /// The tag's builder, exposed so a test can drive it without a native
  /// engine (FjsEngine needs the host dylib; see AGENTS.md on `No tests ran`).
  @visibleForTesting
  static ComponentBuilder get builder => _build;

  static final ComponentBuilder _build = (context, node, children, dispatch) {
    final spec = specFor(node.props);
    return GlassContainer(
      useOwnLayer: true,
      quality: spec.quality,
      settings: spec.settings,
      shape: LiquidRoundedSuperellipse(borderRadius: spec.radius),
      // fill the parent's (absolute, tight) box; children are ignored by
      // design, see the file comment
      child: const SizedBox.expand(),
    );
  };
}

class GlassSpec {
  const GlassSpec({
    required this.radius,
    required this.quality,
    required this.settings,
  });

  final double radius;
  final GlassQuality quality;
  final LiquidGlassSettings settings;
}
