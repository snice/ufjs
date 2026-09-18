// sticky-header / sticky-section (specs/052): the Dart half of the sticky
// contract. The web side is CSS `position: sticky`, whose pin bounds are the
// PARENT element. This side earns the same semantics with the sliver
// toolkit: PinnedHeaderSliver pins a child whose size it measures itself,
// and SliverMainAxisGroup bounds its members — a section's headers leave
// with the section, and headers of one group push each other off the top,
// which is WeChat's push-pinned-header default. Direct scroll-view children
// pin for the whole scroll, as on the other ends.
//
// The @stickontopchange event is measured by FjsScrollView after each scroll
// frame (scroll_view.dart's _probeSticky): a header is stuck exactly when
// its painted top edge sits at the viewport's leading edge. That reads the
// real visual state, so group push-out flips the event without this file
// having to model the slivers' arithmetic.
import 'package:flutter/material.dart';

import '../mirror_tree.dart' show MirrorNode, fjsBool;
import '../node/node_adapter.dart';
import '../render/decoration.dart';
import '../render/flex.dart';
import '../render/style.dart';
import 'control_scope.dart' show fjsWarnOnce;
import 'text.dart' show buildText;

const String fjsStickyHeaderTag = 'sticky-header';
const String fjsStickySectionTag = 'sticky-section';

bool fjsIsStickyTag(String? tag) =>
    tag == fjsStickyHeaderTag || tag == fjsStickySectionTag;

/// Style-level `position: sticky` participates in the same split as the
/// sticky-header TAG — the scroll-view's direct children and a section's
/// direct children are scanned with this. A `position: sticky` node never
/// counts as a SECTION: grouping stays a tag-level concept (the web
/// substrate treats it the same way — the section is a tag there too).
bool fjsIsStickyNode(MirrorNode node) {
  if (node.tag == fjsStickySectionTag) return true;
  if (fjsIsStickyTag(node.tag)) return true;
  return FjsStyle.of(node).position == 'sticky';
}

/// WeChat offset-top: the pin line's distance from the scroll viewport's
/// top, px. The tag's prop wins; style-level `position: sticky` falls back
/// to the `top` length (its pin line, as in CSS).
double fjsStickyOffsetTop(MirrorNode node) {
  final raw = node.props['offsetTop'];
  if (raw is num) return raw.toDouble();
  final parsed = double.tryParse('${raw ?? ''}');
  if (parsed != null) return parsed;
  final top = FjsStyle.of(node).topLength;
  if (top == null || top.isRelative) return 0;
  return top.px;
}

/// What the sticky split produced: the sliver list for a CustomScrollView,
/// plus every sticky-header node id that ended up in it (the scroll view
/// probes those for @stickontopchange).
class FjsStickySplit {
  const FjsStickySplit(this.slivers, this.headerIds);

  final List<Widget> slivers;
  final List<int> headerIds;
}

