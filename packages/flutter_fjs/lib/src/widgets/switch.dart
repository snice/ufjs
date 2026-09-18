// `switch` tag -> Material Switch.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import 'control_scope.dart';
import 'dispatch.dart';

class FjsSwitch extends StatefulWidget {
  const FjsSwitch({required this.node, required this.dispatch});

  final MirrorNode node;
  final FjsDispatch dispatch;

  @override
  State<FjsSwitch> createState() => _FjsSwitchState();
}

class _FjsSwitchState extends State<FjsSwitch>
    with FjsControlRegistration<FjsSwitch> {
  @override
  FjsControlHandle createControlHandle() => FjsControlHandle(
    nodeId: widget.node.id,
    kind: FjsControlKind.toggle,
    getName: () => widget.node.props['name']?.toString(),
    getId: () => widget.node.props['id']?.toString(),
    getValue: () => _value,
    toggle: () {
      if (fjsBool(widget.node.props['disabled'])) return;
      _emit(!_value);
    },
  );

  late bool _value = widget.node.props['value'] == true;
  bool _lastProp = false;

  @override
  void initState() {
    super.initState();
    _lastProp = _value;
  }

  @override
  void didUpdateWidget(covariant FjsSwitch oldWidget) {
    super.didUpdateWidget(oldWidget);
    final v = widget.node.props['value'] == true;
    if (v != _lastProp) {
      _lastProp = v;
      _value = v;
    }
  }

  void _emit(bool next) {
    setState(() => _value = next);
    widget.dispatch(
      widget.node.id,
      FjsEvent.valueChanged,
      text: next ? '1' : '0',
    );
    notifyControlChanged();
  }

  @override
  Widget build(BuildContext context) {
    final disabled = fjsBool(widget.node.props['disabled']);
    // Colors follow the web adapter's `.fjs-switch` (the iOS look uni-app
    // users expect), not the Material palette: green when on, #e5e5ea when
    // off, white thumb either way, and the whole control at half opacity
    // when it is disabled.
    final control = Switch(
      value: _value,
      activeThumbColor: const Color(0xFFFFFFFF),
      activeTrackColor: const Color(0xFF34C759),
      inactiveThumbColor: const Color(0xFFFFFFFF),
      inactiveTrackColor: const Color(0xFFE5E5EA),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      // an (empty) thumb icon keeps the M3 thumb one size in both states,
      // like the knob the web adapter draws
      thumbIcon: const WidgetStatePropertyAll(Icon(null)),
      // Material reserves a 48dp tap target around the 32dp track, which
      // pushes every row of a settings list apart; CSS sizes the switch
      // from the control alone.
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      onChanged: disabled ? null : _emit,
    );
    return disabled ? Opacity(opacity: 0.5, child: control) : control;
  }
}
