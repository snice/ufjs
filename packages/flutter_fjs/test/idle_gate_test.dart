// specs/143 — when an idle-time chunk preload may run. Pure Dart: the gate
// takes "is a frame pending" as a function, so no engine or VM is needed.
import 'package:flutter/gestures.dart';
import 'package:flutter_fjs/src/idle_gate.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const poll = Duration(milliseconds: 2);

  Future<bool> opensWithin(FjsIdleGate gate, Duration d) async {
    var open = false;
    gate.whenIdle().then((_) => open = true);
    await Future<void>.delayed(d);
    return open;
  }

  test('opens at once when nothing is going on', () async {
    final gate = FjsIdleGate(framePending: () => false, poll: poll);
    expect(await opensWithin(gate, const Duration(milliseconds: 10)), isTrue);
  });

  test('stays shut while a finger is down, opens after it lifts', () async {
    final gate = FjsIdleGate(framePending: () => false, poll: poll);
    gate.handlePointer(const PointerDownEvent(pointer: 7));
    var open = false;
    gate.whenIdle().then((_) => open = true);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(open, isFalse);
    gate.handlePointer(const PointerUpEvent(pointer: 7));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(open, isTrue);
  });

  test('a cancelled pointer counts as lifted', () async {
    final gate = FjsIdleGate(framePending: () => false, poll: poll);
    gate.handlePointer(const PointerDownEvent(pointer: 1));
    gate.handlePointer(const PointerCancelEvent(pointer: 1));
    expect(await opensWithin(gate, const Duration(milliseconds: 10)), isTrue);
  });

  test('stays shut during a route transition, opens when it ends', () async {
    final gate = FjsIdleGate(framePending: () => false, poll: poll);
    gate.routeAnimating(3, true);
    var open = false;
    gate.whenIdle().then((_) => open = true);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(open, isFalse);
    gate.routeAnimating(3, false);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(open, isTrue);
  });

  test('a transition whose end is never reported stops blocking', () async {
    final gate = FjsIdleGate(
      framePending: () => false,
      poll: poll,
      transitionTimeout: const Duration(milliseconds: 30),
    );
    gate.routeAnimating(4, true);
    expect(await opensWithin(gate, const Duration(milliseconds: 10)), isFalse);
    await Future<void>.delayed(const Duration(milliseconds: 40));
    expect(await opensWithin(gate, const Duration(milliseconds: 10)), isTrue);
  });

  test('frames still pending (a fling) hold it shut until the fallback', () async {
    final gate = FjsIdleGate(
      framePending: () => true,
      poll: poll,
      busyFallback: const Duration(milliseconds: 60),
    );
    var open = false;
    gate.whenIdle().then((_) => open = true);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(open, isFalse);
    await Future<void>.delayed(const Duration(milliseconds: 80));
    expect(open, isTrue);
  });

  test('the fallback never overrides a finger on the glass', () async {
    final gate = FjsIdleGate(
      framePending: () => true,
      poll: poll,
      busyFallback: const Duration(milliseconds: 10),
    );
    gate.handlePointer(const PointerDownEvent(pointer: 2));
    expect(await opensWithin(gate, const Duration(milliseconds: 50)), isFalse);
    gate.dispose();
  });

  test('dispose releases a waiter', () async {
    final gate = FjsIdleGate(framePending: () => true, poll: poll);
    gate.handlePointer(const PointerDownEvent(pointer: 5));
    var open = false;
    gate.whenIdle().then((_) => open = true);
    gate.dispose();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(open, isTrue);
  });
}
