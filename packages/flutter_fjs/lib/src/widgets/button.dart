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

Widget buildButton(
  MirrorTree tree,
  MirrorNode node,
  FjsStyle style,
  FjsDispatch dispatch,
) {
  // Vue compiles <button>label</button> to a string child that lands on
  // the button node's own text (hostSetElementText), not a child text
  // element — so fall back to it when there are no text children.
  final childLabel = node.children
      .map((id) => tree.node(id))
      .whereType<MirrorNode>()
      .where((n) => n.tag == 'text')
      .map((n) => n.text ?? '')
      .join();
  final label = childLabel.isNotEmpty ? childLabel : (node.text ?? '');
  final chrome = fjsButtonChrome(node, style);
  final enabled = fjsButtonIsInteractive(node);
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
    child: chrome.loading
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
