// `list-view` tag -> ListView.builder, plus the onScroll offset reporting the
// JS-side virtual list drives itself from.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/cull.dart' show fjsScrollerMoved;
import '../render/image_visibility.dart' show scheduleFjsImageVisibilityRefresh;
import '../render/scroll_metrics.dart';
import '../render/style.dart';
import 'dispatch.dart';

class FjsListView extends StatefulWidget {
  const FjsListView({
    super.key,
    required this.node,
    required this.style,
    required this.items,
    required this.buildItem,
    required this.dispatch,
  });

  final MirrorNode node;
  final FjsStyle style;
  final List<MirrorNode> items;
  final Widget Function(BuildContext context, MirrorNode item) buildItem;
  final FjsDispatch dispatch;

  @override
  State<FjsListView> createState() => _FjsListViewState();
}

class _FjsListViewState extends State<FjsListView> {
  bool _scrollQueued = false;
  double _lastOffset = -1;
  double _lastSentOffset = -1;

  /// Content extent along the scrolling axis, for the payload's
  /// scrollHeight / scrollWidth.
  double _lastMetrics = 0;

  bool _onScroll(ScrollNotification notification) {
    // Before the early return: a flex culling against this window needs the
    // nudge whether or not the page asked for @scroll (cull.dart).
    fjsScrollerMoved();
    scheduleFjsImageVisibilityRefresh();
    if (widget.node.props['onScroll'] != true ||
        notification.metrics.axis != widget.style.scrollDirection) {
      return false;
    }
    _lastOffset = notification.metrics.pixels;
    _lastMetrics =
        notification.metrics.maxScrollExtent +
        notification.metrics.viewportDimension;
    if ((_lastOffset - _lastSentOffset).abs() < 0.5) return false;
    if (_scrollQueued) return false;
    _scrollQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollQueued = false;
      if (!mounted) return;
      if ((_lastOffset - _lastSentOffset).abs() < 0.5) return;
      final delta = _lastOffset - _lastSentOffset;
      _lastSentOffset = _lastOffset;
      // The six-field payload fjs-runtime/src/scroll/metrics.ts defines —
      // same field order, same rounding, so a page reads one shape on both
      // platforms. It used to be a bare offset string (specs/009 Q3).
      final horizontal = widget.style.scrollDirection == Axis.horizontal;
      widget.dispatch(
        widget.node.id,
        FjsEvent.scroll,
        text: fjsScrollPayload(
          scrollTop: horizontal ? 0 : _lastOffset,
          scrollLeft: horizontal ? _lastOffset : 0,
          scrollHeight: horizontal ? 0 : _lastMetrics,
          scrollWidth: horizontal ? _lastMetrics : 0,
          deltaX: horizontal ? delta : 0,
          deltaY: horizontal ? 0 : delta,
        ),
      );
    });
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final indexByKey = <String, int>{
      for (var index = 0; index < widget.items.length; index++)
        'fjs-list-item-${widget.items[index].id}': index,
    };
    return NotificationListener<ScrollNotification>(
      onNotification: _onScroll,
      child: ListView.builder(
        scrollDirection: widget.style.scrollDirection,
        itemCount: widget.items.length,
        // The JS virtual-list window replaces its leading/trailing spacers
        // and rows as the offset changes. Give Sliver stable node keys so it
        // relocates existing render boxes instead of retaining them by their
        // old list index (which otherwise leaves a blank viewport mid-scroll).
        findChildIndexCallback: (key) =>
            key is ValueKey<String> ? indexByKey[key.value] : null,
        itemBuilder: (context, index) {
          final item = widget.items[index];
          return KeyedSubtree(
            key: ValueKey<String>('fjs-list-item-${item.id}'),
            child: widget.buildItem(context, item),
          );
        },
      ),
    );
  }
}
