// Event wiring shared by every tag: which props mean "this node is tappable",
// and the GestureDetector that reports taps back to JS.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../widgets/dispatch.dart';
import 'style.dart';
import 'touch.dart';

/// Whether the node asked for tap handling. `onClick` is the alias Vue
/// templates reach for; both arrive as a `true` prop, not a function.
bool hasTapEvent(MirrorNode node) =>
    node.props['onTap'] == true || node.props['onClick'] == true;

void dispatchTap(MirrorNode node, FjsDispatch dispatch) =>
    dispatch(node.id, FjsEvent.tap);

/// Wraps [content] in the input layers the node asked for: the touch-event
/// listener (touch.dart) when it has touch handlers or a `touch-action`,
/// then a [GestureDetector] when it listens for taps or long presses.
/// A node that ignores input is returned untouched, adding no hit-test
/// entry at all.
///
/// The `:active` press state does NOT ride here — it is raw pointer input,
/// owned by the renderer's press wrapper, so it can show up before any
/// recognizer has won the arena.
Widget gestureNode(
  MirrorNode node,
  FjsStyle style,
  Widget content,
  FjsDispatch dispatch,
) {
  // raw touch first, so it sits deeper in the tree than the tap detector:
  // the arena resolves depth-first, which is how a node's own
  // `touch-action` gets to claim a drag before anything above it does
  final withTouch = touchNode(node, style, content, dispatch);
  // A disabled control dispatches nothing. The widgets gate their own
  // handlers already (a disabled TextButton has no onPressed), but this
  // detector sits ABOVE them and would otherwise win the arena precisely
  // because the inner recognizer stepped aside. `loading` is a button's
  // second inert state — kept tag-scoped, since the prop means nothing on
  // any other tag.
  final inert =
      fjsBool(node.props['disabled']) ||
      (node.tag == 'button' && fjsBool(node.props['loading']));
  final onTap = hasTapEvent(node) && !inert
      ? () => dispatch(node.id, FjsEvent.tap)
      : null;
  final onLongPress = node.props['onLongPress'] == true && !inert
      ? () => dispatch(node.id, FjsEvent.longPress)
      : null;
  if (onTap == null && onLongPress == null) return withTouch;
  return GestureDetector(
    onTap: onTap,
    onLongPress: onLongPress,
    behavior: HitTestBehavior.opaque,
    child: withTouch,
  );
}
