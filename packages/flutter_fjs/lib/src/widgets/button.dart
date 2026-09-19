// `button` tag -> TextButton with Material's own chrome disabled.
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../render/gesture.dart';
import '../render/style.dart';
import 'dispatch.dart';

/// The look one `type` / `size` / `plain` combination asks for.
///
/// One place for the numbers on this side; `.fjs-button--*` in the web base
/// stylesheet carries the same ones. Colors follow the controls already
/// shipped (#007AFF), not WeUI's green — the press feedback is still WeUI's
/// 10% black mask (specs/007-form-components/plan.md §3.6).
class FjsButtonChrome {
  const FjsButtonChrome({
    required this.foreground,
    required this.background,
    required this.border,
    required this.padding,
    required this.fontSize,
    required this.disabled,
    required this.loading,
  });

  final Color foreground;
  final Color? background;
  final Color? border;
  final EdgeInsets padding;
  final double fontSize;
  final bool disabled;
  final bool loading;

  /// A button that neither dispatches nor shows press feedback.
  bool get inert => disabled || loading;
}

const _primary = Color(0xFF007AFF);
const _warn = Color(0xFFFF3B30);
const _onFilled = Color(0xFFFFFFFF);

/// `.fjs-button`'s default color in the web base stylesheet.
const _defaultForeground = _primary;
const _pressedMask = Color(0x1A000000); // rgba(0, 0, 0, 0.1)

const fjsButtonDefaultPadding = EdgeInsets.symmetric(
  horizontal: 16,
  vertical: 10,
);
const _miniPadding = EdgeInsets.symmetric(horizontal: 12, vertical: 6);
final fjsButtonDefaultBorderRadius = BorderRadius.circular(8);

/// The hairline a plain `<button>` draws.
///
/// This used to be injected from the JS side (the HTML compat table wrote
/// `border: 1px solid rgba(0,0,0,0.16)` onto every button). It moved here so
/// a filled variant can simply not have one: by the time a style reaches
/// Dart, an injected default is indistinguishable from a border the page
/// wrote itself. A page's own `border` still wins — it arrives as style.
const fjsButtonDefaultBorder = Color(0x29000000); // rgba(0, 0, 0, 0.16)

FjsButtonChrome fjsButtonChrome(MirrorNode node, FjsStyle style) {
  final type = node.props['type']?.toString() ?? 'default';
  final plain = fjsBool(node.props['plain']);
  final mini = node.props['size']?.toString() == 'mini';
  final accent = type == 'warn'
      ? _warn
      : type == 'primary'
      ? _primary
      : null;
  final filled = accent != null && !plain;
  return FjsButtonChrome(
    foreground:
        style.color ?? (filled ? _onFilled : accent ?? _defaultForeground),
    background: filled ? accent : null,
    border: filled ? null : (accent ?? fjsButtonDefaultBorder),
    padding: mini ? _miniPadding : fjsButtonDefaultPadding,
    fontSize: style.fontSize ?? (mini ? 12 : 14),
    disabled: fjsBool(node.props['disabled']),
    loading: fjsBool(node.props['loading']),
  );
}

/// Whether this button reacts to a tap at all: it needs something to do
/// (a handler, or a `form-type` inside a form) and must not be disabled or
/// loading.
bool fjsButtonIsInteractive(MirrorNode node) {
  if (fjsBool(node.props['disabled']) || fjsBool(node.props['loading'])) {
    return false;
  }
  return hasTapEvent(node) || node.props['formType'] != null;
}

/// The text a button shows: its own string child when Vue compiled one
/// (`<button>label</button>` lands as hostSetElementText on the node
/// itself), else the concatenation of the text in its subtree. The descent
/// goes through every tag, not just `text`: van-button renders
/// `<button><div class="van-button__content"><span class="van-button__text">
/// label</span></div></button>`, so the label sits under a `view`. Walking
/// the whole subtree is safe because the adapter renders no child widgets:
/// a label found there cannot draw twice.
String _buttonLabel(MirrorTree tree, MirrorNode node) {
  final own = node.text ?? '';
  if (own.isNotEmpty) return own;
  return node.children
      .map((id) => tree.node(id))
      .whereType<MirrorNode>()
      .map((n) => _buttonLabel(tree, n))
      .join();
}

