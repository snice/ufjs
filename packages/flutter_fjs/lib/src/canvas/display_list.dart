// One canvas node's retained drawing commands.
//
// A canvas is RETAINED: what a page drew stays on screen until something
// clears it. The JS side only sends the commands it produced this frame, so
// somebody has to keep the rest, and that somebody is here rather than in
// JS. The alternative — JS re-sending its whole command list every frame —
// is equivalent for a chart (ECharts opens each frame with a full-canvas
// clearRect anyway) but degrades to O(n^2) for the incremental case a canvas
// exists for: a signature pad appends one stroke per frame and would re-send
// every earlier stroke with it.
//
// Growth is bounded the way a browser's is: a full-canvas clearRect (or
// reset()) makes every earlier command unobservable. The JS writer knows the
// canvas size and the current transform, so it is the side that recognises
// that case; it ends the current chunk and starts the next one with
// CLEAR_ALL. That keeps the decision in one place AND keeps every chunk
// self-contained — chunks carry their own string table, so a chunk could not
// be sliced here even if this side wanted to.
//
// A page that never clears is the one case that can still grow, and it gets
// warned rather than silently eating memory (constitution V).
import 'dart:typed_data';
import 'dart:ui' show Size;

import 'canvas_ops.dart' show CanvasCmd;

/// Retained bytes past which a page is doing something the retained model
/// cannot absorb. Far above a busy frame, far below a memory problem.
const int _byteBudget = 8 * 1024 * 1024;

/// Retained chunks past which a page is animating without ever clearing the
/// whole canvas — the shape a "dirty rectangle" renderer has (it clears only
/// the boxes it is about to redraw). Every frame then ADDS to what the
/// painter replays, so the frame cost climbs with the frame count long
/// before the byte budget above notices. Four seconds at 60fps: far more
/// than a page that clears properly ever holds, far less than the point
/// where the jank is subtle.
const int _chunkBudget = 240;

class FjsCanvasDisplayList {
  final List<Uint8List> _chunks = [];
  int _bytes = 0;
  int _version = 0;
  bool _warnedBudget = false;
  bool _warnedChunks = false;

  /// The box's last laid-out size, in logical pixels. Kept here because it
  /// is what toDataURL rasterizes into, and the host module has the display
  /// list but not the widget.
  Size size = Size.zero;

  /// Bumped on every change; the painter compares it to decide repaints.
  int get version => _version;

  bool _needsLayer = false;

  /// True once the page has erased PART of the canvas. A DOM canvas owns its
  /// own bitmap, so clearRect there means "these pixels become transparent";
  /// the replay draws straight into the widget layer, where the same
  /// blend-clear would erase whatever is painted under the canvas box (it
  /// came out as a black bar under F2's tooltip, which redraws only its own
  /// dirty rectangle). So a canvas that does this gets replayed into a
  /// saveLayer — paid for only by the pages that need it.
  bool get needsLayer => _needsLayer;

  /// The chunks to replay, oldest first.
  List<Uint8List> get chunks => _chunks;

  bool get isEmpty => _chunks.isEmpty;

  /// Appends one frame's commands. A chunk that opens with CLEAR_ALL makes
  /// everything before it invisible, so it replaces the list.
  void append(Uint8List commands) {
    if (commands.isEmpty) return;
    // Both markers ride at the head, and NEEDS_LAYER can sit in front of a
    // CLEAR_ALL: the writer stamps every chunk once a canvas has started
    // erasing itself, truncating chunk included.
    final marked = commands[0] == CanvasCmd.needsLayer;
    final head = marked ? 1 : 0;
    if (head < commands.length && commands[head] == CanvasCmd.clearAll) {
      _chunks.clear();
      _bytes = 0;
      _needsLayer = false;
    }
    if (marked) _needsLayer = true;
    _chunks.add(commands);
    _bytes += commands.length;
    _version++;
    if (_chunks.length > _chunkBudget && !_warnedChunks) {
      _warnedChunks = true;
      // ignore: avoid_print
      print(
        '[fjs] <canvas> has drawn ${_chunks.length} frames without a '
        'full-canvas clearRect(); the host replays all of them on every '
        'repaint, so this gets slower the longer it runs. Clear the whole '
        'canvas before redrawing — a charting library doing "dirty '
        'rectangle" rendering has to be told to stop (see '
        'docs/canvas-compat.md).',
      );
    }
    if (_bytes > _byteBudget && !_warnedBudget) {
      _warnedBudget = true;
      // ignore: avoid_print
      print(
        '[fjs] <canvas> has retained ${_bytes ~/ 1024}KB of drawing '
        'commands without a full-canvas clearRect(); the host keeps them '
        'all so the picture survives repaints. Call '
        'clearRect(0, 0, width, height) before redrawing.',
      );
    }
  }

  /// Drops everything. The host does this when the box changes size: a
  /// browser clears the bitmap when its backing store is resized, and
  /// keeping the picture here would make the two platforms disagree
  /// (constitution I).
  void clear() {
    if (_chunks.isEmpty) return;
    _chunks.clear();
    _bytes = 0;
    _needsLayer = false;
    _version++;
  }
}
