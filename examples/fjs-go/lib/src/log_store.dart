// Rolling buffer of JS console output + client-side status lines, shown in
// the dev menu's log sheet. On a phone there is no terminal to tail, so
// everything the engine reports has to land somewhere visible.
import 'package:flutter/foundation.dart';

enum LogLevel { status, log, warn, error }

@immutable
class LogEntry {
  const LogEntry(this.level, this.message, this.at);

  final LogLevel level;
  final String message;
  final DateTime at;
}

class LogStore extends ChangeNotifier {
  LogStore({this.limit = 500});

  final int limit;
  final List<LogEntry> _entries = [];

  List<LogEntry> get entries => List.unmodifiable(_entries);
  /// Errors of the current session only: a failed connect before this one
  /// is history, and must not put a red badge on a project that runs fine.
  bool get hasErrors => _entries.any(
        (e) => e.level == LogLevel.error && !e.at.isBefore(_sessionStart),
      );

  DateTime _sessionStart = DateTime.fromMillisecondsSinceEpoch(0);

  /// Starts counting errors afresh; earlier lines stay in the log.
  void startSession() {
    _sessionStart = DateTime.now();
    notifyListeners();
  }

  void add(LogLevel level, String message) {
    _entries.add(LogEntry(level, message, DateTime.now()));
    if (_entries.length > limit) _entries.removeRange(0, _entries.length - limit);
    notifyListeners();
  }

  /// Engine log levels: 1 log/info, 2 warn, 3 error.
  void addEngineLog(int level, String message) {
    add(
      switch (level) {
        3 => LogLevel.error,
        2 => LogLevel.warn,
        _ => LogLevel.log,
      },
      message,
    );
  }

  void clear() {
    _entries.clear();
    notifyListeners();
  }
}
