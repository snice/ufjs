import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart' show MirrorNode;
import '../render/style.dart' show FjsStyle;
import '../render/decoration.dart';
import '../render/flex.dart';
import '../render/stretch_flex.dart' show FjsShrinkCross;
import '../widgets/button.dart';
import '../widgets/canvas.dart';
import '../widgets/checkbox.dart';
import '../widgets/control_scope.dart' show fjsWarnOnce;
import '../widgets/group.dart';
import '../widgets/image.dart';
import '../widgets/input.dart';
import '../widgets/label.dart';
import 'overlay_host_adapter.dart';
import '../widgets/list_view.dart';
import '../widgets/modal.dart';
import '../widgets/page_container.dart';
import '../widgets/picker_view.dart';
import '../widgets/progress.dart';
import '../widgets/radio.dart';
import '../widgets/scroll_behavior.dart';
import '../widgets/scroll_view.dart';
import '../widgets/slider.dart';
import '../widgets/sticky.dart';
import '../widgets/svg.dart';
import '../widgets/swiper.dart';
import '../widgets/switch.dart';
import '../widgets/text.dart';
import 'node_adapter.dart';

const viewNodeAdapter = _ViewNodeAdapter();

const builtInNodeAdapters = <FjsNodeAdapter>[
  viewNodeAdapter,
  _TextNodeAdapter(),
  _ImageNodeAdapter(),
  _CanvasNodeAdapter(),
  _SvgNodeAdapter(),
  _ButtonNodeAdapter(),
  _InputNodeAdapter(),
  _ScrollViewNodeAdapter(),
  _ListViewNodeAdapter(),
  _SwitchNodeAdapter(),
  _CheckboxNodeAdapter(),
  _RadioNodeAdapter(),
  _RadioGroupNodeAdapter(),
  _CheckboxGroupNodeAdapter(),
  _LabelNodeAdapter(),
  _SliderNodeAdapter(),
  _PickerViewNodeAdapter(),
  _PickerViewColumnNodeAdapter(),
  _ProgressNodeAdapter(),
  _DividerNodeAdapter(),
  _SafeAreaNodeAdapter(),
  _RefreshNodeAdapter(),
  _SwiperNodeAdapter(),
  _SwiperItemNodeAdapter(),
  _ModalNodeAdapter(),
  _PageContainerNodeAdapter(),
  _StickyHeaderNodeAdapter(),
  _StickySectionNodeAdapter(),
  OverlayHostNodeAdapter(),
];

final builtInNodeAdapterByTag = Map<String, FjsNodeAdapter>.unmodifiable({
  for (final adapter in builtInNodeAdapters) adapter.tag: adapter,
});

class _TextNodeAdapter extends FjsNodeAdapter {
  const _TextNodeAdapter();

  @override
  String get tag => 'text';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildText(
      context.node,
      context.style,
      tree: context.tree,
      childNodes: context.childNodes,
      buildNode: (child) => context.buildNode(context.flutterContext, child),
    );
  }
}

class _ImageNodeAdapter extends FjsNodeAdapter {
  const _ImageNodeAdapter();

  @override
  String get tag => 'image';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildImage(context.node, context.style, context.dispatch);
  }
}

/// The drawing surface. `canvas` itself is a JS component that wraps this in
/// a box with an overlay slot (fjs-runtime/src/components/canvas.ts), so the
/// tag that reaches this side is the inner one.
class _CanvasNodeAdapter extends FjsNodeAdapter {
  const _CanvasNodeAdapter();

  @override
  String get tag => 'inner-canvas';

  @override
  Widget build(FjsNodeAdapterContext context) {
    // children are ignored: the DOM treats a canvas' children as fallback
    // content for browsers that cannot render one, and fjs always can
    return buildCanvas(context.node, context.dispatch);
  }
}

/// Inline `<svg>`: the node paints its whole shape subtree itself, so the
/// children are never built as widgets (widgets/svg.dart).
class _SvgNodeAdapter extends FjsNodeAdapter {
  const _SvgNodeAdapter();

  @override
  String get tag => 'svg';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsSvg(tree: context.tree, nodeId: context.node.id);
  }
}

class _ButtonNodeAdapter extends FjsNodeAdapter {
  const _ButtonNodeAdapter();

