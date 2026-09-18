import 'package:fjs_go/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> settleFjs(WidgetTester tester) async {
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.pumpAndSettle();
  }

  testWidgets('macOS fjs-go connects to hello-fjs and navigates a split page',
      (tester) async {
    await app.main();
    await settleFjs(tester);

    // the project name lives in the dev menu behind the floating button
    await tester.tap(find.byTooltip('开发菜单'));
    await tester.pumpAndSettle();
    expect(find.text('hello-fjs'), findsOneWidget);
    await tester.tapAt(const Offset(20, 20)); // modal barrier
    await tester.pumpAndSettle();

    expect(find.text('内置组件'), findsWidgets);
    expect(find.text('<swiper>'), findsOneWidget);

    await tester.tap(find.text('<swiper>'));
    await settleFjs(tester);

    expect(find.text('轮播第 1 屏'), findsWidgets);
    expect(find.text('轮播'), findsWidgets);

    final navigator = tester.state<NavigatorState>(find.byType(Navigator).last);
    navigator.pop();
    await settleFjs(tester);

    expect(find.text('轮播第 1 屏'), findsNothing);
    expect(find.text('视图容器'), findsOneWidget);
  });

  testWidgets('fjs-go opens the hello-fjs virtualized list quickly',
      (tester) async {
    await app.main();
    await settleFjs(tester);

    expect(find.text('<list-view>'), findsOneWidget);

    final started = DateTime.now();
    await tester.tap(find.text('<list-view>'));

    var found = false;
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 16));
      if (find.text('列表项 1').evaluate().isNotEmpty) {
        found = true;
        break;
      }
    }
    final elapsed = DateTime.now().difference(started).inMilliseconds;
    // Keep this visible in device logs; it tracks the user-facing slow path.
    // ignore: avoid_print
    print('hello-fjs list-view first content in ${elapsed}ms');

    expect(found, isTrue);
    expect(elapsed, lessThan(1000));

    // Scrolling near the loaded tail appends another batch. Repeated short
    // drags model an ordinary finger scroll; no existing item changes index.
    for (var i = 0; i < 8; i++) {
      await tester.drag(find.byType(ListView).last, const Offset(0, -600));
      await tester.pumpAndSettle();
    }
    expect(find.text('列表项 70'), findsWidgets);
  });
}
