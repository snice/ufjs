// Which pointers went down on a node listening for touch events.
//
// A tap on blank page blurs the focused input (blank_tap_blur.dart), and
// "blank" is decided by the gesture arena: any node with a tap recognizer —
// `@tap`, a button, a switch, another input — is deeper and wins. A node
// with only touch listeners has no recognizer that claims a tap, so the
// arena alone would call it blank; vant's clear icon (a bare touchstart)
// then blurred the field it had just cleared, where a browser keeps focus
// through its touchstart preventDefault. This set is how the page-level
// detector learns the press was the page's. See specs/124.
//
// Written by touch.dart on pointer down, read on the same pointer's tap —
// always later, since a tap completes on the up.
const int _kKeep = 16;

final Set<int> _claimed = <int>{};

/// Records that [pointer] went down on a node with touch listeners.
void markPointerClaimed(int pointer) {
  // Pointer ids only grow, so an id far behind the newest belongs to a
  // gesture long over; dropping those keeps the set to a handful.
  _claimed
    ..removeWhere((p) => p < pointer - _kKeep)
    ..add(pointer);
}

/// Whether [pointer] went down on a node with touch listeners.
bool pointerClaimed(int pointer) => _claimed.contains(pointer);