  @override
  String get tag => 'button';

  @override
  Widget build(FjsNodeAdapterContext context) {
    final button = buildButton(
      context.tree,
      context.node,
      context.style,
      context.dispatch,
      buildChildren: context.buildChildren,
    );
    // The button draws its label, not its children — except absolutely
    // positioned ones, which are decoration over the box: vant's stepper
    // +/- signs are `::before`/`::after` lines centred on a bare <button>.
    // Lay those over it like any positioned box does.
    final over = <(MirrorNode?, Widget)>[
      for (final child in context.childNodes)
        if (context.style.isPositioningContext &&
            isOutOfFlowPosition(FjsStyle.of(child).position))
          (child, context.buildNode(context.flutterContext, child)),
    ];
    if (over.isEmpty) return button;
    return stackOutOfFlow(context.style, button, over);
  }

  @override
  Widget decorate(FjsNodeAdapterContext context, Widget content) {
    final chrome = fjsButtonChrome(context.node, context.style);
    final active =
        context.pressed &&
        fjsButtonIsInteractive(context.node) &&
        fjsButtonCursorAllowsPress(context.node);
    return decorateNode(
      context.style,
      content,
      defaultPadding: chrome.padding,
      defaultBorderRadius: fjsButtonDefaultBorderRadius,
      defaultBackgroundColor: chrome.background,
      defaultBorderColor: chrome.border,
      foregroundDecoration: fjsButtonForegroundDecoration(
        context.style,
        active,
      ),
      foregroundKey: active ? fjsButtonPressMaskKey : null,
      keepsBox: context.keepsBox,
    );
  }
}

class _InputNodeAdapter extends FjsNodeAdapter {
  const _InputNodeAdapter();

  @override
  String get tag => 'input';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsInput(
      node: context.node,
      style: context.style,
      dispatch: context.dispatch,
    );
  }
}

/// Scroll views already warned about, so the message appears once per node
/// rather than once per frame.
final Set<int> _warnedFatScrollViews = <int>{};

/// Above this many children, a `scroll-view` is the wrong tag.
///
/// Painting the off-screen ones is handled — render/cull.dart skips them —
/// but a `SingleChildScrollView` still holds a plain [Column], so every child
/// is still BUILT and LAID OUT, and a restyle still rebuilds all of them.
/// `list-view` is a `ListView.builder`: the rows outside the viewport cost a
/// mirror node and nothing else. Measured on an iPhone 17 Pro simulator,
/// debug; see docs/performance.md.
const int _fatScrollViewChildren = 200;

class _ScrollViewNodeAdapter extends FjsNodeAdapter {
  const _ScrollViewNodeAdapter();

  @override
  String get tag => 'scroll-view';

  @override
  Widget build(FjsNodeAdapterContext context) {
    final nodes = context.childNodes;
    // A scroll-view hosting sticky tags — or plain views carrying
    // `position: sticky` (specs/053), the style-level spelling of the same
    // intent — takes the sliver route; type="custom" is the mini-program
    // spelling of it and carries no extra meaning here.
    if (nodes.any(fjsIsStickyNode)) {
      final built = fjsStickySplit(
        context: context,
        scrollStyle: context.style,
        nodes: nodes,
        kids: context.buildChildren(),
      );
      return FjsScrollView(
        node: context.node,
        tree: context.tree,
        style: context.style,
        dispatch: context.dispatch,
        slivers: built.slivers,
        stickyHeaderIds: built.headerIds,
      );
    }
    assert(() {
      final count = nodes.length;
      if (count >= _fatScrollViewChildren &&
          _warnedFatScrollViews.add(context.node.id)) {
        debugPrint(
          'fjs: <scroll-view> node ${context.node.id} has $count children. '
          'Painting off-screen rows is culled, but a scroll-view still builds '
          'and lays out every one of them. Use <list-view> for a long list — '
          'it only materializes the viewport. (docs/performance.md)',
        );
      }
      return true;
    }());
    return FjsScrollView(
      node: context.node,
      tree: context.tree,
      style: context.style,
      dispatch: context.dispatch,
      // This is the content that scrolls, so page-root growth does not apply
      // inside it.
      //
      // `cull: true` is the one place it belongs: a scroller is the only box
      // whose children are reliably outside the clip, and a Column otherwise
      // paints all of them on every frame. Paint only — layout and hit
      // testing still see every child (render/cull.dart).
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
        cull: true,
      ),
    );
  }
}

