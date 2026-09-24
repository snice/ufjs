// `input` tag -> TextField.
//
// A multiline input is what `<textarea>` renders (components/textarea.ts):
// the tag is a JS component, but four things it needs are the platform
// control's own and are implemented here — the internal scroll when
// `auto-height` is off, the measured line count, focus, and the keyboard's
// confirm key. They are props of this widget, so `<input multiline>` gets
// them too; `textarea` is the documented entry point, not a second
// implementation.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/style.dart';
import '../render/style_parse.dart'
    show parseColor, parseFontWeight, parseLength;
import '../render/text_lines.dart';
import 'control_scope.dart';
import 'dispatch.dart';

class FjsInput extends StatefulWidget {
  const FjsInput({
    required this.node,
    required this.style,
    required this.dispatch,
  });

  final MirrorNode node;
  final FjsStyle style;
  final FjsDispatch dispatch;

  @override
  State<FjsInput> createState() => _FjsInputState();
}

class _FjsInputState extends State<FjsInput>
    with FjsControlRegistration<FjsInput> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.node.props['value']?.toString() ?? '',
  );
  late final FocusNode _focusNode = FocusNode()..addListener(_onFocusChange);

  @override
  FjsControlHandle createControlHandle() => FjsControlHandle(
    nodeId: widget.node.id,
    kind: FjsControlKind.input,
    getName: () => widget.node.props['name']?.toString(),
    getId: () => widget.node.props['id']?.toString(),
    // The live text, not the `value` prop: an fjs input may be
    // uncontrolled, and then the prop was never written.
    getValue: () => _controller.text,
    focus: () => _focusNode.requestFocus(),
    blur: () => _focusNode.unfocus(),
  );

  /// One event per transition. A FocusNode fires its listener for other
  /// reasons too (focus moving between descendants, the node being
  /// re-parented), and on iOS the keyboard closing, a route push and the
  /// page being torn down all take this path.
  bool _focused = false;

  void _onFocusChange() {
    final has = _focusNode.hasFocus;
    if (has == _focused) return;
    _focused = has;
    widget.dispatch(
      widget.node.id,
      has ? FjsEvent.focus : FjsEvent.blur,
      text: _controller.text,
    );
  }

  bool get _multiline => fjsBool(widget.node.props['multiline']);

  /// `auto-height`: the box grows with the content and `style.height` is
  /// ignored. Off (the default) the box keeps its size and the field scrolls
  /// inside it — see [_maxLines].
  bool get _autoHeight => fjsBool(widget.node.props['autoHeight']);

  /// The three shapes a multiline field can take (specs/012 §3.4).
  ///
  ///  * `auto-height`  -> null, the field grows without bound;
  ///  * a styled height -> null with `expands`, filling the box the page
  ///    sized and scrolling inside it;
  ///  * neither        -> `rows` (the DOM attribute vant binds; default 3,
  ///    which is the mini program's default and, unlike a pixel height,
  ///    follows the font size). A TextField at its maxLines scrolls
  ///    internally rather than overflowing, which is exactly the wanted
  ///    behaviour.
  int? get _maxLines {
    if (!_multiline) return 1;
    if (_autoHeight) return null;
    return widget.style.height != null ? null : _rows;
  }

  /// `rows`: the DOM textarea attribute, bound by vant's Field. A string
  /// arrives when the page wrote `rows="2"` as a static attribute.
  int get _rows {
    final raw = widget.node.props['rows'];
    final value = raw is num ? raw.toInt() : int.tryParse('${raw ?? ''}');
    return value != null && value > 0 ? value : _defaultMultilineLines;
  }

  /// `expands` needs a bounded parent, so it is only used when the page
  /// actually gave the box a height — checked on the RESOLVED style, not on
  /// whether a `style` prop exists.
  bool get _expands =>
      _multiline && !_autoHeight && widget.style.height != null;

  static const int _defaultMultilineLines = 3;

  /// `confirm-type`, else the DOM `enterkeyhint` (same values; `enter` is
  /// `return`), else a `type="search"` field's search key — what a browser
  /// shows for it. `return` (the default) means the key inserts a newline,
  /// which is also why it does not fire `@confirm`.
  TextInputAction? get _textInputAction {
    final confirm = widget.node.props['confirmType']?.toString();
    final hint = widget.node.props['enterkeyhint']?.toString().toLowerCase();
    final key =
        confirm ??
        (hint == 'enter' ? 'return' : hint) ??
        (_domType == 'search' ? 'search' : null);
    switch (key) {
      case 'send':
        return TextInputAction.send;
      case 'search':
        return TextInputAction.search;
      case 'next':
        return TextInputAction.next;
      case 'go':
        return TextInputAction.go;
      case 'done':
        return TextInputAction.done;
      default:
        // An unknown value already warned on the JS side; fall back the way
        // the contract says.
        return _multiline ? TextInputAction.newline : null;
    }
  }

  /// Whether pressing the confirm key reports `@confirm` (号 4, the same
  /// event `input` calls `@submit`). A newline key never does.
  bool get _confirmReports =>
      !_multiline || _textInputAction != TextInputAction.newline;

  /// `placeholder-style`: the four keys both platforms honour. Unknown keys
  /// warned on the JS side (textarea/props.ts) and never arrive with a
  /// meaning of their own, so they are just skipped here.
  TextStyle _hintStyle(FjsStyle style) {
    var color = const Color(0xFF999999);
    var fontSize = style.fontSize ?? 14.0;
    FontWeight? fontWeight;
    // A browser lays the placeholder out in the input's own line box, so
    // with no `line-height` key it takes the field's — a fixed 1.4 made an
    // empty field a different height from a filled one.
    var height = _lineHeight(style);
    final raw = widget.node.props['placeholderStyle']?.toString();
    if (raw != null && raw.isNotEmpty) {
      for (final part in raw.split(';')) {
        final at = part.indexOf(':');
        if (at < 0) continue;
        final key = part.substring(0, at).trim().toLowerCase();
        final value = part.substring(at + 1).trim();
        if (value.isEmpty) continue;
        switch (key) {
          case 'color':
            color = parseColor(value) ?? color;
          case 'font-size':
            fontSize = parseLength(value) ?? fontSize;
          case 'font-weight':
            fontWeight = parseFontWeight(value);
          case 'line-height':
            height = double.tryParse(value) ?? height;
        }
      }
    }
    return TextStyle(
      color: color,
      fontSize: fontSize,
      fontWeight: fontWeight,
      height: height,
      leadingDistribution: TextLeadingDistribution.even,
    );
  }

  /// `-1` (and anything not a positive number) means no limit, as in the
  /// mini-program contract the web adapter also implements.
  int? get _maxLength {
    final raw = widget.node.props['maxlength'];
    final value = raw is num ? raw.toInt() : int.tryParse('${raw ?? ''}');
    return value != null && value > 0 ? value : null;
  }

  /// The page's DOM `type`, lower-cased. vant's Field writes `type`,
  /// `inputmode` and `enterkeyhint` the way it would on a browser <input>
  /// (its mapInputType turns `digit` into `tel` + `numeric` and `number`
  /// into `text` + `decimal`) and never the fjs props, so they are read here
  /// as aliases — without them a password field showed its text and every
  /// numeric field got the full keyboard (specs/125).
  String? get _domType => widget.node.props['type']?.toString().toLowerCase();

  /// `secure` or a DOM `type="password"`. Never on a multiline field: a
  /// browser has no masked textarea, and TextField asserts on one.
  bool get _obscure =>
      !_multiline &&
      (fjsBool(widget.node.props['secure']) || _domType == 'password');

  /// Precedence follows the browser, with the fjs prop on top: `keyboard`,
  /// then `inputmode` (which a browser lets override `type`), then `type`.
  /// Unknown values fall through to text, as a browser's do.
  TextInputType? get _keyboardType {
    final fallback = _multiline ? TextInputType.multiline : null;
    final keyboard = widget.node.props['keyboard']?.toString();
    if (keyboard != null && keyboard.isNotEmpty) {
      return _keyboardFor(keyboard) ?? fallback;
    }
    final mode = widget.node.props['inputmode']?.toString().toLowerCase();
    final fromMode = mode == null ? null : _keyboardFor(mode);
    if (fromMode != null) return fromMode;
    final fromType = _domType == null ? null : _keyboardFor(_domType!);
    return fromType ?? fallback;
  }

  /// One table for `keyboard`, `inputmode` and `type` values — they share
  /// most names. `numeric` is a number pad with no decimal point, as iOS
  /// shows it for the attribute.
  static TextInputType? _keyboardFor(String value) {
    switch (value) {
      case 'number':
      case 'numeric':
        return TextInputType.number;
      case 'decimal':
        return const TextInputType.numberWithOptions(decimal: true);
      case 'tel':
        return TextInputType.phone;
      case 'email':
        return TextInputType.emailAddress;
      case 'url':
        return TextInputType.url;
      default:
        return null;
    }
  }

  /// Last value seen in props. JS-managed inputs change this prop; inputs
  /// without a `value` prop keep it stable so user typing is never clobbered.
  String? _lastPropValue;

  /// Last `focus` prop we acted on. Controlled the same way `value` is: only
  /// a CHANGE moves the focus. Without this the field would grab focus back
  /// every rebuild — the prop is still true after the user tapped away, and
  /// the keyboard could never be dismissed.
  bool? _lastPropFocus;

  void _syncFocus() {
    final raw = widget.node.props['focus'];
    if (raw == null) return;
    final wanted = fjsBool(raw);
    if (_lastPropFocus == wanted) return;
    _lastPropFocus = wanted;
    if (wanted) {
      _focusNode.requestFocus();
    } else if (_focusNode.hasFocus) {
      _focusNode.unfocus();
    }
  }

  @override
  void initState() {
    super.initState();
    final props = widget.node.props;
    // The controller already starts from this value: record it, or the
    // first CHANGE of the prop looks like its first appearance, which only
    // fills an empty field — vant's stepper kept showing 1 after `+`, and
    // only caught up (jumping to 3) on the second press.
    _lastPropValue = props['value']?.toString();
    if (props['focus'] != null) _lastPropFocus = fjsBool(props['focus']);
    if (_lastPropFocus == true || fjsBool(props['autoFocus'])) {
      // After the first frame: a FocusNode cannot take focus before it is
      // attached, and the JS side sets auto-focus on the same frame the node
      // is created.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _focusNode.requestFocus();
      });
    }
  }

  /// Width the field last laid out at, from the LayoutBuilder in [build].
  /// Line count depends on it, so a resize re-measures.
  double _measuredWidth = 0;

  /// Last count reported over the bridge. The JS side gates again — it drops
  /// this first, priming report — so both platforms agree that opening a
  /// three-line field is not "the line count changed"
  /// (fjs-runtime/src/textarea/lines.ts).
  int? _reportedLines;

  void _scheduleMeasure() {
    if (!_multiline) return;
    WidgetsBinding.instance.addPostFrameCallback((_) => _measureLines());
  }

  void _measureLines() {
    if (!mounted || _measuredWidth <= 0) return;
    final painter = TextPainter(
      text: TextSpan(text: _controller.text, style: _textStyle()),
      textDirection: Directionality.of(context),
      maxLines: null,
    )..layout(maxWidth: _measuredWidth);
    final metrics = painter.computeLineMetrics();
    // An empty field is one line, not zero — that is what the page sees.
    final count = metrics.isEmpty ? 1 : metrics.length;
    final height = painter.height > 0
        ? painter.height
        : painter.preferredLineHeight;
    painter.dispose();
    if (count == _reportedLines) return;
    _reportedLines = count;
    widget.dispatch(
      widget.node.id,
      FjsEvent.lineChange,
      text: fjsLineChangePayload(height: height, lineCount: count),
    );
  }

  @override
  void didUpdateWidget(covariant FjsInput oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncFocus();
    _scheduleMeasure();
    final hasValue = widget.node.props['value'] != null;
    if (!hasValue) return; // unmanaged input — keep local text
    final value = widget.node.props['value'].toString();
    // A prop that appears (or changes) is a write from JS — vant's Field
    // never binds `:value`, it sets `el.value` (clear, formatter), and its
    // first write is the clear button's '' over what the user typed. The
    // old "first appearance only fills an empty field" dropped exactly
    // that (specs/122).
    if (value == _lastPropValue) return;
    _lastPropValue = value;
    if (value != _controller.text) _controller.text = value;
  }

  /// Typing makes the typed text the node's `value`, as it is the DOM
  /// input's. JS does not echo keystrokes back (renderer.ts keeps `el.value`
  /// in step on its side), so without this the prop kept the last JS write:
  /// clearing twice wrote '' over '' — no change as far as
  /// [didUpdateWidget] could tell, and the typed text stayed (specs/122).
  /// Only a controlled node: an input that never got a `value` keeps none.
  void _recordTypedValue(String text) {
    final props = widget.node.props;
    if (props['value'] == null) return;
    widget.node.props = {...props, 'value': text};
    _lastPropValue = text;
  }

  /// The field's own text style — also what [_measureLines] measures with,
  /// so the line count matches what is on screen.
  TextStyle _textStyle() {
    final style = widget.style;
    // Sizing follows the web adapter's `.fjs-input`, not Material's: the
    // field inherits the 14px body font, and its box (border, radius,
    // padding, background) is whatever the page's own style says — which
    // decorateNode has already drawn around this widget.
    return TextStyle(
      color: style.color ?? const Color(0xFF333333),
      fontSize: style.fontSize ?? 14,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontFamily: style.fontFamily,
      fontFamilyFallback: style.fontFamilyFallback,
      letterSpacing: style.letterSpacing,
      height: _lineHeight(style),
      leadingDistribution: TextLeadingDistribution.even,
    );
  }

  /// The field's line height as a multiplier. `24px` is divided by the font
  /// size, as text.dart does for text nodes: vant's control inherits the
  /// cell's `line-height: 24px`, and reading only unitless values dropped it
  /// to 1.4 — a 19.6px line box in a 24px row, sitting ~2px above the
  /// label's text (specs/126).
  double _lineHeight(FjsStyle style) {
    final multiplier = style.lineHeightMultiplier;
    if (multiplier != null) return multiplier;
    final abs = style.lineHeightAbsolute;
    final fontSize = style.fontSize ?? 14;
    if (abs != null && abs > 0 && fontSize > 0) return abs / fontSize;
    return 1.4;
  }

  @override
  Widget build(BuildContext context) {
    final style = widget.style;
    final maxLength = _maxLength;
    final expands = _expands;
    final textField = TextField(
      controller: _controller,
      focusNode: _focusNode,
      obscureText: _obscure,
      // a masked field must not learn or suggest what is typed into it
      enableSuggestions: !_obscure,
      autocorrect: !_obscure,
      // null + expands fills the box the page sized and scrolls inside it;
      // 3 stops at three lines and scrolls; 1 is the single-line field.
      maxLines: expands ? null : _maxLines,
      minLines: null,
      expands: expands,
      keyboardType: _keyboardType,
      textInputAction: _textInputAction,
      // Truncate silently — Material's own counter/limit UI has no web
      // counterpart, and `maxlength` on an <input> just stops the typing.
      inputFormatters: maxLength == null
          ? null
          : [LengthLimitingTextInputFormatter(maxLength)],
      textAlign: style.textAlign ?? TextAlign.start,
      // expands makes the field fill its box; without this the text would
      // sit vertically centred in a tall textarea instead of at the top.
      textAlignVertical: expands ? TextAlignVertical.top : null,
      style: _textStyle(),
      // `readonly` / `disabled` are DOM attributes vant's Field binds on the
      // input (specs/077: both used to be ignored and stayed editable).
      // A readonly field stays focusable — vant's onFocus deliberately
      // blurs it right away, the same rejection a browser does.
      readOnly: fjsBool(widget.node.props['readonly']),
      enabled: !fjsBool(widget.node.props['disabled']),
      decoration: InputDecoration(
        hintText: widget.node.props['placeholder']?.toString(),
        hintStyle: _hintStyle(style),
        isDense: true,
        // The field's box is the page's CSS, drawn by decorateNode around
        // this widget — never the host app's InputDecorationTheme. Without
        // `filled: false` a host theme with `filled: true` (fjs go's) drew
        // a gray pill over every vant field on white cards.
        filled: false,
        // decorateNode applied the page's padding to the box already; only
        // an unstyled input keeps the stylesheet's own `8px 0`.
        contentPadding: style.padding != null
            ? EdgeInsets.zero
            : const EdgeInsets.symmetric(vertical: 8),
        border: InputBorder.none,
      ),
      onChanged: (text) {
        _recordTypedValue(text);
        widget.dispatch(widget.node.id, FjsEvent.textChanged, text: text);
        _scheduleMeasure();
      },
      onSubmitted: (text) {
        // A newline key is not a confirm (specs/012 §3.5). Flutter already
        // withholds onSubmitted for TextInputAction.newline on most
        // platforms; the guard makes that part of the contract rather than
        // a platform detail.
        if (!_confirmReports) return;
        widget.dispatch(widget.node.id, FjsEvent.textSubmitted, text: text);
      },
    );
    // A single-line <input> in a box taller than its line (vant's stepper:
    // `height: 28px; line-height: normal`) shows the line centred; the
    // decorator itself is only as tall as the line and would sit at the top
    // of the forced height. heightFactor 1 keeps an unforced box at the
    // line's own height, so only a min/fixed height adds the centring room.
    final field = _multiline
        ? textField
        : Align(
            alignment: AlignmentDirectional.centerStart,
            heightFactor: 1,
            child: textField,
          );
    // One LayoutBuilder for both shapes. The line count depends on the width
    // the text lays out at, and only the parent knows it. And a browser
    // <input> is never laid out at an unbounded width: a percentage with no
    // definite containing block (vant's `width: 100%` inside a
    // shrink-to-fit flex item, say) falls back to the field's intrinsic
    // size — `size=20` characters — not to infinity. Material's
    // InputDecorator asserts on infinite width instead, so substitute the
    // intrinsic size the CSS resolver fell through on.
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        if (width.isFinite) {
          if (_multiline && width > 0 && width != _measuredWidth) {
            _measuredWidth = width;
            _scheduleMeasure();
          }
          return field;
        }
        return ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 178),
          child: field,
        );
      },
    );
  }

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChange);
    _focusNode.dispose();
    _controller.dispose();
    super.dispose();
  }
}
