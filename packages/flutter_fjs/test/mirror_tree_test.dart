// Decoder round-trip against frames matching fjs-runtime's OpWriter
// encoding (hand-encoded here to avoid a Node dependency in Dart tests).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/src/mirror_tree.dart';
import 'package:flutter_fjs/src/ui_ops.dart';

class _W {
  final List<int> b = [];
  void u8(int v) => b.add(v & 0xff);
  void u16(int v) => b
    ..add(v & 0xff)
    ..add((v >> 8) & 0xff);
  void u32(int v) {
    final d = ByteData(4)..setUint32(0, v, Endian.little);
    b.addAll(d.buffer.asUint8List());
  }

  void str(String s) => b.addAll(utf8.encode(s));
  void raw(List<int> l) => b.addAll(l);

  void create(int id, String tag) {
    u8(UiOpCode.create);
    u32(id);
    final t = utf8.encode(tag);
    u16(t.length);
    raw(t);
  }

  void defineStyle(int styleId, String json) {
    u8(UiOpCode.defineStyle);
    u32(styleId);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
  }

  void setStyle(int id, int styleId, [int activeStyleId = 0]) {
    u8(UiOpCode.setStyle);
    u32(id);
    u32(styleId);
    u32(activeStyleId);
  }

  void setProps(int id, String json) {
    u8(UiOpCode.setProps);
    u32(id);
    final j = utf8.encode(json);
    u32(j.length);
    raw(j);
  }

  void insert(int parent, int child, int index) {
    u8(UiOpCode.insert);
    u32(parent);
    u32(child);
    u32(index);
  }

  void remove(int id) {
    u8(UiOpCode.remove);
    u32(id);
  }

  Uint8List get frame => Uint8List.fromList(b);
}