/// Splits a scroll content list around the sticky tags. Plain children are
/// chunked into runs laid out by the scroll-view's own flex baseline — the
/// same [buildFlex] the non-sticky path feeds every child through — so
/// direction / align / gap keep working inside a run. A run boundary can
/// only appear where a sticky tag sits, so an ordinary page lays out
/// identically; only a `gap` straddling a seam is unrepresentable (slivers
/// have no gap concept).
///
/// [buildChild] builds one non-sticky child through its own adapter. Sticky
/// headers build through [_stickyContentBox] instead of the registered
/// adapters on purpose: those adapters are the STANDALONE path — reached
/// only when a header sits outside a sticky scroll-view — where they warn
/// (constitution V) and degrade to plain boxes.
FjsStickySplit fjsStickySplit({
  required FjsNodeAdapterContext context,
  required FjsStyle scrollStyle,
  required List<MirrorNode> nodes,
  required List<Widget> kids,
}) {
  final splitter = _StickySplitter(context, scrollStyle, nodes.length);
  final entries = splitter.splitNodes(nodes, kids);
  // A bare run of pinned headers STACKS (each pins below the previous, the
  // app-bar model). WeChat's default is PUSH: header B's arrival sweeps
  // header A off the top. Flutter models that with a group boundary — a
  // group's pinned header is pushed out when the group's extent passes —
  // so every direct header takes a group spanning everything up to the
  // next header. Runs before the first header need no group.
  final slivers = <Widget>[];
  List<Widget>? pending;
  void flushPending() {
    if (pending == null) return;
    if (pending!.isNotEmpty) {
      slivers.add(SliverMainAxisGroup(slivers: List.of(pending!)));
    }
    pending = null;
  }

  for (final (sliver, isHeader) in entries) {
    if (isHeader) {
      flushPending();
      pending = <Widget>[sliver];
    } else if (pending != null) {
      pending!.add(sliver);
    } else {
      slivers.add(sliver);
    }
  }
  flushPending();
  return FjsStickySplit(slivers, splitter.headerIds);
}

class _StickySplitter {
  _StickySplitter(this.context, this.scrollStyle, int ownerId)
    : warnPrefix = 'sticky:$ownerId';

  final FjsNodeAdapterContext context;
  final FjsStyle scrollStyle;
  final String warnPrefix;

  final List<int> headerIds = <int>[];
  final List<Widget> _run = <Widget>[];
  final List<MirrorNode?> _runNodes = <MirrorNode?>[];

  /// (sliver, isHeader). The flag exists for the group bookkeeping a
  /// section does; the top level keeps headers ungrouped so they pin for
  /// the whole scroll. [runStyle] is the flex baseline the plain runs lay
  /// out with: the scroll-view's own at the top level, the section's own
  /// inside one — each container styles its children, as everywhere else.
  List<(Widget, bool)> splitNodes(
    List<MirrorNode> nodes,
    List<Widget> kids, {
    FjsStyle? runStyle,
  }) {
    final entries = <(Widget, bool)>[];
    for (var i = 0; i < kids.length; i++) {
      final node = i < nodes.length ? nodes[i] : null;
      final kid = kids[i];
      if (node == null || !fjsIsStickyNode(node)) {
        _run.add(kid);
        _runNodes.add(node);
        continue;
      }
      _flushRun(entries, runStyle);
      if (node.tag == fjsStickySectionTag) {
        entries.add((_sectionSliver(node), false));
      } else {
        entries.add((_headerSliver(node), true));
        headerIds.add(node.id);
      }
    }
    _flushRun(entries, runStyle);
    return entries;
  }

  void _flushRun(List<(Widget, bool)> entries, FjsStyle? runStyle) {
    if (_run.isEmpty) return;
    // COPY the run: buildFlex wraps it in a LayoutBuilder, whose builder
    // only runs at LAYOUT time — after this flush has cleared the lists —
    // and a flex reading the cleared list lays out as a zero-height sliver.
    entries.add((
      SliverToBoxAdapter(
        child: buildFlex(
          runStyle ?? scrollStyle,
          List.of(_run),
          List.of(_runNodes),
          cull: true,
        ),
      ),
      false,
    ));
    _run.clear();
    _runNodes.clear();
  }

