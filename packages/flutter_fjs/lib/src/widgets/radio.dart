// `radio` tag -> a hand-drawn circle, not Material's Radio.
//
// Material reserves a 40x40 tap target and animates a splash halo; in a
// WeUI-style form row that pushes every line apart and paints a ripple the
// web side has no counterpart for. The box is drawn from the same numbers
// as `.fjs-radio` in the web base stylesheet (20px, 2px #B0B0B0 ring,
// #007AFF when on) so a row lines up identically on both platforms.
//
// Colors follow the controls already shipped (checkbox/slider #007AFF), not
// WeUI's green — see specs/007-form-components/plan.md §3.6.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/style.dart';
import 'control_scope.dart';
import 'dispatch.dart';

const Color fjsControlAccent = Color(0xFF007AFF);
const Color fjsControlRing = Color(0xFFB0B0B0);

class FjsRadio extends StatefulWidget {
  const FjsRadio({
    required this.node,
    required this.dispatch,
    this.children = const [],
    this.childNodes = const [],
  });

  final MirrorNode node;
  final FjsDispatch dispatch;
  final List<Widget> children;
  final List<MirrorNode> childNodes;

  @override
  State<FjsRadio> createState() => _FjsRadioState();
}

class _FjsRadioState extends State<FjsRadio>
    with FjsControlRegistration<FjsRadio> {
  late bool _value = widget.node.props['value'] == true;
  late bool _lastProp = _value;

  @override
  FjsControlHandle createControlHandle() => FjsControlHandle(
    nodeId: widget.node.id,
    kind: FjsControlKind.radio,
    getName: () => widget.node.props['name']?.toString(),
    getId: () => widget.node.props['id']?.toString(),
    getValue: () => _value,
    // A group turns the other radios off; that is not the user changing
    // this one, so it must not dispatch an event of its own.
    setChecked: (next) {
      if (!mounted || next == _value) return;
      setState(() => _value = next);
    },
    toggle: () => _select(),
  );

  @override
  void didUpdateWidget(covariant FjsRadio oldWidget) {
    super.didUpdateWidget(oldWidget);
    final v = widget.node.props['value'] == true;
    if (v != _lastProp) {
      _lastProp = v;
      _value = v;
    }
  }

  bool get _disabled => fjsBool(widget.node.props['disabled']);

  void _select() {
    if (_disabled) return;
    // Radios do not untoggle: tapping the selected one is a no-op, the way
    // it works in a browser and in WeUI.
    if (_value) return;
    setState(() => _value = true);
    widget.dispatch(widget.node.id, FjsEvent.valueChanged, text: '1');
    notifyControlChanged();
  }

  @override
  Widget build(BuildContext context) {
    final box = SizedBox.square(
      dimension: 20,
      child: DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: _value ? fjsControlAccent : null,
          border: Border.all(
            color: _value ? fjsControlAccent : fjsControlRing,
            width: 2,
          ),
        ),
        child: _value
            ? Center(
                child: SizedBox.square(
                  dimension: 8,
                  child: DecoratedBox(
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: Color(0xFFFFFFFF),
                    ),
                  ),
                ),
              )
            : null,
      ),
    );

    final kids = widget.children;
    final raw = widget.node.text ?? '';
    final control = GestureDetector(
      onTap: _disabled ? null : _select,
      behavior: HitTestBehavior.opaque,
      child: kids.isEmpty && raw.isEmpty
          ? box
          : Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                box,
                SizedBox(width: FjsStyle.of(widget.node).columnGap ?? 8),
                if (raw.isNotEmpty)
                  Text(
                    raw,
                    style: const TextStyle(
                      fontSize: 14,
                      height: 1.4,
                      color: Color(0xFF333333),
                      leadingDistribution: TextLeadingDistribution.even,
                    ),
                  ),
                ...kids,
              ],
            ),
    );
    return _disabled ? Opacity(opacity: 0.5, child: control) : control;
  }
}
