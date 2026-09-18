// Flutter side of the fjs module "iconmind": the widget behind
// <icon-mind name="agent" />.
//
// fjs autolinks this — the generated host depends on this package and calls
// FjsIconmind.register(engine) before runApp, because the module's
// package.json says so in its "fjs.flutter" field.
//
// The icons this app draws are generated at build time by the module's
// prepare hook (prepare.mjs), which scans the app's sources for
// <icon-mind name="…" /> and writes the shapes it finds. fjs copies that
// file into the host's assets, so an app carries exactly the icons its pages
// name — no list in Dart, and nothing for the app to configure.
import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter/widgets.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:path_drawing/path_drawing.dart';

/// One drawn shape: its path data, and whether it closes.
///
/// `closed` is what makes duotone derivable instead of a second drawing —
/// a closed shape takes the 20% tint fill, an open one the 20% halo.
class IconShape {
  const IconShape(this.d, this.closed);
  final String d;
  final bool closed;
}

class FjsIconmind {
  static const String _assetPath = 'assets/fjs/modules/iconmind/icons.json';
  static const String _devPath = '/modules/iconmind/icons.json';

  /// Stroke width per weight — the same three IconMind draws with, and the
  /// same numbers `STROKE` carries on the JS side.
  static const Map<String, double> _weights = {
    'thin': 1.25,
    'regular': 1.75,
    'bold': 2.5,
  };

  static Map<String, List<IconShape>>? _icons;
  static Future<Map<String, List<IconShape>>>? _loading;
  static FjsEngine? _engine;
  static int _engineGeneration = -1;

  /// Registers what this module adds to the engine: the <icon-mind /> tag,
  /// and a host function that answers what the loaded set contains — handy
  /// from `fjs eval`, and the reason JS needs no copy of the names.
  static void register(FjsEngine engine) {
    if (!identical(_engine, engine)) {
      _engine?.removeListener(_invalidateOnReload);
      _engine = engine;
      _engineGeneration = engine.tree.generation;
      engine.addListener(_invalidateOnReload);
    }
    engine.components.register('icon-mind', _build);
    engine.host.register('iconmind.count', (args) => _icons?.length ?? 0);
    engine.host.register(
      'iconmind.has',
      (args) => _icons?.containsKey(args.isEmpty ? '' : '${args.first}') ?? false,
    );
    // warm the first load so the first icon paints without a frame of blank
    unawaited(_load());
  }

  static Future<Map<String, List<IconShape>>> _load() =>
      _loading ??= _fetch(_engineGeneration);

  /// While `fjs dev` is connected the set comes from the dev server, so
  /// re-running the prepare hook shows the new icons without a rebuild;
  /// otherwise it comes from the asset the build copied in — read through
  /// the engine's assetBundle, so a release build served from the network
  /// finds it there too. The engine
  /// owns both the address and the HttpClient — this module needs neither.
  static Future<Map<String, List<IconShape>>> _fetch(int generation) async {
    final engine = _engine;
    final dev = engine?.devUri;
    final source = dev == null
        ? await (engine?.assetBundle ?? rootBundle).loadString(_assetPath)
        : await engine!.fetchString(dev.replace(path: _devPath));
    final icons = _parse(source);
    // a reload — or the dev connection landing after register() warmed the
    // asset — invalidated this load while it was in flight, so its icons
    // may already be stale: hand them to the waiting build, cache nothing
    if (generation == _engineGeneration) _icons = icons;
    return icons;
  }

  static Map<String, List<IconShape>> _parse(String source) {
    final raw = json.decode(source) as Map<String, dynamic>;
    return <String, List<IconShape>>{
      for (final entry in raw.entries)
        entry.key: [
          for (final shape in entry.value as List)
            IconShape((shape as List)[0] as String, shape[1] == 1),
        ],
    };
  }

  static void _invalidateOnReload() {
    final engine = _engine;
    if (engine == null) return;
    final generation = engine.tree.generation;
    if (generation == _engineGeneration) return;
    _engineGeneration = generation;
    _icons = null;
    _loading = null;
  }

