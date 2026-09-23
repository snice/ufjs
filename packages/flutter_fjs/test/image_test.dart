import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_fjs/src/render/renderer.dart';
import 'package:flutter_fjs/src/ui_ops.dart';
import 'dart:async';
import 'dart:ui' as ui;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/ffi.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/render/image_mode.dart';
import 'package:flutter_fjs/src/render/style.dart';
import 'package:flutter_fjs/src/widgets/image.dart';

class _CompletingImageProvider extends ImageProvider<Object> {
  final Completer<ImageInfo> result = Completer<ImageInfo>();
  int loadCount = 0;

  @override
  Future<Object> obtainKey(ImageConfiguration configuration) async => this;

  @override
  ImageStreamCompleter loadImage(Object key, ImageDecoderCallback decode) {
    loadCount++;
    return OneFrameImageStreamCompleter(result.future);
  }

  void complete(ui.Image image) => result.complete(ImageInfo(image: image));

  void fail() => result.completeError(StateError('test image failure'));
}

Future<ui.Image> _testImage(int width, int height) {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawColor(Colors.blue, BlendMode.src);
  return recorder.endRecording().toImage(width, height);
}

MirrorNode _node({
  String src = 'asset://photo.png',
  String? mode,
  String? fit,
  bool lazyLoad = false,
  Map<String, Object?> style = const {},
}) {
  final node = MirrorNode(7, 'image');
  node.props = <String, Object?>{
    'src': src,
    if (mode != null) 'mode': mode,
    if (fit != null) 'fit': fit,
    if (lazyLoad) 'lazyLoad': true,
    if (style.isNotEmpty) 'style': style,
  };
  return node;
}

