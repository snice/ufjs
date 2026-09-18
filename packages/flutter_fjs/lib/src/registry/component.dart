// Registry for host-defined (Dart) components. JS code uses the tag like
// any built-in: `h('my-chart', {...})` or `<my-chart :style="..."/>` — the
// renderer consults this registry for unknown tags before falling back to
// `view`. This is the extension point for platform views too: register a
// builder that returns AndroidView/UiKitView.
import 'package:flutter/widgets.dart';

import '../mirror_tree.dart';

/// Builds a widget for a node with the registered tag.
///
/// [node] carries props/text/children ids; [children] are the already-built
/// Flutter widgets of the node's children; [dispatch] reports events back to
/// JS (see FjsEvent); [context] is valid only during the build.
typedef ComponentBuilder =
    Widget Function(
      BuildContext context,
      MirrorNode node,
      List<Widget> children,
      void Function(int nodeId, int eventType, {String? text}) dispatch,
    );

class ComponentRegistry {
  final Map<String, ComponentBuilder> _builders = {};

  /// Registers [builder] under [tag]. JS sees the tag verbatim; props come
  /// through as the flat JSON object sent via setProps.
  void register(String tag, ComponentBuilder builder) {
    _builders[tag] = builder;
  }

  void unregister(String tag) => _builders.remove(tag);

  ComponentBuilder? lookup(String tag) => _builders[tag];

  bool get isEmpty => _builders.isEmpty;
}
