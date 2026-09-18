// `radio-group` / `checkbox-group` -> a control scope plus the group's own
// event.
//
// The group owns no visual: it is a plain container (buildBox does the
// decoration) wrapping an FjsControlScope. Children register into it as they
// mount, so the group never has to know how the page nested them — a radio
// three views deep, or inside a <label>, still belongs to it.
import 'dart:convert';

import 'package:flutter/widgets.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import 'control_scope.dart';
import 'dispatch.dart';

class FjsControlGroup extends StatefulWidget {
  const FjsControlGroup({
    required this.node,
    required this.dispatch,
    required this.multiple,
    required this.child,
  });

  final MirrorNode node;
  final FjsDispatch dispatch;

  /// checkbox-group emits a JSON array, radio-group a single name.
  final bool multiple;
  final Widget child;

  @override
  State<FjsControlGroup> createState() => _FjsControlGroupState();
}

class _FjsControlGroupState extends State<FjsControlGroup>
    with FjsControlRegistration<FjsControlGroup> {
  FjsControlRegistry? _own;

  /// The group is itself a control as far as an enclosing <form> is
  /// concerned: `name` -> selected name(s).
  @override
  FjsControlHandle createControlHandle() => FjsControlHandle(
    nodeId: widget.node.id,
    kind: FjsControlKind.group,
    getName: () => widget.node.props['name']?.toString(),
    getId: () => widget.node.props['id']?.toString(),
    getValue: () => widget.multiple ? _selectedNames() : _selectedName(),
  );

  FjsControlRegistry _registryFor(FjsControlRegistry? parent) {
    return FjsControlRegistry(parent: parent)
      ..onChanged = _onChildChanged
      // The group speaks for its members; they do not also show up on their
      // own in an enclosing <form>'s payload.
      ..owns = widget.multiple ? FjsControlKind.checkbox : FjsControlKind.radio;
  }

  bool _isMember(FjsControlHandle handle) =>
      handle.kind ==
      (widget.multiple ? FjsControlKind.checkbox : FjsControlKind.radio);

  List<FjsControlHandle> get _members =>
      (_own?.handles ?? const <FjsControlHandle>[]).where(_isMember).toList();

  void _onChildChanged(FjsControlHandle changed) {
    if (!_isMember(changed)) return;
    if (!widget.multiple && changed.getValue() == true) {
      // Exclusion. setChecked deliberately does not dispatch: only the radio
      // the user actually touched reports a change of its own.
      for (final other in _members) {
        if (identical(other, changed)) continue;
        other.setChecked?.call(false);
      }
    }
    _warnUnnamed();
    widget.dispatch(
      widget.node.id,
      FjsEvent.valueChanged,
      text: widget.multiple ? _selectedNames() : _selectedName(),
    );
  }

  void _warnUnnamed() {
    for (final member in _members) {
      if (member.getName() != null) continue;
      fjsWarnOnce(
        'group-unnamed:${member.nodeId}',
        '<${widget.multiple ? 'checkbox' : 'radio'}> node ${member.nodeId} is '
            'inside a group but has no `name`, so it can never appear in the '
            "group's payload. Give it a name.",
      );
    }
  }

  String _selectedName() {
    for (final member in _members) {
      if (member.getValue() == true) return member.getName() ?? '';
    }
    return '';
  }

  /// Document order — the registration order the scope preserves. The web
  /// adapter builds the same array from the same order, so the two strings
  /// compare equal byte for byte.
  String _selectedNames() {
    final names = <String>[];
    for (final member in _members) {
      if (member.getValue() != true) continue;
      final name = member.getName();
      if (name != null) names.add(name);
    }
    return jsonEncode(names);
  }

  @override
  Widget build(BuildContext context) {
    // Rebuilt when the enclosing scope changes; the registry object itself is
    // kept so children's registrations survive an ordinary rebuild.
    final parent = FjsControlScope.of(context);
    final own = _own;
    if (own == null || !identical(own.parent, parent)) {
      _own = _registryFor(parent);
    }
    return FjsControlScope(registry: _own!, child: widget.child);
  }
}
