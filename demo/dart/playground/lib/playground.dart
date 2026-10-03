// The demo's `playground` object module as PLAIN Dart (specs/201): no
// FjsObjectModule, no FjsCallback — `fjs autoimport` (package.json
// fjs.autoimport: { name: "playground", path: "dart/playground" })
// analyzes this library and generates the adapter and the TS types. The web
// twin is src/playground-stub.ts, typed against the generated
// PlaygroundModule, so a signature change here breaks its typecheck.
//
// Integers only and deterministic errors on purpose: the page's "run all"
// text is diffed between the Flutter and web builds (specs/159 §11).
//
// `release` is this class's OWN method — the framework's dispose op fires
// only from the GC finalizer and has no JS-facing API (the generated
// adapters do not forward it to user classes).
import 'dart:async';

int _live = 0;

class Counter {
  Counter([int initial = 0]) : _value = initial {
    _live++;
  }

  int _value;
  bool _released = false;
  void Function(int)? _listener;
  Timer? _timer;

  /// Plain public field: the generator makes it writable from JS.
  int step = 1;

  int get value {
    _check();
    return _value;
  }

  void _check() {
    if (_released) throw StateError('Counter is released');
  }

  int add(int n) {
    _check();
    return _value += n * step;
  }

  void onTick(void Function(int) fn) {
    _check();
    _listener = fn;
  }

  int fire() {
    _check();
    _listener?.call(_value);
    return _value;
  }

  /// Timer-driven ticks: kept out of the page's "run all" because their
  /// interleaving with the event loop is not promised to match the web.
  void startTimer(int times) {
    _check();
    var left = times;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(milliseconds: 40), (t) {
      if (--left <= 0 || _released) t.cancel();
      _value += step;
      _listener?.call(_value);
    });
  }

  Counter clone() {
    _check();
    return Counter(_value)..step = step;
  }

  int merge(Counter other) {
    _check();
    return _value += other.value;
  }

  void release() {
    _check();
    _released = true;
    _timer?.cancel();
    _live--;
  }
}

Future<int> waitFor(int ms) =>
    Future<int>.delayed(Duration(milliseconds: ms), () => ms);

Future<int> failAfter(int ms) => Future<int>.delayed(
    Duration(milliseconds: ms), () => throw StateError('boom'));

int Function(int) makeAdder(int n) => (x) => n + x;

int liveCount() => _live;
