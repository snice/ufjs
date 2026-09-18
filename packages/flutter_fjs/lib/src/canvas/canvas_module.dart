// Extension seams for canvas context modules (`@ufjs/webgl`).
//
// The core owns the canvas element, the 2d display list and the op protocol
// (op 11's chunk bytes land on MirrorNode.webglChunks); it deliberately
// knows nothing about WebGL or flutter_angle. A context module — installed
// via its pub package's `register(engine)` — fills these three hooks:
//
//   canvasDisplayOverride  render the node as the module's view (a Texture
//                          for webgl) instead of the 2d CustomPaint;
//   canvasReadback         answer `fjs.canvas.toDataURL` for nodes the
//                          module owns (the display list is empty there);
//   canvasNodeDisposed     free per-node GPU resources when a node goes.
//
// All three are nullable and unset by default: an app without the module
// pays nothing, and `getContext('webgl')` falls to the registry's
// unregistered behavior (null + one warning) on BOTH platforms.
import 'package:flutter/widgets.dart' show Widget;

import '../mirror_tree.dart';
import '../widgets/dispatch.dart';

/// Builds the node's view when a module owns its display. Return null to
/// fall through to the 2d CustomPaint (e.g. the node never created a webgl
/// context).
typedef FjsCanvasDisplayOverride =
    Widget? Function(MirrorNode node, FjsDispatch dispatch);

/// Exports a node's picture as a data URL and reports it the way the 2d
/// `toDataURL` path does (`dispatch(requestId, 30, text: {'t': 'dataurl',
/// ...})`). Called only for nodes with op 11 chunks.
typedef FjsCanvasReadback =
    Future<void> Function(
      int requestId,
      int nodeId,
      void Function(Map<String, Object?> payload) report,
    );

/// Frees whatever the module pinned to this node (GL context, texture).
typedef FjsCanvasNodeDisposed = void Function(int nodeId);

FjsCanvasDisplayOverride? canvasDisplayOverride;
FjsCanvasReadback? canvasReadback;
FjsCanvasNodeDisposed? canvasNodeDisposed;
