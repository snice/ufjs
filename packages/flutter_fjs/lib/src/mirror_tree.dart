// Mirror tree: the Dart-side copy of the JS virtual node tree, updated by
// applying UI op frames. The widget layer walks it to build Flutter
// widgets. IDs and semantics mirror fjs-runtime's node handles.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart'
    show ChangeNotifier, Listenable, debugPrint;
import 'package:flutter/widgets.dart' show GlobalKey;

import 'canvas/canvas_module.dart';
import 'canvas/display_list.dart';
import 'ui_ops.dart';

/// One interned computed style: the decoded map, decoded once no matter how
/// many nodes resolve to it. Identity is meaningful — two nodes sharing a
/// style share this object, which is what lets the widget layer cache the
/// parsed Flutter values on it.
class FjsStyleEntry {
  FjsStyleEntry(this.id, this.map);

  final int id;
  final Map<String, Object?> map;
}

class MirrorNode {
  MirrorNode(this.id, this.tag);

  final int id;
  String tag;
  String? text;
  Map<String, Object?> props = const {};
  final List<int> children = [];

  /// Interned computed style, set by SET_STYLE. Null when the node has never
  /// received one — including every node built by the legacy path that
  /// carried the style inside [props].
  FjsStyleEntry? style;

  /// The `:active` variant, when the node matched a pressed rule.
  FjsStyleEntry? activeStyle;

  /// The `:hover` variant (SET_HOVER_STYLE, op 12), when the node matched a
  /// hover rule. Desktop mouse only; never set on touch devices.
  FjsStyleEntry? hoverStyle;

  /// Retained drawing commands, for `canvas` nodes only. Created on the
  /// first CANVAS op so every other node costs nothing.
  FjsCanvasDisplayList? canvas;

  /// Op 11 command chunks (WebGL, executed by the @ufjs/webgl module), for
  /// `canvas` nodes only. This side keeps them as opaque bytes — the module
  /// drains and executes them into the node's GL framebuffer; nothing is
  /// interpreted here. Empty for every node that never touched webgl.
  final List<Uint8List> webglChunks = <Uint8List>[];

  /// Cache slot for the widget layer's per-node view. It lives here so it
  /// dies with the node; nothing in this file interprets it. Flutter skips
  /// rebuilding a child only when handed back the IDENTICAL widget instance
  /// (`Widget.==` is `@nonVirtual` identity), so reusing one is the whole
  /// mechanism behind per-node rebuilds.
  Object? view;

  /// The mounted element (a BuildContext) that last built this node, set by
  /// the widget layer. Opaque here like [view]; the geometry host module
  /// (geometry.dart) reads the node's render box through it to answer
  /// `getBoundingClientRect()`.
  Object? element;

  /// The style map to read, preferring the interned one. The [props]
  /// fallback keeps hand-encoded frames, replayed logs and Dart-registered
  /// components working.
  Map<String, Object?> get styleMap {
    final interned = style;
    if (interned != null) return interned.map;
    final legacy = props['style'];
    return legacy is Map<String, Object?> ? legacy : const {};
  }

  /// The pressed style map, or null when the node has none.
  Map<String, Object?>? get activeStyleMap {
    final interned = activeStyle;
    if (interned != null) return interned.map;
    if (style != null) return null; // interned path: no active means none
    final legacy = props['activeStyle'];
    return legacy is Map<String, Object?> ? legacy : null;
  }

  /// The hover style map, or null when the node has none. Interned-only:
  /// unlike `:active` there is no legacy props spelling — hover arrived with
  /// op 12, after styles were already interned.
  Map<String, Object?>? get hoverStyleMap => hoverStyle?.map;
}

class UiOpException implements Exception {
  UiOpException(this.message);
  final String message;
  @override
  String toString() => 'UiOpException: $message';
}

/// A node's own change signal. The widget layer listens per node, so a text
/// edit rebuilds one subtree instead of the page.
class _NodeSignal extends ChangeNotifier {
  void ping() => notifyListeners();
}

/// Applies op frames and notifies listeners (the engine wires this to
/// setState). ids: node handles from JS; 0 is the root container.
class MirrorTree {
  MirrorTree({void Function(String message)? debugLog}) : _debugLog = debugLog;

  /// Optional sink for op-stream diagnostics (specs/070). The engine wires
  /// it to its log channel so the device-side log sheet can show what the
  /// op stream actually contained — debugPrint dies with the attach.
  final void Function(String message)? _debugLog;

