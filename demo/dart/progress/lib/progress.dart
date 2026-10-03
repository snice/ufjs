// A context-free facade over sn_progress_dialog (specs/202).
//
// sn_progress_dialog is a WIDGET package: `ProgressDialog` needs a
// BuildContext and `show()` takes Widget-typed options (Color, TextStyle,
// Cancel/Completed…) — none of which can cross the object ABI, so autoimport
// would skip the whole constructor. This facade is the usual answer for a UI
// package: a plain Dart class whose public signature uses only
// String/int/bool/Future/functions, which `fjs autoimport` then binds like any
// other local package. It exposes the part JS needs (show / update / close /
// status) and deliberately not the styling options.
//
// The BuildContext is the HOST's to supply: the host wires [progressContext]
// in fjsAttachHost (demo/src/main.dart) — `() => FjsApp.currentContext`.
// Keeping that a provider means this package stays a plain Flutter package
// with no dependency on flutter_fjs. Needs a Material ancestor (the host's
// MaterialApp) for the dialog's Theme/localizations.
import 'package:flutter/widgets.dart' show BuildContext;
import 'package:sn_progress_dialog/sn_progress_dialog.dart';

/// Host wiring: where the dialog finds a BuildContext. Not bound by
/// autoimport (only classes and functions are).
BuildContext? Function()? progressContext;

class Progress {
  Progress([String msg = 'Loading', int max = 100])
      : _msg = msg,
        _max = max {
    final provide = progressContext;
    final context = provide?.call();
    if (context == null) {
      // loud, not a silent no-op: a dialog that never appears is the
      // hardest failure to trace from the JS side
      throw StateError(
          'Progress: no BuildContext — the host must set progressContext '
          '(demo/src/main.dart) and a FjsApp must be mounted');
    }
    _dialog = ProgressDialog(context: context);
  }

  final String _msg;
  final int _max;
  late final ProgressDialog _dialog;
  void Function(String)? _onStatus;

  /// Shows the dialog. The Future completes when the dialog is closed (it
  /// closes itself at [max] unless [close] came first), so JS can `await` it.
  Future<void> show([bool determinate = false]) {
    return _dialog.show(
      max: _max,
      msg: _msg,
      progressType:
          determinate ? ProgressType.determinate : ProgressType.indeterminate,
      onStatusChanged: (status) => _onStatus?.call(status.name),
    );
  }

  void update(int value, [String? msg]) => _dialog.update(value: value, msg: msg);

  void close() => _dialog.close();

  bool get isOpen => _dialog.isOpen();

  /// 'opened' | 'closed' | 'completed'. Register BEFORE [show]: `opened`
  /// fires synchronously inside it.
  void onStatus(void Function(String) fn) => _onStatus = fn;
}
