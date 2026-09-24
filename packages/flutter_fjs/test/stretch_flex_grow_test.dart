// A two-pass stretch row (stretch_flex.dart) re-measures when an item's
// content grows on its own (specs/122). The second pass hands items a tight
// cross constraint, which made each one a relayout boundary: vant's
// autosize textarea grew inside its cell while the cell kept its first
// height.
import 'package:flutter/material.dart';
import 'package:flutter_fjs/src/render/stretch_flex.dart';
import 'package:flutter_test/flutter_test.dart';

class _Grower extends StatefulWidget {
  const _Grower({super.key});

  @override
  State<_Grower> createState() => _GrowerState();
}

class _GrowerState extends State<_Grower> {
  double height = 20;

  // setState here rebuilds this widget only — the row above is never
  // rebuilt, exactly like a TextField adding a line
  void grow(double to) => setState(() => height = to);

  @override
  Widget build(BuildContext context) => SizedBox(height: height);
}

Widget _row(GlobalKey<_GrowerState> grower, {required bool probe}) {
  // the value column of a vant cell: flex 1, stretched to the line
  Widget item = Column(
    mainAxisSize: MainAxisSize.min,
    children: [_Grower(key: grower)],
  );
  if (probe) item = FjsCrossLineItem(child: item);
  return MaterialApp(
    home: SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 300,
            // height unbounded (the scroller): the row measures its line
            child: FjsFlex(
              direction: Axis.horizontal,
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              measureCross: true,
              children: [
                const SizedBox(width: 40, height: 10),
                Expanded(child: item),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

void main() {
  testWidgets('the line follows an item that grows by itself', (
    tester,
  ) async {
    final grower = GlobalKey<_GrowerState>();
    await tester.pumpWidget(_row(grower, probe: true));
    expect(tester.getSize(find.byType(FjsFlex)).height, 20);

    grower.currentState!.grow(60);
    await tester.pump();
    expect(tester.getSize(find.byType(FjsFlex)).height, 60);

    grower.currentState!.grow(30);
    await tester.pump();
    expect(tester.getSize(find.byType(FjsFlex)).height, 30);
  });

  testWidgets('without the item the line is stuck (the bug it fixes)', (
    tester,
  ) async {
    final grower = GlobalKey<_GrowerState>();
    await tester.pumpWidget(_row(grower, probe: false));
    grower.currentState!.grow(60);
    await tester.pump();
    expect(tester.getSize(find.byType(FjsFlex)).height, 20);
    // the stuck item overflows its line — Flutter reports it
    expect(tester.takeException(), isFlutterError);
  });
}
