// `checkbox` tag -> Material Checkbox.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/style.dart';
import 'control_scope.dart';
import 'dispatch.dart';

class FjsCheckbox extends StatefulWidget {
  const FjsCheckbox({
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
  State<FjsCheckbox> createState() => _FjsCheckboxState();
}

class _FjsCheckboxState extends State<FjsCheckbox>
    with FjsControlRegistration<FjsCheckbox> {
  @override
  FjsControlHandle createControlHandle() => FjsControlHandle(
    nodeId: widget.node.id,
    kind: FjsControlKind.checkbox,
    getName: () => widget.node.props['name']?.toString(),
    getId: () => widget.node.props['id']?.toString(),
    getValue: () => _value,
    setChecked: (next) {
      if (!mounted || next == _value) return;
      setState(() => _value = next);
    },
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
  void didUpdateWidget(covariant FjsCheckbox oldWidget) {
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
    // Same box the web adapter's `.fjs-checkbox` draws: a 20px square with a
    // 2px grey outline and 4px corners, filled #007aff with a white check
    // when on. Material would reserve 40px around it and push every row of a
    // list apart, hence the SizedBox and the density overrides.
    final box = SizedBox.square(
      dimension: 20,
      child: Checkbox(
        value: _value,
        activeColor: const Color(0xFF007AFF),
        checkColor: const Color(0xFFFFFFFF),
        side: const BorderSide(color: Color(0xFFB0B0B0), width: 2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        visualDensity: VisualDensity.compact,
        onChanged: disabled ? null : (v) => _emit(v == true),
      ),
    );

    final kids = widget.children;
    final raw = widget.node.text ?? '';
    if (kids.isEmpty && raw.isEmpty) return box;

    // Label slot (and/or host text) sits beside the box; a tap anywhere on
    // the row fires the same change the box itself would. IgnorePointer on
    // the box so Material's onChanged and the row's onTap cannot both fire.
    final gap = FjsStyle.of(widget.node).columnGap ?? 8;
    return GestureDetector(
      onTap: disabled ? null : () => _emit(!_value),
      behavior: HitTestBehavior.opaque,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          IgnorePointer(child: box),
          if (gap > 0) SizedBox(width: gap),
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
          for (var i = 0; i < kids.length; i++)
            _labelChild(
              kids[i],
              i < widget.childNodes.length ? widget.childNodes[i] : null,
            ),
        ],
      ),
    );
  }
}

Widget _labelChild(Widget child, MirrorNode? node) {
  if (node == null) return child;
  final grow = FjsStyle.of(node).flexGrow;
  if (grow != null && grow > 0) {
    return Expanded(flex: grow.round().clamp(1, 9999), child: child);
  }
  return child;
}
