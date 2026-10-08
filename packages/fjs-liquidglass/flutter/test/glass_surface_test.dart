// The app half of the glass layer. The web twin is
// ../../components/GlassSurfaceWeb.vue; both read the same props with the
// same defaults (radius 0, blur 20, refraction 0, tint white 20% / 10% dark),
// which is what the first group pins.
import 'package:flutter/widgets.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fjs_liquidglass/fjs_liquidglass.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

void main() {
  group('props -> spec', () {
    test('defaults use the iOS 27 light material and the web blur default', () {
      final spec = FjsLiquidglass.specFor(const {});
      expect(spec.radius, 0);
      expect(spec.settings.frost, 14); // blur 20 * 0.7 == the preset's frost
      expect(spec.settings.glassColor, LiquidGlassSettings.ios27Light.glassColor);
      expect(spec.quality, GlassQuality.standard);
    });

    test('dark picks the dark material, an explicit tint wins', () {
      expect(
        FjsLiquidglass.specFor(const {'dark': true}).settings.glassColor,
        LiquidGlassSettings.ios27Dark.glassColor,
      );
      expect(
        FjsLiquidglass.specFor(const {'tint': '#FF0000'}).settings.glassColor,
        const Color(0xFFFF0000),
      );
    });

    test('refraction 0 stays on the lightweight (frosted) quality tier', () {
      expect(
        FjsLiquidglass.specFor(const {'refraction': 0}).quality,
        GlassQuality.standard,
      );
      expect(
        FjsLiquidglass.specFor(const {'refraction': 0.6}).quality,
        GlassQuality.premium,
      );
    });

    test('numbers arrive as int or double, and refraction is clamped', () {
      final spec = FjsLiquidglass.specFor(const {
        'radius': 26,
        'blur': 10,
        'refraction': 5,
      });
      expect(spec.radius, 26.0);
      expect(spec.settings.frost, 7);
      expect(spec.settings.thickness, 46); // clamped to 1.0 => 12 + 34
    });
  });

  group('builder', () {
    testWidgets('renders a glass layer that fills its box', (tester) async {
      final builder = FjsLiquidglass.builder;
      final node = MirrorNode(1, 'glass-surface')
        ..props = {'radius': 26, 'blur': 20, 'refraction': 0};

      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: Center(
            child: SizedBox(
              width: 200,
              height: 56,
              child: Builder(
                builder: (context) => builder(context, node, const [], (_, __, {text}) {}),
              ),
            ),
          ),
        ),
      );

      expect(find.byType(GlassContainer), findsOneWidget);
      expect(tester.getSize(find.byType(GlassContainer)), const Size(200, 56));
    });
  });
}