  final Map<int, MirrorNode> _nodes = {};
  final List<int> _rootChildren = [];
  final Map<int, int> _parentOf = {};

  /// Interned styles, keyed by the id the JS writer assigned. Bounded by the
  /// writer's own table cap; see ui_ops.dart for why eviction is safe.
  final Map<int, FjsStyleEntry> _styles = {};

  /// Created lazily, only for nodes the widget layer actually renders.
  final Map<int, _NodeSignal> _signals = {};

  /// Global keys, handed out ONLY to nodes that carry an `id` prop.
  ///
  /// A global key costs a slot in Flutter's registry, so every node getting
  /// one would be wasteful — but a node the page named with `id` is exactly
  /// the node something else needs to reach: `scroll-into-view` measures it,
  /// `<label for>` activates it. See specs/009-scroll-swiper-props/plan.md
  /// §3.8.
  final Map<int, GlobalKey> _globalKeys = {};

  /// Ids touched by the frames applied since the last [flushDirty].
  final Set<int> _dirty = {};
  int _version = 0;
  int _generation = 0;

  /// Monotonic change counter; widgets watch it to decide rebuilds.
  int get version => _version;

  /// How many nodes JS has built. The dev perf overlay shows it: on this
  /// pipeline the node count is what most of the per-frame cost scales with.
  int get nodeCount => _nodes.length;

  /// The change signal for one node. Listening per node is what lets a
  /// change rebuild its own subtree instead of the whole page.
  Listenable listenableFor(int id) => _signals.putIfAbsent(id, _NodeSignal.new);

  /// Fires the per-node signals for everything the applied frames touched.
  ///
  /// Deliberately not fired from inside [applyFrame]: a single JS event can
  /// drain several op frames, and a listener must never see a half-applied
  /// one. The host calls this once, when it is ready to rebuild.
  void flushDirty() {
    if (_dirty.isEmpty) return;
    final ids = List<int>.of(_dirty);
    _dirty.clear();
    for (final id in ids) {
      _signals[id]?.ping();
    }
  }

  /// Marks a node as needing a rebuild. Its PARENT is marked too, because a
  /// parent's build reads things about its children: [FjsNodeRenderer] drops
  /// hidden children (`display: none`, empty text) when it collects them, and
  /// flex.dart reads each child's `position` and `flexGrow` while laying the
  /// parent out. Two subtrees instead of one is still O(1) against the whole
  /// page; narrowing it to the keys a parent actually reads can come later.
  void _touch(int? id) {
    if (id == null) return;
    _dirty.add(id);
    _markParent(_parentOf[id]);
  }

  /// Marks [parent] dirty — and, when it is a span (a `text` inside a
  /// `text`), every text above it up to the paragraph root. A paragraph is
  /// built from its spans' MirrorNodes, not from their views
  /// (widgets/text.dart), so a change three spans deep has to rebuild the
  /// root or the app keeps showing the old words while the web updates.
  /// Outside nested text this stops after one step, as before. An HTML
  /// block box built as one paragraph is a root the same way.
  void _markParent(int? parent) {
    var id = parent;
    while (id != null && id != 0) {
      _dirty.add(id);
      if (_nodes[id]?.tag != 'text') return;
      final up = _parentOf[id];
      if (up == null || up == 0) return;
      final upNode = _nodes[up];
      // an HTML block box can be the paragraph root too (node_adapters.dart
      // _ViewNodeAdapter): its inline runs are spans of ITS paragraph
      if (upNode?.tag == 'view' && upNode?.props['htmlBlock'] == true) {
        _dirty.add(up);
        return;
      }
      if (upNode?.tag != 'text') return;
      id = up;
    }
  }

  /// Bumped by [clear]; a new generation means the tree was rebuilt from
  /// scratch, so stateful widgets keyed on it must be recreated (otherwise
  /// Flutter reuses Element/State at matching positions and stale input
  /// text / switch state leaks across reloads).
  int get generation => _generation;
  List<int> get rootChildren => List.unmodifiable(_rootChildren);
  MirrorNode? node(int id) => _nodes[id];

  /// The global key for a node the page gave an `id`, creating it on first
  /// ask. Its holder can then find the node's render object.
  GlobalKey globalKeyFor(int id) =>
      _globalKeys.putIfAbsent(id, () => GlobalKey());

  /// The key a node already has, without creating one.
  GlobalKey? existingGlobalKey(int id) => _globalKeys[id];