void main() {
  _styleTests();

  test('create/insert/setText/setProps frame applies', () {
    final w = _W();
    // create #1 'view'
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(4);
    w.str('view');
    // insert parent=0 child=1 index=0
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    // create #2 'text' + text + props, insert into #1
    w.u8(UiOpCode.create);
    w.u32(2);
    w.u16(4);
    w.str('text');
    w.u8(UiOpCode.setText);
    w.u32(2);
    w.u32(5);
    w.str('hello');
    w.u8(UiOpCode.setProps);
    w.u32(2);
    final json = utf8.encode('{"style":{"fontSize":20}}');
    w.u32(json.length);
    w.raw(json);
    w.u8(UiOpCode.insert);
    w.u32(1);
    w.u32(2);
    w.u32(0);

    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));

    expect(tree.version, 1);
    expect(tree.rootChildren, [1]);
    expect(tree.node(1)!.tag, 'view');
    expect(tree.node(1)!.children, [2]);
    expect(tree.node(2)!.text, 'hello');
    expect((tree.node(2)!.props['style'] as Map)['fontSize'], 20);
  });

  test('removeChild and remove detach nodes', () {
    final w = _W();
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(4);
    w.str('view');
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    // removeChild parent=0 child=1, then remove #1
    w.u8(UiOpCode.removeChild);
    w.u32(0);
    w.u32(1);
    w.u8(UiOpCode.remove);
    w.u32(1);

    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));
    expect(tree.rootChildren, isEmpty);
    expect(tree.node(1), isNull);
  });

  test('remove drops a whole subtree and its node signals', () {
    final w = _W()
      ..create(1, 'view')
      ..create(2, 'view')
      ..create(3, 'text')
      ..insert(0, 1, 0)
      ..insert(1, 2, 0)
      ..insert(2, 3, 0)
      ..defineStyle(1, '{"color":"red"}')
      ..setStyle(2, 1);
    final tree = MirrorTree()..applyFrame(w.frame);
    final oldSignal = tree.listenableFor(2);

    tree.applyFrame((_W()..remove(1)).frame);

    expect(tree.nodeCount, 0);
    expect(tree.rootChildren, isEmpty);
    expect(tree.node(1), isNull);
    expect(tree.node(2), isNull);
    expect(tree.node(3), isNull);
    expect(identical(tree.listenableFor(2), oldSignal), isFalse);
  });

  test('setProps merges per-key patches instead of replacing', () {
    final w = _W();
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(6);
    w.str('button');
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    // event marker first...
    w.u8(UiOpCode.setProps);
    w.u32(1);
    var json = utf8.encode('{"onTap":true}');
    w.u32(json.length);
    w.raw(json);
    // ...then a style flush from the style engine
    w.u8(UiOpCode.setProps);
    w.u32(1);
    json = utf8.encode('{"style":{"margin":4}}');
    w.u32(json.length);
    w.raw(json);

    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));

    expect(tree.node(1)!.props['onTap'], true);
    expect((tree.node(1)!.props['style'] as Map)['margin'], 4);
  });

  test('frames replay deterministically into a cleared tree', () {
    // one session: view#1 { text#2 'hi', button#3 'go' with onTap marker }
    final List<int> session;
    {
      final w = _W();
      w.u8(UiOpCode.create);
      w.u32(1);
      w.u16(4);
      w.str('view');
      w.u8(UiOpCode.insert);
      w.u32(0);
      w.u32(1);
      w.u32(0);
      w.u8(UiOpCode.create);
      w.u32(2);
      w.u16(4);
      w.str('text');
      w.u8(UiOpCode.setText);
      w.u32(2);
      w.u32(2);
      w.str('hi');
      w.u8(UiOpCode.insert);
      w.u32(1);
      w.u32(2);
      w.u32(0);
      w.u8(UiOpCode.create);
      w.u32(3);
      w.u16(6);
      w.str('button');
      w.u8(UiOpCode.setProps);
      w.u32(3);
      var json = utf8.encode('{"onTap":true}');
      w.u32(json.length);
      w.raw(json);
      w.u8(UiOpCode.setText);
      w.u32(3);
      w.u32(2);
      w.str('go');
      w.u8(UiOpCode.insert);
      w.u32(1);
      w.u32(3);
      w.u32(1);
      session = w.b;
    }

    MirrorTree play() {
      final tree = MirrorTree();
      tree.applyFrame(Uint8List.fromList(session));
      return tree;
    }

    final live = play();
    // restore path: fresh tree (clear bumps generation), replay same frames
    final restored = MirrorTree();
    restored.clear();
    restored.applyFrame(Uint8List.fromList(session));

    for (final id in [1, 2, 3]) {
      expect(restored.node(id)!.tag, live.node(id)!.tag);
      expect(restored.node(id)!.text, live.node(id)!.text);
      expect(restored.node(id)!.props, live.node(id)!.props);
      expect(restored.node(id)!.children, live.node(id)!.children);
    }
    expect(restored.rootChildren, live.rootChildren);
  });

  test('re-inserting a child moves it instead of mounting it twice', () {
    final w = _W();
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(4);
    w.str('view');
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    // a fresh VM re-inserts the same root id (snapshot restore path) and
    // keyed diffs re-insert moved children — both must detach first
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);

    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));

    expect(tree.rootChildren, [1]);
  });

  test('truncated frame throws with offset', () {
    final tree = MirrorTree();
    expect(
      () => tree.applyFrame(Uint8List.fromList([UiOpCode.create, 1])),
      throwsA(isA<UiOpException>()),
    );
  });
}

// ---- interned styles (ops 7/8/9) -------------------------------------------

