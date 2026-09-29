// A node's decorated box: decoration.dart builds it as a background
// DecoratedBox with a BoxDecoration (plus a foreground one for a press mask),
// not a Container (specs/157). Tests that looked for `Container` find it here.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Every node box: background DecoratedBoxes painting a BoxDecoration.
final Finder nodeBoxes = find.byWidgetPredicate(isNodeBox);

bool isNodeBox(Widget w) =>
    w is DecoratedBox && w.position == DecorationPosition.background && w.decoration is BoxDecoration;

/// The foreground decoration (a press mask) at or under [of].
Finder foregroundBox(Finder of) => find.descendant(
  of: of,
  matchRoot: true,
  matching: find.byWidgetPredicate((w) => w is DecoratedBox && w.position == DecorationPosition.foreground),
);

/// The background colour of a node box, null for any other widget.
Color? nodeBoxColor(Widget w) => isNodeBox(w) ? ((w as DecoratedBox).decoration as BoxDecoration).color : null;