class _ListViewNodeAdapter extends FjsNodeAdapter {
  const _ListViewNodeAdapter();

  @override
  String get tag => 'list-view';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return ScrollConfiguration(
      behavior: const FjsMouseDragScrollBehavior(),
      child: FjsListView(
        key: PageStorageKey<String>(
          'fjs-list-${context.tree.generation}-${context.node.id}',
        ),
        node: context.node,
        style: context.style,
        items: context.childNodes,
        buildItem: context.buildNode,
        dispatch: context.dispatch,
      ),
    );
  }
}

class _RadioNodeAdapter extends FjsNodeAdapter {
  const _RadioNodeAdapter();

  @override
  String get tag => 'radio';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsRadio(
      node: context.node,
      dispatch: context.dispatch,
      children: context.buildChildren(),
      childNodes: context.childNodes,
    );
  }
}

/// radio-group / checkbox-group: no chrome of their own, just a control
/// scope around an ordinary box (widgets/group.dart).
class _RadioGroupNodeAdapter extends FjsNodeAdapter {
  const _RadioGroupNodeAdapter();

  @override
  String get tag => 'radio-group';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsControlGroup(
      node: context.node,
      dispatch: context.dispatch,
      multiple: false,
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
      ),
    );
  }
}

class _CheckboxGroupNodeAdapter extends FjsNodeAdapter {
  const _CheckboxGroupNodeAdapter();

  @override
  String get tag => 'checkbox-group';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsControlGroup(
      node: context.node,
      dispatch: context.dispatch,
      multiple: true,
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
      ),
    );
  }
}

class _LabelNodeAdapter extends FjsNodeAdapter {
  const _LabelNodeAdapter();

  @override
  String get tag => 'label';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsLabel(
      node: context.node,
      style: context.style,
      children: context.buildChildren(),
      childNodes: context.childNodes,
    );
  }
}

class _SwitchNodeAdapter extends FjsNodeAdapter {
  const _SwitchNodeAdapter();

  @override
  String get tag => 'switch';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsSwitch(node: context.node, dispatch: context.dispatch);
  }
}

class _CheckboxNodeAdapter extends FjsNodeAdapter {
  const _CheckboxNodeAdapter();

  @override
  String get tag => 'checkbox';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsCheckbox(
      node: context.node,
      dispatch: context.dispatch,
      children: context.buildChildren(),
      childNodes: context.childNodes,
    );
  }
}

class _SliderNodeAdapter extends FjsNodeAdapter {
  const _SliderNodeAdapter();

  @override
  String get tag => 'slider';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsSlider(node: context.node, dispatch: context.dispatch);
  }
}

class _ProgressNodeAdapter extends FjsNodeAdapter {
  const _ProgressNodeAdapter();

  @override
  String get tag => 'progress';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildProgress(context.node);
  }
}

class _DividerNodeAdapter extends FjsNodeAdapter {
  const _DividerNodeAdapter();

  @override
  String get tag => 'divider';

  @override
  Widget build(FjsNodeAdapterContext context) {
    // Web: `divider` is a 16px box with a 1px #e0e0e0 rule down the middle.
    return Divider(
      color: context.style.color ?? const Color(0xFFE0E0E0),
      height: context.style.height ?? 16,
      thickness: 1,
    );
  }
}

class _SafeAreaNodeAdapter extends FjsNodeAdapter {
  const _SafeAreaNodeAdapter();

  @override
  String get tag => 'safe-area';

  @override
  Widget build(FjsNodeAdapterContext context) {
    // edges="top bottom": only the named edges take the inset; omitted means
    // all four. Same attribute the web stylesheet and the mini-program
    // component read.
    final raw = context.node.props['edges'];
    final named = raw == null
        ? null
        : raw
              .toString()
              .split(RegExp(r'[\s,]+'))
              .where((e) => e.isNotEmpty)
              .toSet();
    bool edge(String name) => named == null || named.contains(name);
    return SafeArea(
      top: edge('top'),
      bottom: edge('bottom'),
      left: edge('left'),
      right: edge('right'),
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
        growChildren: context.isRoot,
      ),
    );
  }
}