void _styleTests() {
  test('one definition serves every node that references it', () {
    final w = _W()
      ..create(1, 'view')
      ..create(2, 'view')
      ..defineStyle(7, '{"color":"#333333","fontSize":14}')
      ..setStyle(1, 7)
      ..setStyle(2, 7);

    final tree = MirrorTree()..applyFrame(w.frame);
    final a = tree.node(1)!;
    final b = tree.node(2)!;
    expect(a.styleMap['color'], '#333333');
    expect(b.styleMap['fontSize'], 14);
    // the same map instance, not two copies: this identity is what lets the
    // widget layer cache parsed values per style rather than per node
    expect(identical(a.styleMap, b.styleMap), isTrue);
  });

  test('setProps merges alongside a style without clobbering it', () {
    final w = _W()
      ..create(1, 'view')
      ..defineStyle(3, '{"color":"red"}')
      ..setStyle(1, 3)
      ..setProps(1, '{"onTap":true}');

    final node = (MirrorTree()..applyFrame(w.frame)).node(1)!;
    expect(node.props['onTap'], true);
    expect(node.styleMap['color'], 'red');
  });

  test('setStyle replaces rather than merging', () {
    final w = _W()
      ..create(1, 'view')
      ..defineStyle(1, '{"color":"red","fontSize":10}')
      ..setStyle(1, 1)
      ..defineStyle(2, '{"color":"blue"}')
      ..setStyle(1, 2);

    final node = (MirrorTree()..applyFrame(w.frame)).node(1)!;
    expect(node.styleMap['color'], 'blue');
    expect(node.styleMap.containsKey('fontSize'), isFalse);
  });

  test('activeStyle rides along, and id 0 clears it', () {
    final w = _W()
      ..create(1, 'view')
      ..defineStyle(1, '{"backgroundColor":"#fff"}')
      ..defineStyle(2, '{"backgroundColor":"#eee"}')
      ..setStyle(1, 1, 2);

    final tree = MirrorTree()..applyFrame(w.frame);
    expect(tree.node(1)!.activeStyleMap, {'backgroundColor': '#eee'});

    tree.applyFrame((_W()..setStyle(1, 1)).frame);
    expect(tree.node(1)!.activeStyleMap, isNull);
  });

  test('an undefined style id leaves the node as it was', () {
    // what a frame log recorded mid-session replays as: the SetStyle is
    // there, the definition that preceded it is not
    final w = _W()
      ..create(1, 'view')
      ..defineStyle(1, '{"color":"red"}')
      ..setStyle(1, 1);
    final tree = MirrorTree()..applyFrame(w.frame);

    tree.applyFrame((_W()..setStyle(1, 99)).frame);
    expect(tree.node(1)!.styleMap['color'], 'red');
  });

  test(
    'resetStyles drops the directory but not what nodes already resolved',
    () {
      final w = _W()
        ..create(1, 'view')
        ..defineStyle(5, '{"color":"green"}')
        ..setStyle(1, 5);
      final tree = MirrorTree()..applyFrame(w.frame);

      tree.applyFrame((_W()..u8(UiOpCode.resetStyles)).frame);
      expect(tree.node(1)!.styleMap['color'], 'green');

      // the id is gone, so a later reference to it is the undefined case
      tree.applyFrame(
        (_W()
              ..create(2, 'view')
              ..setStyle(2, 5))
            .frame,
      );
      expect(tree.node(2)!.styleMap, isEmpty);
    },
  );

  test('clear drops the style directory too', () {
    final w = _W()
      ..create(1, 'view')
      ..defineStyle(4, '{"color":"red"}')
      ..setStyle(1, 4);
    final tree = MirrorTree()..applyFrame(w.frame);
    tree.clear();

    tree.applyFrame(
      (_W()
            ..create(1, 'view')
            ..setStyle(1, 4))
          .frame,
    );
    expect(tree.node(1)!.styleMap, isEmpty);
  });

  test('a style carried the legacy way still reads through styleMap', () {
    final w = _W()
      ..create(1, 'view')
      ..setProps(1, '{"style":{"color":"red"},"activeStyle":{"color":"blue"}}');
    final node = (MirrorTree()..applyFrame(w.frame)).node(1)!;
    expect(node.styleMap['color'], 'red');
    expect(node.activeStyleMap, {'color': 'blue'});
  });
}
