// Flutter side of the @ufjs/webgl module: ANGLE-backed WebGL for canvas
// nodes. Installed by autolink (`FjsWebgl.register(engine)` runs before
// runApp) and wired through three seams flutter_fjs exposes for canvas
// context modules:
//
//   canvasDisplayOverride  the node's Texture view (instead of 2d paint);
//   canvasReadback         toDataURL for nodes this module owns;
//   canvasNodeDisposed     GPU resource release when a node goes away.
//
// plus the synchronous `fjs.webgl.*` host modules the JS context queries.
// Everything GPU-facing lives in src/replay.dart; this file is the
// registration and the widget.
import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform;
import 'package:flutter/widgets.dart';

import 'package:flutter_fjs/flutter_fjs.dart'
    show
        canvasDisplayOverride,
        canvasNodeDisposed,
        canvasReadback,
        FjsEngine,
        MirrorNode;

import 'src/replay.dart' show FjsWebglRuntime;

// re-exported for module consumers that want the decoder/bindings surface
export 'src/replay.dart';

export 'src/replay.dart'
    show FjsActiveInfo, FjsGlBindings, WebglChunkDecoder;

// per-canvas context state over the plugin's one shared GL context (spec 036)
export 'src/gl_state.dart';

/// Registration entry. Idempotent; the generated host calls it once per
/// engine before `runApp`.
class FjsWebgl {
  FjsWebgl._();

  static FjsEngine? _engine;

  static void register(FjsEngine engine) {
    _engine = engine;
    const methods = [
      'getError',
      'getAttribLocation',
      'getUniformLocation',
      'getParameter',
      'getShaderParameter',
      'getProgramParameter',
      'getShaderInfoLog',
      'getProgramInfoLog',
      'getShaderSource',
      'getActiveAttrib',
      'getActiveUniform',
      'getUniform',
      'getVertexAttrib',
      'getBufferParameter',
      'getFramebufferAttachmentParameter',
      'getRenderbufferParameter',
      'isBuffer',
      'isTexture',
      'isProgram',
      'isShader',
      'isFramebuffer',
      'isRenderbuffer',
      'checkFramebufferStatus',
      'getContextAttributes',
      'getSupportedExtensions',
      'contextReady',
    ];
    for (final method in methods) {
      engine.host.register('fjs.webgl.$method', (args) {
        if (args.isEmpty) return null;
        final nodeId = (args.first as num?)?.toInt() ?? 0;
        try {
          return FjsWebglRuntime.instance.query(
              nodeId, method, args.sublist(1));
        } catch (e, st) {
          // The JS side only sees "host module call failed", which says
          // nothing about WHERE on the Dart side it broke — print the real
          // exception so a device log can be diagnosed at all (constitution
          // V), then rethrow so the failure stays a failure.
          debugPrint('[fjs] fjs.webgl.$method threw: $e\n$st');
          rethrow;
        }
      });
    }
    canvasDisplayOverride = _displayOverride;
    canvasReadback = _readback;
    canvasNodeDisposed = FjsWebglRuntime.instance.disposeNode;
  }

  /// The node's view, when this module owns its display (op 11 chunks have
  /// arrived). The core's renderer rebuilds the node on every op-11 touch,
  /// and the view re-pumps inside a post-frame callback — GL calls belong
  /// next to the raster work, not inside a build pass.
  static Widget? _displayOverride(MirrorNode node, _) {
    if (node.webglChunks.isEmpty && _engine != null) {
      // steady-state node that already drained: still a webgl display if a
      // context exists for it — otherwise this canvas never left the 2d path
      final hasContext = FjsWebglRuntime.instance.textureId(node.id) != null ||
          _pumpedNodes.contains(node.id);
      if (!hasContext) return null;
    }
    return FjsWebglCanvasView(node: node);
  }