class _RefreshNodeAdapter extends FjsNodeAdapter {
  const _RefreshNodeAdapter();

  @override
  String get tag => 'refresh';

  @override
  Widget build(FjsNodeAdapterContext context) {
    final children = context.buildChildren();
    return RefreshIndicator(
      onRefresh: () async {
        context.dispatch(context.node.id, FjsEvent.refresh);
        await Future<void>.delayed(const Duration(milliseconds: 600));
      },
      child: children.isNotEmpty
          ? children.single
          : ListView(children: const []),
    );
  }
}

class _SwiperNodeAdapter extends FjsNodeAdapter {
  const _SwiperNodeAdapter();

  @override
  String get tag => 'swiper';

  @override
  Widget build(FjsNodeAdapterContext context) {
    // The compiler rejects a bare child in a template (specs/051), so one
    // here came from the element API or a <slot>. It still pages — dropping
    // it would lose content — but says so, as the web component does. This
    // is the place to look rather than element.insert in JS: there a Vue
    // v-if anchor is a `view` too, and only childNodes has them filtered out.
    for (final child in context.childNodes) {
      if (child.tag != 'swiper-item') {
        fjsWarnOnce(
          'swiper-bare-page:${context.node.id}',
          '<swiper> node ${context.node.id}: child <${child.tag}> is not a '
              '<swiper-item>; it is shown as a page anyway, but wrap it in '
              '<swiper-item>.',
        );
        break;
      }
    }
    return FjsSwiper(
      node: context.node,
      style: context.style,
      dispatch: context.dispatch,
      pages: context.buildChildren(),
    );
  }
}

/// `swiper-item` has no behaviour of its own — the pager counts children,
/// not items (a bare child from the element API still pages, with a warning
/// above) — so it is a plain container that fills its page. Registered
/// rather than left to the fallback so it does not read as an unknown tag.
class _SwiperItemNodeAdapter extends FjsNodeAdapter {
  const _SwiperItemNodeAdapter();

  @override
  String get tag => 'swiper-item';

  @override
  Widget build(FjsNodeAdapterContext context) {
    // A page fills the pager. PageView hands the page a tight box, but the
    // box buildBox makes shrink-wraps its column, so the content would sit
    // as a strip at the top; SizedBox.expand restates the tight box and
    // growChildren stretches the content inside it. The web adapter's
    // `swiper-item` / `swiper-item > *` rules say the same thing.
    return SizedBox.expand(
      child: buildBox(
        context.style,
        context.buildChildren(),
        context.childNodes,
        growChildren: true,
      ),
    );
  }
}

class _PickerViewNodeAdapter extends FjsNodeAdapter {
  const _PickerViewNodeAdapter();

  @override
  String get tag => 'picker-view';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsPickerView(
      node: context.node,
      tree: context.tree,
      style: context.style,
      dispatch: context.dispatch,
      // The wheel builds its own rows lazily, so it needs a per-node
      // builder rather than the whole child list up front.
      buildNode: (child) => context.buildNode(context.flutterContext, child),
    );
  }
}

/// A column has no chrome of its own — the wheel above reads its children
/// and lays them out. Reached only when a page puts one outside a
/// <picker-view>, where it should behave like a plain container.
class _PickerViewColumnNodeAdapter extends FjsNodeAdapter {
  const _PickerViewColumnNodeAdapter();

  @override
  String get tag => 'picker-view-column';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return buildBox(context.style, context.buildChildren(), context.childNodes);
  }
}

class _ModalNodeAdapter extends FjsNodeAdapter {
  const _ModalNodeAdapter();

  @override
  String get tag => 'modal';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsModal(
      node: context.node,
      tree: context.tree,
      dispatch: context.dispatch,
      registry: context.registry,
    );
  }
}

class _PageContainerNodeAdapter extends FjsNodeAdapter {
  const _PageContainerNodeAdapter();

  @override
  String get tag => 'page-container';

  @override
  Widget build(FjsNodeAdapterContext context) {
    return FjsPageContainer(
      node: context.node,
      tree: context.tree,
      dispatch: context.dispatch,
      registry: context.registry,
    );
  }
}

