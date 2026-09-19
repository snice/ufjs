// A keyframe run's first and last frame land exactly on a keyframe, and the
// sampler used to hand those back raw: a JSON `opacity: 0` is an int (the
// node only read doubles, so it fell back to 1.0) and a transform a string
// (read as identity). vant's overlay fade flashed the full mask for a frame
// at both ends of every open and close.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/render/animation.dart';

void main() {
  Map<String, Object?> style(String name, List<Map<String, Object?>> frames) => {
    'animationName': name,
    'animationDuration': '.3s',
    'animationFillMode': 'both',
    'animationKeyframes': {name: frames},
  };

  test('opacity endpoints sample as doubles', () {
    final fadeOut = FjsAnimations.of(style('van-fade-out', [
      {'offset': 0, 'style': {'opacity': 1}},
      {'offset': 1, 'style': {'opacity': 0}},
    ]))!;
    expect(fadeOut.sample(Duration.zero, (_) => null)['opacity'], 1.0);
    // held by the forwards fill after the end
    expect(
      fadeOut.sample(const Duration(milliseconds: 400), (_) => null)['opacity'],
      0.0,
    );
  });

  test('transform endpoints sample as FjsAnimatedTransform', () {
    final slideIn = FjsAnimations.of(style('van-slide-up-enter', [
      {'offset': 0, 'style': {'transform': 'translate3d(0,100%,0)'}},
    ]))!;
    final t = slideIn.sample(Duration.zero, (_) => null)['transform'];
    expect(t, isA<FjsAnimatedTransform>());
    expect((t as FjsAnimatedTransform).fraction, const Offset(0, 1));
  });
}
