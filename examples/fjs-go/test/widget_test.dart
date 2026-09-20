// Smoke test: fjs go boots into the connect screen when nothing is known.
//
// Replaces the Flutter scaffold's counter test, which referenced a MyApp
// this app never had and only ever surfaced as an analyzer error.
//
// Pumping the real app needs no mocks: the connect screen's UDP discovery
// is best-effort by construction (discovery.dart swallows the bind failure
// and the missing platform channel), and the engine is only built once a
// server actually connects.
import 'package:flutter_test/flutter_test.dart';

import 'package:fjs_go/main.dart';
import 'package:fjs_go/src/recent_servers.dart';

void main() {
  late RecentServers recents;

  setUpAll(() async {
    // real file IO, so it runs outside testWidgets' fake async zone
    recents = await RecentServers.load();
  });

  testWidgets('boots into the connect screen', (WidgetTester tester) async {
    await tester.pumpWidget(FjsGoApp(recents: recents));
    // pumpAndSettle would time out: the connect screen keeps a PulseDot
    // (the 附近的服务器 "搜索中" indicator) animating on repeat forever, and
    // the screen builds synchronously — one pump past the first frame is
    // all the headline needs.
    await tester.pump();

    // the connect screen's headline. The scan hero is mobile-only and the
    // recent-servers list depends on the machine — this line always shows.
    expect(find.text('开始调试'), findsOneWidget);
  });
}