/// Tags whose content a text label cannot stand in for. A button whose
/// subtree carries one of them must build its real children — vant's loading
/// spinner is an `svg` under `.van-button__loading`, and an icon button may
/// carry an `image`. Element wrappers around plain text (the usual
/// van-button structure) still take the label fast path.
const _visualTags = {'svg', 'image', 'canvas'};

bool _hasVisualDescendant(MirrorTree tree, MirrorNode node) {
  for (final id in node.children) {
    final child = tree.node(id);
    if (child == null) continue;
    if (_visualTags.contains(child.tag) || _hasVisualDescendant(tree, child)) {
      return true;
    }
  }
  return false;
}

/// Whether the CSS positions this button as clickable, by the one signal a
/// stylesheet can use for it on both ends: the cursor. vant marks its loading
/// button `cursor: default` and its disabled one `not-allowed` (fjs's own web
/// stylesheet does the same for `.fjs-button--loading`); on web the press mask
/// is a `:active` pseudo those rules hide or silence, so the chrome mask here
/// stands down for them too. No cursor declaration at all — the common case,
/// since base styles never reach the app — keeps the mask.
bool fjsButtonCursorAllowsPress(MirrorNode node) {
  final cursor = node.styleMap['cursor']?.toString().toLowerCase();
  return cursor != 'default' && cursor != 'none' && cursor != 'not-allowed';
}

Widget buildButton(
  MirrorTree tree,
  MirrorNode node,
  FjsStyle style,
  FjsDispatch dispatch, {
  List<Widget> Function()? buildChildren,
}) {
  final label = _buttonLabel(tree, node);
  final chrome = fjsButtonChrome(node, style);
  final enabled = fjsButtonIsInteractive(node);
  final rich = buildChildren != null && _hasVisualDescendant(tree, node);
  // `form-type` is handled on the JS side (components/form.ts installs a
  // real onTap on the button node), so nothing to do here beyond the page's
  // own tap handler.
  void onPressed() {
    if (hasTapEvent(node)) dispatchTap(node, dispatch);
  }

  final text = Text(
    label,
    style: TextStyle(
      fontSize: chrome.fontSize,
      fontWeight: style.fontWeight ?? FontWeight.w400,
      fontStyle: style.fontStyle,
      fontFamily: style.fontFamily,
      fontFamilyFallback: style.fontFamilyFallback,
      height: 1.4,
      leadingDistribution: TextLeadingDistribution.even,
    ),
  );

  final button = TextButton(
    onPressed: enabled ? onPressed : null,
    style:
        TextButton.styleFrom(
          foregroundColor: chrome.foreground,
          // A disabled TextButton greys its own label; the whole button is
          // faded instead (below), the way `.fjs-button:disabled` does.
          disabledForegroundColor: chrome.foreground,
          padding: EdgeInsets.zero,
          minimumSize: Size.zero,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          textStyle: const TextStyle(fontWeight: FontWeight.w400),
          // Press feedback is the Stack mask below, driven by pointer-down —
          // Material's own overlay waits for the tap recognizer to win the
          // arena (`kPressTimeout`), so a quick tap painted nothing. Keep
          // InkWell visually inert.
          animationDuration: Duration.zero,
        ).copyWith(
          overlayColor: const WidgetStatePropertyAll(Colors.transparent),
          splashFactory: NoSplash.splashFactory,
        ),
    child: rich
        // the subtree paints itself (spinner svg, icon image); the Row only
        // stands in for the button box's own content layout when a page put
        // several children directly on the button
        ? Row(mainAxisSize: MainAxisSize.min, children: buildChildren())
        : chrome.loading
        ? Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox.square(
                dimension: 14,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: chrome.foreground,
                ),
              ),
              if (label.isNotEmpty) const SizedBox(width: 8),
              if (label.isNotEmpty) text,
            ],
          )
        : text,
  );

  return chrome.disabled ? Opacity(opacity: 0.5, child: button) : button;
}

/// Test hook: the default press mask is present iff the button is down.
const fjsButtonPressMaskKey = ValueKey<String>('fjs-button-press-mask');

Decoration? fjsButtonForegroundDecoration(FjsStyle style, bool active) {
  if (!active) return null;
  return BoxDecoration(
    color: _pressedMask,
    borderRadius: style.borderRadius ?? fjsButtonDefaultBorderRadius,
  );
}
