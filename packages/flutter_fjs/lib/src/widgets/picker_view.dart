// `picker-view` / `picker-view-column` -> a row of wheels.
//
// This is the one part of <picker> that had to be a widget (constitution
// VII): ListWheelScrollView hands over item snapping, fling physics, a
// settled-on-item callback and — on iOS — the system's own haptic tick.
// Writing that over `scroll-view` + touch events would mean hand-rolling
// deceleration and snap animations, and the haptics are simply not reachable
// from JS. Everything ABOVE the wheel (which columns exist, what a column
// means, date math) stays in JS: components/picker.ts.
//
// The look is WeUI's flat wheel, not Cupertino's barrel (spec 008 Q2), so
// the web adapter can draw the same thing with scroll-snap: a 44px row, five
// visible rows, one hairline box in the middle, and the rows above and below
// fading into the background.
import 'dart:convert';

import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/style.dart';
import '../render/style_parse.dart';
import 'control_scope.dart' show fjsWarnOnce;
import 'dispatch.dart';

/// Same numbers as `.fjs-picker-view` in the web base stylesheet.
const double fjsPickerItemHeight = 44;
const int fjsPickerVisibleRows = 5;
const double fjsPickerViewHeight = fjsPickerItemHeight * fjsPickerVisibleRows;
const Color _indicatorLine = Color(0xFFE5E5EA);

/// ListWheelScrollView is a cylinder; a big diameter ratio flattens it to
/// something close to a plain list, which is what WeUI's wheel looks like.
const double _flatDiameterRatio = 100;

class FjsPickerView extends StatefulWidget {
  const FjsPickerView({
    required this.node,
    required this.tree,
    required this.style,
    required this.dispatch,
    required this.buildNode,
  });

  final MirrorNode node;
  final MirrorTree tree;
  final FjsStyle style;
  final FjsDispatch dispatch;
  final Widget Function(MirrorNode node) buildNode;

  @override
  State<FjsPickerView> createState() => _FjsPickerViewState();
}

class _FjsPickerViewState extends State<FjsPickerView> {
  final List<FixedExtentScrollController> _controllers = [];

  /// What the wheels currently sit on. Kept next to the controllers so a
  /// prop update can tell "the page moved us" from "the user did".
  List<int> _indexes = const [];

  /// The columns, as mirror nodes. Non-column children are dropped (and
  /// warned about) the way the mini program drops them.
  List<MirrorNode> get _columns {
    final out = <MirrorNode>[];
    for (final id in widget.node.children) {
      final child = widget.tree.node(id);
      if (child == null) continue;
      if (child.tag == 'picker-view-column') {
        out.add(child);
        continue;
      }
      fjsWarnOnce(
        'picker-view-child:${child.id}',
        '<picker-view> only renders <picker-view-column> children; a '
            '<${child.tag}> was dropped.',
      );
    }
    return out;
  }

  List<int> get _propValue {
    final raw = widget.node.props['value'];
    final list = raw is List
        ? raw
        : (raw is String ? _decode(raw) : const <Object?>[]);
    return [
      for (final v in list) v is num ? v.toInt() : int.tryParse('$v') ?? 0,
    ];
  }

  bool _isHidden(MirrorNode node) {
    final display = node.styleMap['display'] ?? node.props['display'];
    if (display != null && display.toString() == 'none') return true;
    return node.tag == 'text' &&
        (node.text == null || node.text!.isEmpty) &&
        node.children.isEmpty;
  }

  List<int> _optionIds(MirrorNode column) => [
    for (final id in column.children)
      if (widget.tree.node(id) case final child? when !_isHidden(child)) id,
  ];

  static List<Object?> _decode(String raw) {
    try {
      final decoded = jsonDecode(raw);
      return decoded is List ? decoded : const [];
    } catch (_) {
      return const [];
    }
  }

  double get _itemHeight {
    final raw = widget.node.props['itemHeight'];
    final value = raw is num ? raw.toDouble() : double.tryParse('${raw ?? ''}');
    return value != null && value > 0 ? value : fjsPickerItemHeight;
  }

  @override
  void initState() {
    super.initState();
    _sync(animate: false);
  }

  @override
  void didUpdateWidget(covariant FjsPickerView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync(animate: true);
  }