  static Future<void> _readback(
    int requestId,
    int nodeId,
    void Function(Map<String, Object?> payload) report,
  ) async {
    final readback = FjsWebglRuntime.instance.readback(nodeId);
    if (readback == null) {
      report({'err': 'canvas has nothing to export'});
      return;
    }
    try {
      final buffer = await ui.ImmutableBuffer.fromUint8List(readback.rgba);
      final descriptor = ui.ImageDescriptor.raw(
        buffer,
        width: readback.width,
        height: readback.height,
        pixelFormat: ui.PixelFormat.rgba8888,
      );
      final codec = await descriptor.instantiateCodec();
      final frame = await codec.getNextFrame();
      final data = await frame.image.toByteData(format: ui.ImageByteFormat.png);
      frame.image.dispose();
      codec.dispose();
      descriptor.dispose();
      buffer.dispose();
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
}

/// Nodes whose webgl view has mounted at least once. After the first pump a
/// node keeps its GL context even with an empty chunk list, so the display
/// override must keep returning the Texture view — an empty chunk list alone
/// cannot distinguish "webgl node, between frames" from "plain 2d canvas".
final Set<int> _pumpedNodes = {};

/// The webgl half of a canvas node: a Texture fed by [FjsWebgl]. Command
/// execution is deferred to after the frame.
class FjsWebglCanvasView extends StatefulWidget {
  const FjsWebglCanvasView({super.key, required this.node});

  final MirrorNode node;

  @override
  State<FjsWebglCanvasView> createState() => _FjsWebglCanvasViewState();
}

class _FjsWebglCanvasViewState extends State<FjsWebglCanvasView> {
  bool _pumpScheduled = false;
  bool _layerReadyScheduled = false;
  Size _size = Size.zero;

  /// Tells the runtime, after the frame this build belongs to, that the
  /// node's `Texture` layer now exists — that is what releases a held-back
  /// present (see FjsWebglRuntime.present). Every build with a texture id
  /// schedules it, so GL work drained outside a pump (a JS-side query drains
  /// mid-draw) still reaches the screen.
  void _scheduleLayerReady() {
    if (_layerReadyScheduled) return;
    _layerReadyScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _layerReadyScheduled = false;
      if (!mounted) return;
      FjsWebglRuntime.instance.layerReady(widget.node.id);
    });
  }

  /// The queue itself is the work list: [FjsWebglRuntime.pump] drains it and
  /// leaves it empty, so "is there anything to do" is "is it non-empty" (plus
  /// a size change, which needs a new texture even with nothing queued).
  ///
  /// This used to compare the queue's LENGTH against the last pumped one,
  /// which silently dropped frames: draining resets the length to 0, so the
  /// next batch of the same size looked like the one already handled. A page
  /// that renders continuously only stuttered — the frame after it grew the
  /// queue past the remembered number. A page that renders ON DEMAND
  /// (spec 023's two glTF viewers, one frame when the model finishes
  /// loading) lost its only frame and stayed black forever.
  void _schedulePump(Size size) {
    if (_pumpScheduled) return;
    if (widget.node.webglChunks.isEmpty && size == _size) return;
    _pumpScheduled = true;
    _size = size;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _pumpScheduled = false;
        if (!mounted) return;
        _pumpedNodes.add(widget.node.id);
        final dpr = MediaQuery.maybeOf(context)?.devicePixelRatio ?? 1;
        FjsWebglRuntime.instance.pump(widget.node, _size, dpr).whenComplete(() {
          // the texture id only exists (or changes) once creation finished
          if (mounted) setState(() {});
        });
      });
  }

  @override
  void didUpdateWidget(FjsWebglCanvasView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _schedulePump(_size);
  }

  @override
  Widget build(BuildContext context) {
    // Laid-out size from the box, exactly where the core's canvas widget
    // reports it from. A pure-webgl node never creates a 2d display list,
    // so node.canvas is null here — the box is the only size there is.
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(
          constraints.maxWidth.isFinite ? constraints.maxWidth : 0,
          constraints.maxHeight.isFinite ? constraints.maxHeight : 0,
        );
        _schedulePump(size);
        final id = FjsWebglRuntime.instance.textureId(widget.node.id);
        if (id != null) _scheduleLayerReady();
        if (id == null) {
          // context still building (or failed): an empty box of the styled
          // size, the same placeholder the 2d path shows before its first
          // draw
          return const SizedBox.expand();
        }
        // GL framebuffers are bottom-up. iOS's CVPixelBuffer path presents
        // them as-is, so the picture arrives vertically mirrored against the
        // browser's top-down presentation and has to be flipped here. Android
        // does not: SurfaceProducer already applies the texture transform —
        // and neither does ohos, whose OHNativeWindow texture behaves the same
        // (a flip there stood the glTF viewer's model on its head).
        //
        // Getting this wrong is not a cosmetic bug. A page that compensates
        // in its own projection matrix (mirroring clip-space Y) also reverses
        // triangle winding, so GL's idea of front and back swaps: with
        // CULL_FACE on, every front face is discarded and the picture is the
        // model's inside — geometry and silhouette intact, normals pointing
        // away from the camera, so every lighting term that uses the normal
        // collapses while ambient looks fine (spec 023: three.js's Xbot lit
        // correctly on web, flat and dark on Android).
        final texture = Texture(textureId: id);
        if (defaultTargetPlatform == TargetPlatform.android ||
            FjsWebglRuntime.isOhos) {
          return texture;
        }
        return Transform(
          transform: Matrix4.diagonal3Values(1.0, -1.0, 1.0),
          alignment: Alignment.center,
          child: texture,
        );
      },
    );
  }
}
