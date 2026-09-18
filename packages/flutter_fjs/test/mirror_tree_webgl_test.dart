// Op 11 decoding on the core side: the WEBGL op's payload is opaque here —
// plain bytes queued on MirrorNode.webglChunks for the @ufjs/webgl module to
// drain and execute. These assertions pin that the queue is per node,
// appended in order, and that node removal hands the node to the module's
// dispose hook. The bytes themselves are pinned on the module side
// (packages/fjs-webgl/flutter/test/webgl_replay_test.dart).
import 'dart:typed_data';

import 'package:flutter_fjs/flutter_fjs.dart' show UiOpCode, canvasNodeDisposed;
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_test/flutter_test.dart';

/// One WEBGL op: u8 op, u32 id, u32 byteLen, bytes (little-endian).
Uint8List webglOp(int nodeId, List<int> payload) {
  final out = BytesBuilder();
  out.addByte(UiOpCode.webgl);
  void u32(int v) =>
      out.add([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
  u32(nodeId);
  u32(payload.length);
  out.add(payload);
  return out.toBytes();
}

void main() {
  test('op 11 queues opaque chunks on the node, in order', () {
    final tree = MirrorTree();
    tree.applyFrame(_createOp(7, 'inner-canvas'));
    tree.applyFrame(webglOp(7, [1]));
    tree.applyFrame(webglOp(7, [2, 3]));

    final node = tree.node(7)!;
    expect(node.webglChunks, hasLength(2));
    expect(node.webglChunks[0], Uint8List.fromList([1]));
    expect(node.webglChunks[1], Uint8List.fromList([2, 3]));
  });

  test('chunks from two webgl canvases stay on their own nodes', () {
    final tree = MirrorTree();
    tree.applyFrame(_createOp(7, 'inner-canvas'));
    tree.applyFrame(_createOp(8, 'inner-canvas'));
    tree.applyFrame(webglOp(7, [1]));
    tree.applyFrame(webglOp(8, [9]));
    expect(tree.node(7)!.webglChunks, hasLength(1));
    expect(tree.node(8)!.webglChunks, hasLength(1));
  });

  test('removing a webgl node calls the module dispose hook', () {
    final disposed = <int>[];
    canvasNodeDisposed = disposed.add;
    addTearDown(() => canvasNodeDisposed = null);

    final tree = MirrorTree();
    tree.applyFrame(_createOp(7, 'inner-canvas'));
    tree.applyFrame(webglOp(7, [1]));
    tree.applyFrame(_removeOp(7));

    expect(disposed, [7]);
  });

  test('a node without webgl chunks never reaches the dispose hook', () {
    final disposed = <int>[];
    canvasNodeDisposed = disposed.add;
    addTearDown(() => canvasNodeDisposed = null);

    final tree = MirrorTree();
    tree.applyFrame(_createOp(9, 'view'));
    tree.applyFrame(_removeOp(9));
    expect(disposed, isEmpty);
  });
}

/// CREATE op: u8 op, u32 id, u16 len, utf8 tag.
Uint8List _createOp(int nodeId, String tag) {
  final out = BytesBuilder();
  out.addByte(UiOpCode.create);
  void u32(int v) =>
      out.add([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
  u32(nodeId);
  final encoded = Uint8List.fromList(tag.codeUnits);
  out.addByte(encoded.length & 0xff);
  out.addByte((encoded.length >> 8) & 0xff);
  out.add(encoded);
  return out.toBytes();
}

/// REMOVE op: u8 op, u32 id.
Uint8List _removeOp(int nodeId) {
  final out = BytesBuilder();
  out.addByte(UiOpCode.remove);
  out.add([
    nodeId & 0xff,
    (nodeId >> 8) & 0xff,
    (nodeId >> 16) & 0xff,
    (nodeId >> 24) & 0xff,
  ]);
  return out.toBytes();
}