/// sticky-header / sticky-section outside the sticky split: the scroll-view
/// adapter consumes both tags itself when building its slivers
/// (widgets/sticky.dart), so reaching this adapter means the tag is NOT a
/// direct child of a sticky-hosting scroll-view — where pinning is
/// impossible. Render as a plain container and say so (constitution V).
class _StickyHeaderNodeAdapter extends FjsNodeAdapter {
  const _StickyHeaderNodeAdapter();

  @override
  String get tag => 'sticky-header';

  @override
  Widget build(FjsNodeAdapterContext context) {
    _warnOutsideSticky(context);
    return buildBox(context.style, context.buildChildren(), context.childNodes);
  }
}

class _StickySectionNodeAdapter extends FjsNodeAdapter {
  const _StickySectionNodeAdapter();

  @override
  String get tag => 'sticky-section';

  @override
  Widget build(FjsNodeAdapterContext context) {
    _warnOutsideSticky(context);
    return buildBox(context.style, context.buildChildren(), context.childNodes);
  }
}

void _warnOutsideSticky(FjsNodeAdapterContext context) {
  fjsWarnOnce(
    'sticky-outside:${context.node.id}',
    '<${context.node.tag}> node ${context.node.id} is only sticky as a '
        'DIRECT child of a scroll-view that hosts sticky tags (type="custom" on '
        'the mini program). It renders as a plain container here.',
  );
}

class _ViewNodeAdapter extends FjsNodeAdapter {
  const _ViewNodeAdapter();

  @override
  String get tag => 'view';

  /// An HTML block box (`div`, marked `htmlBlock` by the Vue renderer)
  /// whose content is only inline text — spans and bare text nodes — is
  /// ONE paragraph in the browser: vant's word limit is `<div><span>0</span>
  /// /50</div>`, and laying the three out as a column stood them on three
  /// lines. An fjs view has no marker and keeps stacking its children, as
  /// its web adapter does. Any child that is a box of its own (a view, an
  /// image, a block/flex/positioned text) keeps the ordinary layout: there
  /// is no general inline formatting context (css-compat.md).
  static bool _isInlineParagraph(FjsNodeAdapterContext context) {
    final node = context.node;
    if (node.props['htmlBlock'] != true) return false;
    final display = context.style.display;
    if (display != null && display != 'block') return false;
    final kids = context.childNodes;
    final ownText = node.text != null && node.text!.isNotEmpty;
    if (kids.isEmpty || (kids.length < 2 && !ownText)) return false;
    for (final kid in kids) {
      if (kid.tag != 'text' || kid.props['htmlBlock'] == true) return false;
      final style = FjsStyle.of(kid);
      final d = style.display;
      if (d != null && d != 'inline') return false;
      if (isOutOfFlowPosition(style.position)) return false;
    }
    return true;
  }

