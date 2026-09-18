// Decoded images, by the handle the JS side allocated.
//
// The pixels stay here on purpose: a decoded bitmap is the one thing in the
// canvas subsystem that must not cross the boundary (v1 passes scalars, and
// base64'ing a texture per frame would dwarf everything else the frame
// costs). JS holds a number, this table holds the ui.Image.
//
// Not in display_list.dart because images outlive any one canvas: two
// canvases can draw the same loaded image, and a canvas that is torn down
// and rebuilt on a route change should not have to decode it again.
import 'dart:typed_data';
import 'dart:ui' as ui;

class FjsCanvasImages {
  FjsCanvasImages._();

  static final FjsCanvasImages instance = FjsCanvasImages._();

  final Map<int, ui.Image> _byHandle = {};

  /// Raw RGBA bytes (straight alpha), extracted once when the image is
  /// decoded. WebGL's texImage2D needs synchronous pixel access — a GL page
  /// uploads a texture and draws with it in the same command stream — and
  /// dart:ui cannot produce the bytes synchronously. One copy per image,
  /// paid at load time, not per upload.
  final Map<int, Uint8List> _rgbaByHandle = {};

  ui.Image? lookup(int handle) => _byHandle[handle];

  /// The image's RGBA bytes and dimensions, or null when the handle is
  /// unknown or its extraction failed. Never null for an image whose load
  /// the page has already been told about: [put] completes only after the
  /// extraction, and the loader reports the load after awaiting it.
  ({int width, int height, Uint8List bytes})? rgba(int handle) {
    final bytes = _rgbaByHandle[handle];
    if (bytes == null) return null;
    final image = _byHandle[handle];
    if (image == null) return null;
    return (width: image.width, height: image.height, bytes: bytes);
  }

  /// Files [image] under [handle] and completes once its RGBA bytes are
  /// extracted.
  ///
  /// The caller must await this before telling the page the image loaded.
  /// WebGL uploads on `onload` and three.js uploads each texture exactly
  /// once: reporting before the bytes exist meant texImage2D found nothing,
  /// skipped, and the texture stayed black for good (a textured glTF lost
  /// a handful of its maps at random).
  Future<void> put(int handle, ui.Image image) {
    _byHandle[handle]?.dispose();
    _byHandle[handle] = image;
    return _extractRgba(handle, image);
  }

  Future<void> _extractRgba(int handle, ui.Image image) async {
    try {
      final data = await image.toByteData(
        format: ui.ImageByteFormat.rawStraightRgba,
      );
      if (data != null) _rgbaByHandle[handle] = data.buffer.asUint8List();
    } catch (_) {
      // a failed extraction only means texImage2D cannot use this image
    }
  }

  void remove(int handle) {
    _rgbaByHandle.remove(handle);
    _byHandle.remove(handle)?.dispose();
  }

  /// Drops everything. Called when the VM is reset: the handles were the old
  /// VM's, and the next one starts numbering from 1 again.
  void clear() {
    for (final image in _byHandle.values) {
      image.dispose();
    }
    _byHandle.clear();
    _rgbaByHandle.clear();
  }

  /// Decodes [bytes] and files it under [handle].
  static Future<ui.Image> decode(Uint8List bytes) async {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    return frame.image;
  }
}