  /// One sticky-header entry. offset-top pads the pin line into the pinned
  /// child, so the pinned state looks exactly like web's `top: offset-top`;
  /// the band also occupies layout at rest, which web's does not (spec
  /// 052 §4). A style-level `top: %` cannot resolve here (the reference
  /// would be the scroller height) and pins at 0 — said so once.
  Widget _headerSliver(MirrorNode node) {
    if (fjsBool(node.props['allowOverlapping'])) {
      fjsWarnOnce(
        '$warnPrefix:overlap:${node.id}',
        '<sticky-header> node ${node.id}: allow-overlapping has no effect on '
            'Flutter yet; headers push each other as if it were false.',
      );
    }
    final topLength = FjsStyle.of(node).topLength;
    if (node.props['offsetTop'] == null &&
        topLength != null &&
        topLength.isRelative) {
      fjsWarnOnce(
        '$warnPrefix:relative-top:${node.id}',
        'position: sticky on node ${node.id}: a percentage `top` has no '
            'scroller height to resolve against; pinning at 0.',
      );
    }
    final offset = fjsStickyOffsetTop(node);
    Widget content = _stickyContentBox(context, node);
    if (offset > 0) {
      content = Padding(
        padding: EdgeInsets.only(top: offset),
        child: content,
      );
    }
    return PinnedHeaderSliver(child: content);
  }

  /// A sticky-section: its children are split the same way and bounded by a
  /// SliverMainAxisGroup — headers pin within the group's extent and are
  /// pushed off when the section scrolls past, which is the whole point of
  /// grouping. A section INSIDE a section has no WeChat counterpart (their
  /// docs allow a section only as a scroll-view child); degrade to a plain
  /// container and say so.
  Widget _sectionSliver(MirrorNode node) {
    // WeChat default is true. false means later headers cover earlier
    // ones instead of pushing; pinned headers inside one Flutter group
    // always push, and true overlap would need a custom RenderSliver —
    // v1 keeps the push and registers the difference (spec §4). Only an
    // explicit false warns: an absent prop IS the default.
    final pushProp = node.props['pushPinnedHeader'];
    if (pushProp != null && !fjsBool(pushProp)) {
      fjsWarnOnce(
        '$warnPrefix:push:${node.id}',
        '<sticky-section> node ${node.id}: push-pinned-header="false" has '
            'no effect on Flutter; headers push each other as on web sections.',
      );
    }
    final kidNodes = <MirrorNode>[];
    for (final id in node.children) {
      final child = context.tree.node(id);
      if (child != null) kidNodes.add(child);
    }
    final kids = [
      for (final child in kidNodes)
        child.tag == fjsStickySectionTag
            ? _nestedSection(child)
            : context.buildNode(context.flutterContext, child),
    ];
    return SliverMainAxisGroup(
      slivers: [
        for (final entry in splitNodes(
          kidNodes,
          kids,
          runStyle: FjsStyle.of(node),
        ))
          entry.$1,
      ],
    );
  }

  Widget _nestedSection(MirrorNode node) {
    fjsWarnOnce(
      '$warnPrefix:nested:${node.id}',
      '<sticky-section> node ${node.id} sits inside another sticky-section; '
          'WeChat allows a section only as a scroll-view child. Rendered as a '
          'plain container.',
    );
    return _stickyContentBox(context, node);
  }
}

/// The sticky tag's own box: a plain container — same build the view adapter
/// runs, bare text included — plus its padding/background. The explicit
/// global key is what lets the scroll view probe this box for the pin
/// event: only nodes with an `id` prop get one from the renderer for free,
/// and a sticky header rarely carries an id.
Widget _stickyContentBox(FjsNodeAdapterContext context, MirrorNode node) {
  final style = FjsStyle.of(node);
  final kidNodes = <MirrorNode?>[
    for (final id in node.children)
      if (context.tree.node(id) case final MirrorNode child) child,
  ];
  final kids = <Widget>[
    for (final child in kidNodes)
      if (child != null) context.buildNode(context.flutterContext, child),
  ];
  final own = node.text;
  if (own != null && own.trim().isNotEmpty) {
    // first child, like the text node sits in the DOM; the null keeps
    // kids[i] aligned with kidNodes[i] for the flex bookkeeping
    kids.insert(0, buildText(node, style, childNodes: const []));
    kidNodes.insert(0, null);
  }
  return KeyedSubtree(
    key: context.tree.globalKeyFor(node.id),
    child: decorateNode(style, buildBox(style, kids, kidNodes)),
  );
}