  /// A block box's children in the browser's block formatting context:
  /// a run of consecutive INLINE-LEVEL children (`inline-block` /
  /// `inline-flex` boxes and plain text runs — van-card's tags after its
  /// block title, the price + origin price) shares one anonymous line box,
  /// block children stack. An fjs view would stack every one of them
  /// stretched full width, so such a run becomes one wrapping line here;
  /// runs of pure text went to [_isInlineParagraph] (real text layout), and
  /// a lone inline box keeps the ordinary shrink-to-fit item (flex.dart).
  /// Not a general inline formatting context (css-compat.md): the line
  /// aligns the boxes' bottoms, the nearest native shape of a baseline.
  ///
  /// `float: right` children (van-card's num) leave the flow and pin to the
  /// right edge, top-down, beside the in-flow content — the one float the
  /// engine knows; `float: left` and text wrapping round a float stay
  /// unsupported.
  static Widget? _buildBlockFlow(
    FjsNodeAdapterContext context,
    List<Widget> kids,
  ) {
    final nodes = context.childNodes;
    if (kids.length != nodes.length) return null;
    final flow = <Widget>[];
    final flowNodes = <MirrorNode?>[];
    final floated = <Widget>[];
    final run = <Widget>[];
    final runNodes = <MirrorNode>[];
    var runBoxes = 0;
    var changed = false;
    final align = switch (context.style.textAlign) {
      TextAlign.center => WrapAlignment.center,
      TextAlign.right => WrapAlignment.end,
      _ => WrapAlignment.start,
    };
    void flush() {
      if (run.length >= 2 && runBoxes > 0) {
        flow.add(
          Wrap(
            alignment: align,
            crossAxisAlignment: WrapCrossAlignment.end,
            children: List.of(run),
          ),
        );
        flowNodes.add(null);
        changed = true;
      } else {
        flow.addAll(run);
        flowNodes.addAll(runNodes);
      }
      run.clear();
      runNodes.clear();
      runBoxes = 0;
    }

    for (var i = 0; i < kids.length; i++) {
      final kid = nodes[i];
      final style = FjsStyle.of(kid);
      final inFlow = !isOutOfFlowPosition(style.position);
      if (inFlow &&
          (kid.styleMap['float'] ?? kid.props['float'])?.toString() ==
              'right') {
        floated.add(kids[i]);
        changed = true;
        continue;
      }
      final d = style.display;
      // a text run is a text node WITHOUT an inline-level display of its
      // own; a text node styled inline-block/inline-flex is a BOX (van-tag).
      // `htmlBlock` only says the tag is a div: its display decides (the
      // price is an inline-block div)
      final textRun =
          kid.tag == 'text' &&
          kid.props['htmlBlock'] != true &&
          (d == null || d == 'inline');
      final box =
          d == 'inline-block' ||
          d == 'inline-flex' ||
          (d == 'inline' && kid.tag != 'text');
      if (inFlow && (textRun || box)) {
        // shrink-to-fit (CSS): an inline box holding block content (the
        // price's inner div) would otherwise take the whole line
        run.add(box ? FjsShrinkCross(child: kids[i]) : kids[i]);
        runNodes.add(kid);
        if (box) runBoxes++;
        continue;
      }
      flush();
      flow.add(kids[i]);
      flowNodes.add(kid);
    }
    flush();
    if (!changed) return null;
    if (floated.isEmpty) {
      return buildBox(
        context.style,
        flow,
        flowNodes,
        growChildren: context.isRoot,
        htmlBlock: true,
      );
    }
    return buildBox(
      context.style,
      [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: buildBox(FjsStyle(const {'style': {}}), flow, flowNodes),
            ),
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: floated,
            ),
          ],
        ),
      ],
      const [null],
      growChildren: context.isRoot,
      htmlBlock: true,
    );
  }

  @override
  Widget build(FjsNodeAdapterContext context) {
    if (_isInlineParagraph(context)) {
      return buildBox(
        context.style,
        [
          buildText(
            context.node,
            context.style,
            tree: context.tree,
            childNodes: context.childNodes,
            buildNode: (child) =>
                context.buildNode(context.flutterContext, child),
          ),
        ],
        const [null],
        growChildren: context.isRoot,
        htmlBlock: true,
      );
    }
    final kids = context.buildChildren();
    // A view whose content is a bare string (`<view>文字</view>`, `{{ x }}`)
    // carries it as the node's own element text: Vue hands it over through
    // setElementText and the browser paints it as a text node inside the
    // view. There is no child node to build here, so synthesize one from the
    // view's own style — the inheritables (color / font family / size …) are
    // already resolved into it, which is exactly the cascade the web text
    // node sees. Appended last so `kids[i]` stays aligned with
    // `childNodes[i]` for the flex bookkeeping.
    final own = context.node.text;
    if (own != null && own.trim().isNotEmpty) {
      // first child, like the text node sits in the DOM; the null in the
      // node list keeps kids[i] aligned with childNodes[i] for the flex
      // bookkeeping (percent widths, culling)
      return buildBox(
        context.style,
        [buildText(context.node, context.style, childNodes: const []), ...kids],
        [null, ...context.childNodes],
        growChildren: context.isRoot,
        htmlBlock: context.node.props['htmlBlock'] == true,
      );
    }
    if (context.node.props['htmlBlock'] == true &&
        (context.style.display == null || context.style.display == 'block')) {
      final flow = _buildBlockFlow(context, kids);
      if (flow != null) return flow;
    }
    return buildBox(
      context.style,
      kids,
      context.childNodes,
      growChildren: context.isRoot,
      htmlBlock: context.node.props['htmlBlock'] == true,
    );
  }
}