  /// Brings the wheels in line with the columns and the `value` prop.
  ///
  /// Only moves a wheel that is not already there: animating to the item a
  /// wheel just settled on would fight the user's own scroll, and the event
  /// that scroll emitted is what produced this prop in the first place.
  void _sync({required bool animate}) {
    final columns = _columns;
    final target = _propValue;

    // A linked picker can drop or add a column; a controller outlives only
    // the column it belongs to.
    while (_controllers.length > columns.length) {
      _controllers.removeLast().dispose();
    }
    while (_controllers.length < columns.length) {
      _controllers.add(FixedExtentScrollController());
    }

    final next = <int>[];
    for (var i = 0; i < columns.length; i++) {
      final length = _optionIds(columns[i]).length;
      var index = i < target.length
          ? target[i]
          : (i < _indexes.length ? _indexes[i] : 0);
      // "数字大于可选项长度时，选择最后一项" — same rule as the JS side's
      // clampIndex, so both platforms land on the same item.
      if (index < 0 || length == 0) index = 0;
      if (length > 0 && index > length - 1) index = length - 1;
      next.add(index);

      final controller = _controllers[i];
      if (!controller.hasClients) {
        // before the first layout the initial item is all we can set
        if (controller.initialItem != index) {
          _controllers[i] = FixedExtentScrollController(initialItem: index);
          controller.dispose();
        }
        continue;
      }
      if (controller.selectedItem == index) continue;
      if (animate) {
        controller.animateToItem(
          index,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      } else {
        controller.jumpToItem(index);
      }
    }
    _indexes = next;
  }

  /// A wheel settled on a new item. ListWheelScrollView only calls this once
  /// the scroll comes to rest on an item, which is exactly the "停下才派"
  /// timing the web side reproduces with `scrollend`.
  void _onSettled(int column, int index) {
    if (column < _indexes.length && _indexes[column] == index) return;
    final next = [..._indexes];
    if (column < next.length) next[column] = index;
    _indexes = next;
    widget.dispatch(
      widget.node.id,
      FjsEvent.valueChanged,
      text: jsonEncode(next),
    );
  }

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final columns = _columns;
    final options = [for (final column in columns) _optionIds(column)];
    final itemHeight = _itemHeight;
    // ListWheelScrollView needs a bounded height; a page that does not say
    // one gets the five-row default instead of an unbounded-constraint crash.
    final height = widget.style.height ?? itemHeight * fjsPickerVisibleRows;

    return SizedBox(
      height: height,
      child: Stack(
        children: [
          // The rows above and below the selection fade out, the same
          // `mask-image` gradient the web adapter applies. dstIn keeps the
          // wheel's pixels weighted by the gradient's alpha, so whatever the
          // page painted behind shows through — the web mask does the same.
          ShaderMask(
            blendMode: BlendMode.dstIn,
            shaderCallback: (bounds) => const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Color(0x00000000),
                Color(0xFF000000),
                Color(0xFF000000),
                Color(0x00000000),
              ],
              // 1.4 rows of fade at each end — the same fraction the web
              // gradient uses (88px of a 220px box).
              stops: [0.0, 0.28, 0.72, 1.0],
            ).createShader(bounds),
            child: Row(
              children: [
                for (var i = 0; i < columns.length; i++)
                  Expanded(
                    child: ListWheelScrollView.useDelegate(
                      controller: i < _controllers.length
                          ? _controllers[i]
                          : null,
                      itemExtent: itemHeight,
                      diameterRatio: _flatDiameterRatio,
                      perspective: 0.001,
                      physics: const FixedExtentScrollPhysics(),
                      onSelectedItemChanged: (index) => _onSettled(i, index),
                      childDelegate: ListWheelChildBuilderDelegate(
                        childCount: options[i].length,
                        builder: (_, index) {
                          final child = widget.tree.node(options[i][index]);
                          if (child == null) return null;
                          return Center(child: widget.buildNode(child));
                        },
                      ),
                    ),
                  ),
              ],
            ),
          ),
          // The indicator sits above the wheels and must not eat their
          // gestures.
          IgnorePointer(
            child: Center(
              child: Container(
                height: itemHeight,
                decoration: _indicatorDecoration(widget.node),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// `indicator-style` accepts the same three properties the mini program's
/// Skyline build does: height / border / background-color. Anything else is
/// ignored (and the height is handled by the item extent).
BoxDecoration _indicatorDecoration(MirrorNode node) {
  final raw = node.props['indicatorStyle']?.toString() ?? '';
  Color? background;
  var line = _indicatorLine;
  for (final part in raw.split(';')) {
    final at = part.indexOf(':');
    if (at < 0) continue;
    final key = part.substring(0, at).trim();
    final value = part.substring(at + 1).trim();
    if (key == 'background-color') background = parseColor(value);
    if (key == 'border') {
      final color = parseColor(value.split(RegExp(r'\s+')).last);
      if (color != null) line = color;
    }
  }
  return BoxDecoration(
    color: background,
    border: Border(
      top: BorderSide(color: line),
      bottom: BorderSide(color: line),
    ),
  );
}
