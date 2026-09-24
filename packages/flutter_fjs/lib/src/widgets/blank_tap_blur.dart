// A tap on blank page blurs the focused input and drops the keyboard, as a
// browser does (specs/124).
//
// Flutter's TextField has its own tap-outside, but for touch on Android /
// iOS / ohos it deliberately keeps focus, imitating native apps — so the
// page's `@blur` never came. Rather than teach every input what "outside"
// means, one tap recognizer sits at the page root and lets the gesture
// arena decide what is blank: every node that handles a tap (`@tap`,
// buttons, switches, another input) is deeper, and the deepest recognizer
// wins. A drag is not a tap — the recognizer drops out past the slop, and a
// scroller takes the pointer — so scrolling keeps the keyboard up, as in a
// browser. Only at the root: a recognizer on every view would win against
// its ancestors' `@tap`.
//
// The one hole is a node with only touch listeners, which never claims a
// tap: pointer_claim.dart covers it.
//
// Two roots, not one: FjsView's page, and the overlay host that lifts
// `position: fixed` popups into the root Overlay — a tap inside a vant
// popup never passes through the page's hit-test path.
import 'package:flutter/widgets.dart';

import '../render/pointer_claim.dart';

class FjsBlankTapBlur extends StatefulWidget {
  const FjsBlankTapBlur({super.key, this.opaque = true, required this.child});

  /// Whether a tap where [child] paints nothing still counts. True for the
  /// page: a page shorter than the screen takes the tap below its last
  /// node. False for the overlay host, which covers the screen whether or
  /// not a popup is open and must let such taps through to the page.
  final bool opaque;

  final Widget child;

  @override
  State<FjsBlankTapBlur> createState() => _FjsBlankTapBlurState();
}

class _FjsBlankTapBlurState extends State<FjsBlankTapBlur> {
  /// The pointer of the press in progress. TapGestureRecognizer's callbacks
  /// do not carry it, and the Listener sees the down before the tap ends.
  int? _pointer;

  void _onTap() {
    final pointer = _pointer;
    if (pointer != null && pointerClaimed(pointer)) return;
    FocusManager.instance.primaryFocus?.unfocus();
  }

  @override
  Widget build(BuildContext context) => Listener(
    onPointerDown: (event) => _pointer = event.pointer,
    child: GestureDetector(
      behavior: widget.opaque
          ? HitTestBehavior.opaque
          : HitTestBehavior.deferToChild,
      onTap: _onTap,
      child: widget.child,
    ),
  );
}