void main() {
  test('chooses the cached provider for HTTP sources', () {
    expect(
      fjsResolveImageSource('https://example.com/photo.png'),
      isA<CachedNetworkImageProvider>(),
    );
    expect(
      fjsResolveImageSource('http://example.com/photo.png'),
      isA<CachedNetworkImageProvider>(),
    );
  });

  test('reads a local src from the dev server while one is connected', () {
    // The whole reason this fork lives in Dart: only this process knows
    // whether it is attached to `fjs dev` (specs/017-local-image-assets).
    final dev = Uri.parse('http://127.0.0.1:38900');
    for (final src in ['/images/photo.png', 'asset://images/photo.png']) {
      final provider = fjsResolveImageSource(src, devUri: dev);
      expect(provider, isA<CachedNetworkImageProvider>(), reason: src);
      expect(
        (provider! as CachedNetworkImageProvider).url,
        'http://127.0.0.1:38900/images/photo.png',
        reason: src,
      );
    }
    // A file in public/ keeps its path when its content changes, and the
    // image cache is keyed by URL — found on the simulator: editing a PNG
    // during `fjs dev` kept showing the first copy (specs/017 §4).
    expect(
      (fjsResolveImageSource(
                '/images/photo.png',
                devUri: dev,
                devGeneration: 3,
              )!
              as CachedNetworkImageProvider)
          .url,
      'http://127.0.0.1:38900/images/photo.png?fjs=3',
    );
    // release keys stay clean — nothing is editable there
    expect(
      (fjsResolveImageSource('/images/photo.png', devGeneration: 3)!
              as AssetImage)
          .assetName,
      '$fjsPublicAssetRoot/images/photo.png',
    );
    // a trailing slash on the dev origin must not double up
    expect(
      (fjsResolveImageSource('/x.png', devUri: Uri.parse('http://h:1/'))!
              as CachedNetworkImageProvider)
          .url,
      'http://h:1/x.png',
    );
  });

  test('reads a local src from the bundled assets without a dev server', () {
    // Both spellings land on the one directory the CLI syncs.
    for (final src in ['/images/photo.png', 'asset://images/photo.png']) {
      final provider = fjsResolveImageSource(src);
      expect(provider, isA<AssetImage>(), reason: src);
      expect(
        (provider! as AssetImage).assetName,
        '$fjsPublicAssetRoot/images/photo.png',
        reason: src,
      );
    }
    expect(
      (fjsResolveImageSource('/assets/photo-ABC123.png')! as AssetImage)
          .assetName,
      '$fjsPublicAssetRoot/assets/photo-ABC123.png',
    );
  });

  test('never fails a local src silently', () {
    // constitution V: every src this cannot honour says why, and still
    // returns something the widget can turn into one @error.
    final warnings = <String, List<String>>{};
    ImageProvider<Object>? resolve(String src) {
      final logs = <String>[];
      final provider = fjsResolveImageSource(src, warn: logs.add);
      warnings[src] = logs;
      return provider;
    }

    // a relative src has no anchor in the mirror tree — resolved as a root
    // path, but never quietly
    expect(resolve('images/photo.png'), isA<AssetImage>());
    expect(warnings['images/photo.png']!.single, contains('relative'));

    // Flutter has no SVG decoder; the web side does show it
    expect(resolve('/logo.svg'), isNotNull);
    expect(warnings['/logo.svg']!.single, contains('SVG'));

    // nothing usable: null, so the widget reports @error instead of waiting
    expect(resolve('/../secret.png'), isNull);
    expect(warnings['/../secret.png']!.last, contains('not a usable'));
    expect(fjsResolveImageSource(''), isNull);
  });

  test('encodes fixed image event payloads', () {
    expect(fjsImageLoadPayload(600, 400), '{"width":600,"height":400}');
    expect(fjsImageErrorPayload(), '{"errMsg":"image load failed"}');
  });

  test('maps all 14 modes and gives mode precedence over fit', () {
    const modes = <String>[
      'scaleToFill',
      'aspectFit',
      'aspectFill',
      'widthFix',
      'heightFix',
      'top',
      'bottom',
      'center',
      'left',
      'right',
      'top left',
      'top right',
      'bottom left',
      'bottom right',
    ];
    for (final mode in modes) {
      final node = _node(mode: mode);
      expect(resolveFjsImageMode(node, FjsStyle(node.props)).name, mode);
    }
    final resolved = resolveFjsImageMode(
      _node(mode: 'aspectFit', fit: 'cover'),
      FjsStyle(_node(mode: 'aspectFit', fit: 'cover').props),
    );
    expect(resolved.fit, BoxFit.contain);
    expect(resolved.alignment, Alignment.center);
  });

  test('positional modes are 1:1 crop windows, not cover crops', () {
    // WeChat never scales them: it opens a natural-size window at the named
    // position ("不缩放，仅显示顶部区域"). Cover + alignment was the old
    // mapping and left this end MAD 47-71 away from dist/mp (specs/102).
    const positional = <String>[
      'top',
      'bottom',
      'center',
      'left',
      'right',
      'top left',
      'top right',
      'bottom left',
      'bottom right',
    ];
    for (final mode in positional) {
      final node = _node(mode: mode);
      expect(
        resolveFjsImageMode(node, FjsStyle(node.props)).fit,
        BoxFit.none,
        reason: mode,
      );
    }
    final fill = _node(mode: 'aspectFill');
    expect(resolveFjsImageMode(fill, FjsStyle(fill.props)).fit, BoxFit.cover);
  });

  testWidgets('heightFix yields to a declared width', (tester) async {
    // `.mode-image { width: 280px; height: 170px }` with heightFix renders
    // 280 x 186.67 on WeChat — widthFix semantics — not 257 x 170
    // (specs/102).
    final provider = _CompletingImageProvider();
    final node = _node(
      mode: 'heightFix',
      style: const {'width': 280, 'height': 170},
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Center(
          child: FjsImage(
            node: node,
            style: FjsStyle(node.props),
            providerOverride: provider,
            dispatch: (id, type, {String? text}) {},
          ),
        ),
      ),
    );
    provider.complete(await _testImage(600, 400));
    await tester.pump();
    await tester.pump();
    final size = tester.getSize(find.byType(Image));
    expect(size.width, 280);
    expect(size.height, closeTo(280 * 400 / 600, 0.01));
  });

  testWidgets('heightFix keeps a height-only declaration', (tester) async {
    // `height: 64px` alone on a 120x240 image is 32x64 on both ends
    // (specs/102) — the width rule above must not swallow it.
    final provider = _CompletingImageProvider();
    final node = _node(mode: 'heightFix', style: const {'height': 64});
    await tester.pumpWidget(
      MaterialApp(
        home: Center(
          child: FjsImage(
            node: node,
            style: FjsStyle(node.props),
            providerOverride: provider,
            dispatch: (id, type, {String? text}) {},
          ),
        ),
      ),
    );
    provider.complete(await _testImage(120, 240));
    await tester.pump();
    await tester.pump();
    final size = tester.getSize(find.byType(Image));
    expect(size.width, closeTo(32, 0.01));
    expect(size.height, 64);
  });

  testWidgets('dispatches one load event with intrinsic dimensions', (
    tester,
  ) async {
    final provider = _CompletingImageProvider();
    final events = <(int, int, String?)>[];
    final node = _node(style: const {'borderRadius': '8px'});
    await tester.pumpWidget(
      MaterialApp(
        home: FjsImage(
          node: node,
          style: FjsStyle(node.props),
          providerOverride: provider,
          dispatch: (id, type, {String? text}) => events.add((id, type, text)),
        ),
      ),
    );

    provider.complete(await _testImage(6, 4));
    await tester.pump();
    await tester.pump();

    expect(provider.loadCount, 1);
    expect(events, [(7, FjsEvent.load, '{"width":6,"height":4}')]);
    expect(find.byType(ClipRRect), findsOneWidget);
  });

  testWidgets('dispatches one error event and no load event', (tester) async {
    final provider = _CompletingImageProvider();
    final events = <(int, int, String?)>[];
    final node = _node();
    await tester.pumpWidget(
      MaterialApp(
        home: FjsImage(
          node: node,
          style: FjsStyle(node.props),
          providerOverride: provider,
          dispatch: (id, type, {String? text}) => events.add((id, type, text)),
        ),
      ),
    );

    provider.fail();
    await tester.pump();
    await tester.pump();

    expect(events, [(7, FjsEvent.error, '{"errMsg":"image load failed"}')]);
  });

  testWidgets('empty source does not create a provider or dispatch', (
    tester,
  ) async {
    final events = <(int, int, String?)>[];
    final node = _node(src: '');
    await tester.pumpWidget(
      MaterialApp(
        home: FjsImage(
          node: node,
          style: FjsStyle(node.props),
          dispatch: (id, type, {String? text}) => events.add((id, type, text)),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(Image), findsNothing);
    expect(events, isEmpty);
  });

  testWidgets('drops the old provider result after a source change', (
    tester,
  ) async {
    final first = _CompletingImageProvider();
    final second = _CompletingImageProvider();
    final events = <(int, int, String?)>[];
    var node = _node(src: 'asset://first.png');

    await tester.pumpWidget(
      MaterialApp(
        home: FjsImage(
          key: const ValueKey('image'),
          node: node,
          style: FjsStyle(node.props),
          providerOverride: first,
          dispatch: (id, type, {String? text}) => events.add((id, type, text)),
        ),
      ),
    );
    node = _node(src: 'asset://second.png');
    await tester.pumpWidget(
      MaterialApp(
        home: FjsImage(
          key: const ValueKey('image'),
          node: node,
          style: FjsStyle(node.props),
          providerOverride: second,
          dispatch: (id, type, {String? text}) => events.add((id, type, text)),
        ),
      ),
    );

    first.complete(await _testImage(1, 1));
    await tester.pump();
    expect(events, isEmpty);

    second.complete(await _testImage(2, 3));
    await tester.pump();
    await tester.pump();
    expect(events, [(7, FjsEvent.load, '{"width":2,"height":3}')]);
  });

  _lazyTests();
}

/// Builds `<scroll-view scroll-y>` with [rows] tall rows and then one
/// `<image lazy-load>` at the very bottom — the shape the demo page uses,
/// and the only way to exercise the scroll notification -> visibility
/// refresh -> provider request path end to end.
MirrorTree _lazyInScrollView({required int rows, required double rowHeight}) {
  final bytes = <int>[];
  void u8(int v) => bytes.add(v & 0xff);
  void u16(int v) => bytes
    ..add(v & 0xff)
    ..add((v >> 8) & 0xff);
  void u32(int v) => bytes.addAll(
    (ByteData(4)..setUint32(0, v, Endian.little)).buffer.asUint8List(),
  );
  void raw(List<int> l) => bytes.addAll(l);
  void create(int id, String tag, Map<String, Object?> props) {
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    u16(t.length);
    raw(t);
    final j = utf8.encode(jsonEncode(props));
    u8(UiOpCode.setProps);
    u32(id);
    u32(j.length);
    raw(j);
  }

  void insert(int parent, int id) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(id);
    u32(0x7fffffff);
  }

  create(1, 'scroll-view', {'scrollY': true});
  insert(0, 1);
  var next = 2;
  for (var i = 0; i < rows; i++) {
    create(next, 'view', {
      'style': {'height': rowHeight},
    });
    insert(1, next);
    next++;
  }
  create(next, 'image', {
    'src': 'asset://lazy.png',
    'lazyLoad': true,
    'style': {'width': 100, 'height': 100},
  });
  insert(1, next);
  return MirrorTree()..applyFrame(Uint8List.fromList(bytes));
}

