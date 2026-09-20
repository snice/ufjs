import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../registry/component.dart';
import '../render/decoration.dart';
import '../render/style.dart';
import '../widgets/dispatch.dart';

typedef FjsNodeBuilder = Widget Function(BuildContext context, MirrorNode node);

class FjsNodeAdapterContext {
  const FjsNodeAdapterContext({
    required this.flutterContext,
    required this.tree,
    required this.node,
    required this.style,
    required this.childNodes,
    required this.buildChildren,
    required this.buildNode,
    required this.dispatch,
    required this.pressed,
    required this.isRoot,
    this.keepsBox = false,
    this.registry,
  });

  final BuildContext flutterContext;
  final MirrorTree tree;
  final MirrorNode node;
  final FjsStyle style;
  final List<MirrorNode> childNodes;
  final List<Widget> Function() buildChildren;
  final FjsNodeBuilder buildNode;
  final FjsDispatch dispatch;
  final bool pressed;
  final bool isRoot;

  /// See [decorateNode]'s `keepsBox` — per-node, not per interned style.
  final bool keepsBox;

  /// Dart-registered components (engine.registerComponent). An adapter that
  /// mounts a subtree of its own — `modal`'s sheet is the one — has to pass
  /// this on, or a custom tag inside it would fall back to a plain view.
  final ComponentRegistry? registry;
}

abstract class FjsNodeAdapter {
  const FjsNodeAdapter();

  String get tag;

  Widget build(FjsNodeAdapterContext context);

  Widget decorate(FjsNodeAdapterContext context, Widget content) {
    return decorateNode(context.style, content, keepsBox: context.keepsBox);
  }
}