  void applyFrame(Uint8List frame) {
    final bd = ByteData.sublistView(frame);
    var p = 0;

    void check(int need) {
      if (p + need > frame.length) {
        throw UiOpException(
          'truncated op frame at offset $p (need $need, '
          'have ${frame.length - p})',
        );
      }
    }

    while (p < frame.length) {
      check(1);
      final op = frame[p++];
      switch (op) {
        case UiOpCode.create:
          check(6);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          final tagLen = bd.getUint16(p, Endian.little);
          p += 2;
          check(tagLen);
          final tag = utf8.decode(frame.sublist(p, p + tagLen));
          p += tagLen;
          _nodes[id] = MirrorNode(id, tag);
          // not marked: a freshly created node is not mounted yet
          break;

        case UiOpCode.remove:
          check(4);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          // the parent has to re-collect its children, and it is about to
          // stop existing in _parentOf, so read it first
          _markParent(_parentOf[id]);
          _removeDeep(id);
          break;

        case UiOpCode.insert:
          check(12);
          final parent = bd.getUint32(p, Endian.little);
          final child = bd.getUint32(p + 4, Endian.little);
          final index = bd.getUint32(p + 8, Endian.little);
          p += 12;
          // move semantics: detach from the previous parent first. Re-inserts
          // are legal (keyed moves, and a fresh VM re-inserting the same root
          // id into a replayed tree) — without the detach the child would end
          // up mounted twice.
          // both ends of a move need rebuilding, and the old parent is only
          // knowable before the detach
          _markParent(_parentOf[child]);
          _markParent(parent);
          _detach(child);
          final target = _childList(parent);
          // clamp instead of throwing: Vue/patch can produce sparse indexes
          final at = index >= target.length ? target.length : index;
          target.insert(at, child);
          _parentOf[child] = parent;
          break;

        case UiOpCode.removeChild:
          check(8);
          final parent = bd.getUint32(p, Endian.little);
          p += 4;
          final child = bd.getUint32(p, Endian.little);
          p += 4;
          _childList(parent).remove(child);
          if (_parentOf[child] == parent) _parentOf.remove(child);
          _markParent(parent);
          break;

        case UiOpCode.setText:
          check(8);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          final textLen = bd.getUint32(p, Endian.little);
          p += 4;
          check(textLen);
          final text = utf8.decode(frame.sublist(p, p + textLen));
          p += textLen;
          if (_nodes[id] != null) {
            _nodes[id]!.text = text;
            _touch(id);
          }
          break;

        case UiOpCode.setProps:
          check(8);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          final jsonLen = bd.getUint32(p, Endian.little);
          p += 4;
          check(jsonLen);
          final json = utf8.decode(frame.sublist(p, p + jsonLen));
          p += jsonLen;
          final node = _nodes[id];
          if (node != null) {
            // patch semantics: the JS side sends one SetProps per changed
            // key (e.g. an event marker, then a recomputed style), so merge
            // instead of replacing — a replace would drop earlier keys like
            // onTap when the style engine flushes.
            final next = Map<String, Object?>.of(node.props);
            next.addAll(jsonDecode(json) as Map<String, Object?>);
            next.removeWhere((_, v) => v == null);
            node.props = next;
            _touch(id);
          }
          break;

        case UiOpCode.defineStyle:
          check(8);
          final styleId = bd.getUint32(p, Endian.little);
          p += 4;
          final jsonLen = bd.getUint32(p, Endian.little);
          p += 4;
          check(jsonLen);
          final json = utf8.decode(frame.sublist(p, p + jsonLen));
          p += jsonLen;
          // decoded once per distinct style, not once per node using it
          _styles[styleId] = FjsStyleEntry(
            styleId,
            jsonDecode(json) as Map<String, Object?>,
          );
          break;

        case UiOpCode.setStyle:
          check(12);
          final id = bd.getUint32(p, Endian.little);
          final styleId = bd.getUint32(p + 4, Endian.little);
          final activeId = bd.getUint32(p + 8, Endian.little);
          p += 12;
          final node = _nodes[id];
          if (node != null) {
            // an id this decoder never saw defined means the frame stream
            // did not start at an epoch boundary (a mid-session frame log
            // replayed into a fresh tree). Keep the style the node already
            // has rather than blanking it.
            if (styleId == 0) {
              node.style = null;
            } else {
              final entry = _styles[styleId];
              if (entry != null) {
                node.style = entry;
              } else {
                assert(() {
                  debugPrint(
                    '[fjs] SET_STYLE references undefined style '
                    '$styleId; keeping the current style on node $id',
                  );
                  return true;
                }());
              }
            }
            if (activeId == 0) {
              node.activeStyle = null;
            } else {
              final active = _styles[activeId];
              if (active != null) node.activeStyle = active;
            }
            _touch(id);
          }
          break;

        case UiOpCode.hoverStyle:
          check(8);
          final id = bd.getUint32(p, Endian.little);
          final hoverId = bd.getUint32(p + 4, Endian.little);
          p += 8;
          final node = _nodes[id];
          if (node != null) {
            // same epoch rules as SET_STYLE: id 0 clears, an id from a
            // mid-session replay leaves the current variant alone
            if (hoverId == 0) {
              node.hoverStyle = null;
            } else {
              final hover = _styles[hoverId];
              if (hover != null) node.hoverStyle = hover;
            }
            _touch(id);
          }
          break;

        case UiOpCode.canvas:
          check(8);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          final byteLen = bd.getUint32(p, Endian.little);
          p += 4;
          check(byteLen);
          // copied, not a view: these bytes are retained for the life of the
          // canvas, and a view would pin the whole op frame with them
          final commands = frame.sublist(p, p + byteLen);
          p += byteLen;
          final canvasNode = _nodes[id];
          if (canvasNode != null) {
            (canvasNode.canvas ??= FjsCanvasDisplayList()).append(commands);
            _touch(id);
          }
          break;

        case UiOpCode.webgl:
          check(8);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          final byteLen = bd.getUint32(p, Endian.little);
          p += 4;
          check(byteLen);
          // copied for the same reason as the canvas bytes: the display
          // queues them until its GL context exists, outliving this frame
          final commands = frame.sublist(p, p + byteLen);
          p += byteLen;
          final webglNode = _nodes[id];
          if (webglNode != null) {
            webglNode.webglChunks.add(commands);
            _touch(id);
          }
          break;

        case UiOpCode.resetStyles:
          // ends an epoch: nodes keep the entries they already resolved, so
          // dropping the directory only means the next use re-sends it
          _styles.clear();
          break;

        default:
          throw UiOpException('unknown op code $op at offset ${p - 1}');
      }
    }
    _version++;
  }