void _lazyTests() {
  testWidgets('lazy-load waits until the scroll view reaches it', (
    tester,
  ) async {
    // 20 x 200px of rows above the image, in a 400px viewport: the image
    // starts far outside the 240px preload margin.
    final tree = _lazyInScrollView(rows: 20, rowHeight: 200);
    final events = <(int, int, String?)>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            height: 400,
            child: FjsNodeRenderer(
              tree: tree,
              ids: tree.rootChildren,
              dispatch: (id, type, {String? text}) =>
                  events.add((id, type, text)),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(events, isEmpty, reason: 'nothing requested before it is near');

    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -4000),
    );
    await tester.pumpAndSettle();
    // the asset does not exist in this package, so the terminal event is the
    // error one; what is under test is that there is now EXACTLY one, and
    // that it took a scroll to get it
    tester.takeException();
    expect(events, [(22, FjsEvent.error, '{"errMsg":"image load failed"}')]);
  });

  testWidgets('lazy-load outside any viewport warns and loads anyway', (
    tester,
  ) async {
    // Constitution V: a host that cannot answer "is this near the screen?"
    // must say so, not pretend to be lazy and then load immediately.
    final provider = _CompletingImageProvider();
    final node = _node(lazyLoad: true);
    final logs = <String>[];
    final original = debugPrint;
    debugPrint = (message, {wrapWidth}) => logs.add(message ?? '');
    try {
      await tester.pumpWidget(
        MaterialApp(
          home: FjsImage(
            node: node,
            style: FjsStyle(node.props),
            providerOverride: provider,
            dispatch: (id, type, {String? text}) {},
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
    } finally {
      debugPrint = original;
    }
    expect(provider.loadCount, 1);
    expect(logs.where((l) => l.contains('lazy-load')), isNotEmpty);
  });
}
