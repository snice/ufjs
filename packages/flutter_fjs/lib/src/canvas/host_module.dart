// The canvas subsystem's host modules: the three things the JS context
// cannot answer on its own.
//
//   fjs.canvas.measureText(fontJson, text) -> metrics JSON   SYNCHRONOUS
//   fjs.canvas.loadImage(handle, src)                        async, event 30
//   fjs.canvas.toDataURL(reqId, nodeId, type, quality)       async, event 30
//
// measureText is synchronous because a page's layout pass cannot await: it
// measures a label and immediately places it. That is exactly what the JSI
// boundary is for (constitution III) — the Dart handler runs to completion
// inside the JS call. The other two produce bitmaps, which take a frame and
// a decoder, so they follow the fetch pattern instead: JS allocates the id,
// this returns immediately, and the result arrives as FjsEvent.canvas.
import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';
import 'package:flutter/services.dart' show AssetBundle;

import 'canvas_module.dart';
import '../mirror_tree.dart';
import '../registry/host.dart';
import '../widgets/image.dart' show fjsResolveImageSource;
import 'images.dart';
import 'replay.dart';

/// Wires the modules into [host]. The callbacks are the engine's own; this
/// file is deliberately free of engine state so it can be exercised on its
/// own in a test.
void registerCanvasHostModules({
  required HostRegistry host,
  required MirrorTree tree,
  required void Function(int id, int type, {String? text}) dispatch,
  required Uri? Function() devUri,
  required int Function() devGeneration,
  AssetBundle Function()? assetBundle,
}) {
  host
    ..register('fjs.canvas.measureText', (args) {
      final font = _decodeFont(args.isNotEmpty ? args.first?.toString() : null);
      final text = args.length > 1 ? args[1]?.toString() ?? '' : '';
      return _measure(font, text);
    })
    ..register('fjs.canvas.loadImage', (args) {
      final handle = _int(args, 0);
      final src = args.length > 1 ? args[1]?.toString() ?? '' : '';
      unawaited(
        _loadImage(
          handle: handle,
          src: src,
          dispatch: dispatch,
          devUri: devUri(),
          devGeneration: devGeneration(),
          assetBundle: assetBundle?.call(),
        ),
      );
      return null;
    })
    ..register('fjs.canvas.toDataURL', (args) {
      final requestId = _int(args, 0);
      final nodeId = _int(args, 1);
      unawaited(
        _toDataUrl(
          requestId: requestId,
          node: tree.node(nodeId),
          dispatch: dispatch,
        ),
      );
      return null;
    });
}

// ---- measureText ----------------------------------------------------------

class _Font {
  const _Font(this.size, this.weight, this.italic, this.family);
  final double size;
  final int weight;
  final bool italic;
  final String family;
}

_Font _decodeFont(String? json) {
  if (json == null || json.isEmpty)
    return const _Font(10, 400, false, 'sans-serif');
  try {
    final map = jsonDecode(json) as Map<String, Object?>;
    return _Font(
      (map['size'] as num?)?.toDouble() ?? 10,
      (map['weight'] as num?)?.toInt() ?? 400,
      map['italic'] == true,
      map['family']?.toString() ?? 'sans-serif',
    );
  } catch (_) {
    return const _Font(10, 400, false, 'sans-serif');
  }
}

/// The metrics a page gets back. Measured with the same TextPainter the
/// replay draws with, so a label's width matches what will be painted; a
/// second implementation here would drift from the drawing one silently.
String _measure(_Font font, String text) {
  final painter = textPainterFor(
    text: text,
    family: font.family,
    size: font.size,
    weight: font.weight,
    italic: font.italic,
    color: const Color(0xFF000000),
  );
  final ascent = painter.computeDistanceToActualBaseline(
    TextBaseline.alphabetic,
  );
  return jsonEncode({
    'width': _round(painter.width),
    'actualBoundingBoxAscent': _round(ascent),
    'actualBoundingBoxDescent': _round(painter.height - ascent),
    'actualBoundingBoxLeft': 0,
    'actualBoundingBoxRight': _round(painter.width),
    'fontBoundingBoxAscent': _round(ascent),
    'fontBoundingBoxDescent': _round(painter.height - ascent),
  });
}

num _round(double v) => (v * 100).round() / 100;

// ---- loadImage ------------------------------------------------------------

Future<void> _loadImage({
  required int handle,
  required String src,
  required void Function(int id, int type, {String? text}) dispatch,
  required Uri? devUri,
  required int devGeneration,
  AssetBundle? assetBundle,
}) async {
  void report(Map<String, Object?> payload) {
    dispatch(handle, 30, text: jsonEncode({'t': 'image', ...payload}));
  }

  // the same three src forms `<image>` takes, resolved by the same function:
  // one canvas src should not mean something different from one image src
  final provider = fjsResolveImageSource(
    src,
    devUri: devUri,
    devGeneration: devGeneration,
    assetBundle: assetBundle,
  );
  if (provider == null) {
    report({'err': 'canvas image load failed'});
    return;
  }
  final completer = Completer<ui.Image>();
  final stream = provider.resolve(ImageConfiguration.empty);
  late ImageStreamListener listener;
  listener = ImageStreamListener(
    (info, _) {
      if (!completer.isCompleted) completer.complete(info.image);
      stream.removeListener(listener);
    },
    onError: (error, _) {
      if (!completer.isCompleted) completer.completeError(error);
      stream.removeListener(listener);
    },
  );
  stream.addListener(listener);
  try {
    final image = await completer.future;
    // onload only after the RGBA bytes exist — see FjsCanvasImages.put
    await FjsCanvasImages.instance.put(handle, image);
    report({'w': image.width, 'h': image.height});
  } catch (_) {
    // the platform's exception type does not cross: the page gets the same
    // fixed message on both platforms, as `<image>`'s @error does
    report({'err': 'canvas image load failed'});
  }
}

// ---- toDataURL ------------------------------------------------------------

Future<void> _toDataUrl({
  required int requestId,
  required MirrorNode? node,
  required void Function(int id, int type, {String? text}) dispatch,
}) async {
  void report(Map<String, Object?> payload) {
    dispatch(requestId, 30, text: jsonEncode({'t': 'dataurl', ...payload}));
  }

  final list = node?.canvas;
  final readback = canvasReadback;
  if (readback != null && node != null && node.webglChunks.isNotEmpty) {
    // a context module (@ufjs/webgl) owns this canvas: the picture is its
    // GL framebuffer, not the (empty) display list — hand the whole export
    // over, same event, same payload
    unawaited(readback(requestId, node.id, report));
    return;
  }
  if (list == null || list.size.isEmpty) {
    report({'err': 'canvas has nothing to export'});
    return;
  }
  try {
    // replayed into a recorder rather than captured from the widget: the
    // display list IS the picture, and going through a RepaintBoundary would
    // pull in whatever the widget's ancestors painted (and would need the
    // canvas to be on screen)
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, Offset.zero & list.size);
    CanvasReplay(canvas, list.size).run(list.chunks);
    final picture = recorder.endRecording();
    final image = await picture.toImage(
      list.size.width.ceil(),
      list.size.height.ceil(),
    );
    picture.dispose();
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (data == null) {
      report({'err': 'canvas export failed'});
      return;
    }
    final base64Png = base64Encode(data.buffer.asUint8List());
    report({'data': 'data:image/png;base64,$base64Png'});
  } catch (_) {
    report({'err': 'canvas export failed'});
  }
}

int _int(List<Object?> args, int index) {
  if (index >= args.length) return 0;
  final value = args[index];
  return value is num ? value.toInt() : int.tryParse('$value') ?? 0;
}