  List<int> _childList(int parent) {
    if (parent == 0) return _rootChildren;
    final node = _nodes[parent];
    if (node == null) {
      throw UiOpException('op references unknown parent $parent');
    }
    return node.children;
  }

  void _removeDeep(int id) {
    final node = _nodes.remove(id);
    if (node == null) return;
    // drop the signal but do NOT dispose it: an AnimatedBuilder that is still
    // unmounting will call removeListener on it afterwards
    _signals.remove(id);
    _globalKeys.remove(id);
    _dirty.remove(id);
    if (node.webglChunks.isNotEmpty) canvasNodeDisposed?.call(node.id);
    for (final child in List<int>.of(node.children)) {
      _removeDeep(child);
    }
    _detach(id);
    _parentOf.remove(id);
    // detach from any other parent that still references us
    for (final other in _nodes.values) {
      other.children.remove(id);
    }
  }

  /// Removes `id` from whichever parent (element or root) currently holds it.
  /// Parent id 0 is the root container.
  void _detach(int id) {
    final prev = _parentOf[id];
    if (prev == null) return;
    if (prev == 0) {
      _rootChildren.remove(id);
    } else {
      _nodes[prev]?.children.remove(id);
    }
    _parentOf.remove(id);
  }

  /// Removes every node and root edge (used on hot reload / reset).
  void clear() {
    for (final node in _nodes.values) {
      if (node.webglChunks.isNotEmpty) canvasNodeDisposed?.call(node.id);
    }
    _nodes.clear();
    _rootChildren.clear();
    _parentOf.clear();
    _styles.clear();
    _signals.clear();
    _dirty.clear();
    _version++;
    _generation++;
  }
}

/// HTML boolean-attribute semantics for a prop.
///
/// A valueless attribute in a template (`<button plain>`) reaches the mirror
/// tree as the empty string, not `true` — Vue only casts it to a boolean on
/// the web side, where the component declares the prop's type. Reading
/// `props['plain'] == true` therefore worked in one place and silently did
/// nothing in the other. Present-but-empty means true, as in HTML.
bool fjsBool(Object? value) {
  if (value == null || value == false) return false;
  if (value == true) return true;
  if (value is String) return value != 'false' && value != '0';
  if (value is num) return value != 0;
  return true;
}
