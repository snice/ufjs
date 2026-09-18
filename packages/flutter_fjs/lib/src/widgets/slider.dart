// `slider` tag -> Material Slider.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import 'control_scope.dart';
import 'dispatch.dart';

class FjsSlider extends StatefulWidget {
  const FjsSlider({required this.node, required this.dispatch});

  final MirrorNode node;
  final FjsDispatch dispatch;

  @override
  State<FjsSlider> createState() => _FjsSliderState();
}

class _FjsSliderState extends State<FjsSlider>
    with FjsControlRegistration<FjsSlider> {
  @override
  FjsControlHandle createControlHandle() => FjsControlHandle(
    nodeId: widget.node.id,
    kind: FjsControlKind.slider,
    getName: () => widget.node.props['name']?.toString(),
    getId: () => widget.node.props['id']?.toString(),
    // An integral value goes into a form payload as an int: jsonEncode
    // would write 30.0 where the web adapter's JSON.stringify writes 30,
    // and the two payloads have to match byte for byte.
    getValue: () => _value == _value.roundToDouble() ? _value.toInt() : _value,
  );

  late double _min = _num(widget.node.props['min'], 0);
  late double _max = () {
    final m = _num(widget.node.props['max'], 100);
    return m <= _min ? _min + 100 : m;
  }();
  late double _value = _num(widget.node.props['value'], _min).clamp(_min, _max);
  double? _lastProp;

  static double _num(Object? v, double fallback) =>
      v is num ? v.toDouble() : (double.tryParse('$v') ?? fallback);

  @override
  void didUpdateWidget(covariant FjsSlider oldWidget) {
    super.didUpdateWidget(oldWidget);
    final v = _num(widget.node.props['value'], _min);
    if (_lastProp == null) {
      _lastProp = v; // first pass: adopt without stomping local drags
    } else if (v != _lastProp) {
      _lastProp = v;
      _value = v.clamp(_min, _max);
    }
  }

  @override
  Widget build(BuildContext context) {
    // `accent-color: #007aff` on the web adapter's range input, with the
    // browser's grey rail behind it — and the browser's proportions: a 4px
    // rail with a small thumb, no Material overlay halo and none of the
    // 48dp row Material reserves around it.
    return SliderTheme(
      data: SliderTheme.of(context).copyWith(
        trackHeight: 4,
        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 8),
        overlayShape: SliderComponentShape.noOverlay,
      ),
      child: Slider(
        value: _value.clamp(_min, _max),
        activeColor: const Color(0xFF007AFF),
        inactiveColor: const Color(0xFFE5E5EA),
        min: _min,
        max: _max,
        onChanged: fjsBool(widget.node.props['disabled'])
            ? null
            : (v) {
                setState(() => _value = v);
                widget.dispatch(
                  widget.node.id,
                  FjsEvent.valueChanged,
                  text: v.toStringAsFixed(2),
                );
                notifyControlChanged();
              },
      ),
    );
  }
}
