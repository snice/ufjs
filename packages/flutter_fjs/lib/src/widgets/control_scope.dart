// The registry `radio-group` / `checkbox-group` / `label` / `form` all sit on.
//
// A control (input / checkbox / radio / switch / slider) registers a handle
// with the NEAREST enclosing scope; a scope forwards every registration to
// its own parent scope. So one mechanism answers all four questions:
//
//   form   -> every named handle under me, for the submit payload
//   label  -> the first handle under me, to forward a tap to
//   group  -> the radio/checkbox handles under me, to keep in sync
//
// Why registration and not a walk over the mirror tree: a walk sees
// `node.props`, and an fjs input may be UNCONTROLLED — with no `value` prop
// its text lives only in the TextEditingController. A handle asks the widget
// itself (`getValue`), so the form reads what the user actually sees.
// (MirrorTree also has no public parent accessor, so a walk would have to
// widen that API first.)
import 'package:flutter/widgets.dart';

enum FjsControlKind { input, checkbox, radio, toggle, slider, group }

/// One control's contract with the scopes above it.
class FjsControlHandle {
  FjsControlHandle({
    required this.nodeId,
    required this.kind,
    required this.getName,
    required this.getId,
    required this.getValue,
    this.setChecked,
    this.toggle,
    this.focus,
    this.blur,
  });

  final int nodeId;
  final FjsControlKind kind;

  /// Read lazily: `name` is a prop, and a prop can change without the
  /// control remounting.
  final String? Function() getName;

  /// The node's `id` prop — what `<label for="...">` matches on.
  final String? Function() getId;

  /// The value as it goes into a form payload — String, bool or num, so
  /// jsonEncode gives the same text the web adapter's JSON.stringify does.
  final Object? Function() getValue;

  /// checkbox / radio: forced by a group (mutual exclusion), no event of
  /// the control's own.
  final void Function(bool value)? setChecked;

  /// What a label forwards a tap to on a checkbox / radio / switch.
  final VoidCallback? toggle;

  /// What a label forwards a tap to on an input.
  final VoidCallback? focus;

  /// Drop the keyboard / give up focus — the DOM-shaped `el.blur()`
  /// (vant rejects focus on a readonly field by blurring it).
  final VoidCallback? blur;
}

/// A scope's own list plus a link to the scope above it.
class FjsControlRegistry {
  FjsControlRegistry({this.parent});

  final FjsControlRegistry? parent;

  /// Handles of this kind stop here instead of bubbling: a group speaks for
  /// its members, so a <form> above it sees one key (the group's) and not
  /// one per checkbox. Mirrors `owns` in the web scope.
  FjsControlKind? owns;

  /// Registration order, which for siblings is document order — the same
  /// order the web adapter's onMounted produces. It is the only reason the
  /// two platforms serialize a form's keys identically, so nothing here may
  /// reorder this list.
  final List<FjsControlHandle> handles = <FjsControlHandle>[];

  /// Groups watch this to sync a newly mounted child.
  void Function(FjsControlHandle handle)? onRegister;

  /// A control calls [notifyChanged] after a USER-driven change; a group
  /// listens here to enforce exclusion and to emit its own payload.
  void Function(FjsControlHandle handle)? onChanged;

  void register(FjsControlHandle handle) {
    handles.add(handle);
    onRegister?.call(handle);
    if (handle.kind == owns) return;
    parent?.register(handle);
  }

  void unregister(FjsControlHandle handle) {
    handles.remove(handle);
    if (handle.kind == owns) return;
    parent?.unregister(handle);
  }

  /// Bubbles up so a `<form>` above a `<radio-group>` hears about it too.
  void notifyChanged(FjsControlHandle handle) {
    onChanged?.call(handle);
    if (handle.kind == owns) return;
    parent?.notifyChanged(handle);
  }
}

class FjsControlScope extends InheritedWidget {
  const FjsControlScope({
    super.key,
    required this.registry,
    required super.child,
  });

  final FjsControlRegistry registry;

  /// The nearest enclosing registry, or null outside any group/label/form —
  /// a bare `<checkbox>` still works, it just registers nowhere.
  static FjsControlRegistry? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<FjsControlScope>()?.registry;

  @override
  bool updateShouldNotify(FjsControlScope oldWidget) =>
      oldWidget.registry != registry;
}

/// Every live control by mirror node id — the DOM-shaped `el.focus()` /
/// `el.blur()` (element.ts) land here, because vant reaches a field through
/// a template ref and not through a label or form: the scope chain above
/// never sees that call. Keyed by node id, which is exactly what the JS
/// side holds; entries leave when the control's state detaches.
final Map<int, FjsControlHandle> controlsByNode = <int, FjsControlHandle>{};

/// `el.focus()` — true when a live control owns [nodeId].
bool fjsControlFocus(int nodeId) {
  final handle = controlsByNode[nodeId];
  if (handle == null) return false;
  handle.focus?.call();
  return true;
}

/// `el.blur()`.
bool fjsControlBlur(int nodeId) {
  final handle = controlsByNode[nodeId];
  if (handle == null) return false;
  handle.blur?.call();
  return true;
}

/// Mixin for the control widgets: keeps registration in step with the
/// scope above, which can change when the tree is re-parented.
mixin FjsControlRegistration<T extends StatefulWidget> on State<T> {
  FjsControlRegistry? _registry;
  FjsControlHandle? _handle;

  /// Built once per registration; the control fills in its own callbacks.
  FjsControlHandle createControlHandle();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = FjsControlScope.of(context);
    if (identical(next, _registry) && _handle != null) return;
    _detach();
    _registry = next;
    // The handle exists even outside every scope: the global by-node map
    // (el.focus()/el.blur()) must answer whether or not a form/label/group
    // sits above.
    final handle = createControlHandle();
    _handle = handle;
    controlsByNode[handle.nodeId] = handle;
    if (next != null) next.register(handle);
  }

  /// Tell the scopes above that the user changed this control.
  void notifyControlChanged() {
    final handle = _handle;
    if (handle != null) _registry?.notifyChanged(handle);
  }

  void _detach() {
    final handle = _handle;
    if (handle != null) {
      _registry?.unregister(handle);
      if (controlsByNode[handle.nodeId] == handle) {
        controlsByNode.remove(handle.nodeId);
      }
    }
    _handle = null;
  }

  @override
  void dispose() {
    _detach();
    super.dispose();
  }
}

final Set<String> _warnedKeys = <String>{};

/// Debug-only, once per key. Constitution V: a form control that silently
/// does nothing (no `name`, no label target) is a bug, not a no-op.
void fjsWarnOnce(String key, String message) {
  assert(() {
    if (_warnedKeys.add(key)) debugPrint('fjs: $message');
    return true;
  }());
}

@visibleForTesting
void resetFjsWarnOnce() => _warnedKeys.clear();