  /// The widget behind <icon-mind />. Declared as a ComponentBuilder so the
  /// parameters are typed by inference: `node` carries the tag's props (the
  /// flat JSON object JS sent), `children` the already-built children, and
  /// `dispatch` reports events back to JS.
  static final ComponentBuilder _build = (context, node, children, dispatch) {
    final props = node.props;
    final name = props['name']?.toString() ?? '';
    final size = _double(props['size']) ?? 24;
    final icon = _IconMind(
      name: name,
      size: size,
      // Same rule as the web stand-in's `stroke="color ?? currentColor"`:
      // the prop wins, otherwise the cascade's own `color`. Read it through
      // `styleMap`, not props['style'] — computed styles are interned and
      // arrive on the node itself, so props carries one only for the legacy
      // hand-encoded path. That is what a parent's `color: var(--fjs-…)`
      // rides in on: the JS style engine folds inheritance into every
      // element's computed style, so the icon sees it like text does.
      color: parseColor(props['color']) ??
          parseColor(node.styleMap['color']) ??
          const Color(0xFF111827),
      duotone: props['variant'] == 'duotone',
      stroke: _double(props['strokeWidth']) ??
          _weights[props['weight']?.toString()] ??
          _weights['regular']!,
    );
    final hasOwnTap = props['onTap'] == true || props['onClick'] == true;
    final hasOwnLongPress = props['onLongPress'] == true;
    if (!hasOwnTap && !hasOwnLongPress) return icon;
    return GestureDetector(
      onTap: hasOwnTap ? () => dispatch(node.id, FjsEvent.tap) : null,
      onLongPress: hasOwnLongPress ? () => dispatch(node.id, FjsEvent.longPress) : null,
      child: icon,
    );
  };

  /// Props cross the boundary as JSON, so a number may arrive as `28` or as
  /// `"28px"` — the same leniency the style engine applies.
  static double? _double(Object? value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value.replaceAll('px', '').trim());
    return null;
  }
}

/// Waits for the set the first time, then paints straight from the cache —
/// so scrolling a list of icons never rebuilds through a FutureBuilder.
class _IconMind extends StatelessWidget {
  const _IconMind({
    required this.name,
    required this.size,
    required this.color,
    required this.duotone,
    required this.stroke,
  });

  final String name;
  final double size;
  final Color color;
  final bool duotone;
  final double stroke;

  Widget _paint(Map<String, List<IconShape>>? icons) {
    final shapes = icons?[name];
    // an unknown name draws nothing, but keeps the space the icon would
    // have taken so the layout still reads
    if (shapes == null) return SizedBox(width: size, height: size);
    return CustomPaint(
      size: Size.square(size),
      painter: _IconPainter(
        shapes: shapes,
        color: color,
        stroke: stroke,
        scale: size / 24.0,
        duotone: duotone,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final loaded = FjsIconmind._icons;
    if (loaded != null) return _paint(loaded);
    return FutureBuilder<Map<String, List<IconShape>>>(
      future: FjsIconmind._load(),
      builder: (context, snapshot) => _paint(snapshot.data),
    );
  }
}

/// Paints IconMind's own shapes: strokes with round caps and joins, plus the
/// duotone layer underneath. Same rules as the web stand-in.
class _IconPainter extends CustomPainter {
  const _IconPainter({
    required this.shapes,
    required this.color,
    required this.stroke,
    required this.scale,
    required this.duotone,
  });

  final List<IconShape> shapes;
  final Color color;
  final double stroke;
  final double scale;
  final bool duotone;

  /// Path data strings are shared across every use of an icon, so this map
  /// stays as large as the number of distinct shapes actually painted.
  static final Map<String, Path> _paths = {};

  static Path _pathOf(String d) => _paths[d] ??= parseSvgPathData(d);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(scale);
    if (duotone) {
      // ignore: deprecated_member_use — withValues needs Flutter 3.27
      final tint = color.withOpacity(0.2);
      for (final shape in shapes) {
        final paint = Paint()..color = tint;
        if (shape.closed) {
          paint.style = PaintingStyle.fill;
        } else {
          paint
            ..style = PaintingStyle.stroke
            ..strokeWidth = stroke + 3
            ..strokeCap = StrokeCap.round
            ..strokeJoin = StrokeJoin.round;
        }
        canvas.drawPath(_pathOf(shape.d), paint);
      }
    }
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    for (final shape in shapes) {
      canvas.drawPath(_pathOf(shape.d), paint);
    }
  }

  @override
  bool shouldRepaint(_IconPainter old) =>
      old.shapes != shapes ||
      old.color != color ||
      old.stroke != stroke ||
      old.scale != scale ||
      old.duotone != duotone;
}

/// `unawaited` without pulling in package:async for one call.
void unawaited(Future<void> future) {}
