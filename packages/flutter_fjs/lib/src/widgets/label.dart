// `label` tag -> a container that forwards a tap to one control.
//
// `for` matches a control's `id` prop; without it the label takes the first
// control that registered under it (document order). Checkbox / radio /
// switch get toggled, an input gets focused — the same split the browser
// makes, done by hand because fjs controls are not DOM form elements (the
// web adapter forwards the same way, see components/form.ts).
import 'package:flutter/widgets.dart';

import '../mirror_tree.dart';
import '../render/flex.dart';
import '../render/style.dart';
import 'control_scope.dart';
import 'text.dart';

class FjsLabel extends StatefulWidget {
  const FjsLabel({
    required this.node,
    required this.style,
    required this.children,
    required this.childNodes,
  });

  final MirrorNode node;
  final FjsStyle style;
  final List<Widget> children;
  final List<MirrorNode> childNodes;

  @override
  State<FjsLabel> createState() => _FjsLabelState();
}

class _FjsLabelState extends State<FjsLabel> {
  FjsControlRegistry? _own;

  void _activate() {
    final handles = _own?.handles ?? const <FjsControlHandle>[];
    final target = widget.node.props['for']?.toString();
    FjsControlHandle? hit;
    for (final handle in handles) {
      if (target == null) {
        hit = handle;
        break;
      }
      if (handle.getId() == target) {
        hit = handle;
        break;
      }
    }
    if (hit == null) {
      fjsWarnOnce(
        'label-no-target:${widget.node.id}',
        '<label> node ${widget.node.id} has no control to activate'
            '${target == null ? '' : ' (for="$target")'} — the tap does nothing.',
      );
      return;
    }
    // An input takes focus, everything else toggles. A control that offers
    // both would be ambiguous; none does today.
    if (hit.focus != null) {
      hit.focus!();
    } else {
      hit.toggle?.call();
    }
  }

  @override
  Widget build(BuildContext context) {
    final parent = FjsControlScope.of(context);
    final own = _own;
    if (own == null || !identical(own.parent, parent)) {
      _own = FjsControlRegistry(parent: parent);
    }

    // Vue compiles `<label>昵称</label>` to host text on the label node
    // itself. Before this tag existed the HTML compat table turned <label>
    // into a `text`, so dropping that text here would make it silently
    // vanish (constitution V) — render it the way a text node would.
    final kids = widget.children;
    final raw = widget.node.text ?? '';
    final content = kids.isEmpty && raw.isNotEmpty
        ? buildText(widget.node, widget.style)
        : buildBox(widget.style, kids, widget.childNodes);

    return FjsControlScope(
      registry: _own!,
      child: GestureDetector(
        onTap: _activate,
        // Opaque: the whole row is the hit area, which is the point of a
        // label. A control inside still wins the arena for its own box.
        behavior: HitTestBehavior.opaque,
        child: content,
      ),
    );
  }
}
