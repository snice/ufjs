// Flutter side of the fjs module "@ufjs/audio": the host modules behind
// createAudio() (specs/215).
//
// fjs autolinks this — the generated host depends on this package and calls
// FjsAudio.register(engine) before runApp, because the module's
// package.json says so in its "fjs.flutter" field. This is the only place
// audioplayers is allowed to live: third-party pub deps stay out of the
// flutter_fjs core (constitution IX).
//
//   fjs.audio.create(handle, src, configJson)    async, event 45
//   fjs.audio.cmd(handle, cmd, value?)           play/pause/stop/seek/loop/
//                                                volume — fire and forget
//   fjs.audio.get(handle, 'position'|'duration') SYNCHRONOUS (cached)
//   fjs.audio.dispose(handle)                    fire and forget
//
// create follows the fetch/canvas-image paradigm: JS allocates the handle,
// this starts the work and returns immediately, and completion comes back
// as FjsEvent.audio (45) with {"t":"ended"} / {"t":"error","err":…}. There
// is no `src` command: reassigning src on an existing context re-enters
// create (JS sends create again with the same handle), so the whole load
// path — bytes, error reporting, autoplay — stays in ONE path instead of
// two.
//
// The `get` call is synchronous on purpose — a page reading currentTime
// cannot await — and answers from the position cache the streams keep warm,
// not from a round trip. audioplayers has no sync position getter, so the
// cache is as live as the platform's updates are (sub-second staleness).
//
// Local sources (dev-server paths and release assets) are loaded to bytes
// ONCE at create and handed to audioplayers as BytesSource: a game plays a
// 16 KB shot effect several times a second, and re-streaming it per play()
// would put a network round trip inside the fire loop. Authored remote
// http(s) URLs stay UrlSource — pre-downloading a user-supplied file of
// unknown size is not our call to make.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter/services.dart' show MissingPluginException, rootBundle;

import 'package:flutter_fjs/flutter_fjs.dart';

/// The audio event number. Allocated centrally in fjs.h
/// (`FJS_EVENT_AUDIO`) and mirrored in flutter_fjs's FjsEvent as `audio`,
/// but referenced as the literal here: the module must analyze against the
/// PUBLISHED flutter_fjs too, and the number is stable contract — the same
/// mirror the JS entry keeps in EVENT_AUDIO.
const int _eventAudio = 45;

class FjsAudio {
  static FjsEngine? _engine;
  static int _generation = -1;
  static final Map<int, _AudioEntry> _entries = <int, _AudioEntry>{};

  /// Registers the host modules. The engine listener is the reload hook:
  /// a rebuilt VM numbers handles from 1 again, and holding the old players
  /// would alias the next VM's handles (same discipline as
  /// FjsCanvasImages.clear; the core does that one internally, a module
  /// does it through engine.addListener — the iconmind pattern).
  static void register(FjsEngine engine) {
    if (!identical(_engine, engine)) {
      _engine?.removeListener(_invalidateOnReload);
      _engine = engine;
      _generation = engine.tree.generation;
      engine.addListener(_invalidateOnReload);
    }
    engine.host
      ..register('fjs.audio.create', (args) {
        final handle = _int(args, 0);
        final src = args.length > 1 ? args[1]?.toString() ?? '' : '';
        var loop = false;
        var autoplay = false;
        var volume = 1.0;
        if (args.length > 2) {
          try {
            final config =
                jsonDecode(args[2]?.toString() ?? '{}') as Map<String, Object?>;
            loop = config['loop'] == true;
            autoplay = config['autoplay'] == true;
            volume = (config['volume'] as num?)?.toDouble() ?? 1.0;
          } catch (_) {
            // malformed config keeps the defaults; src is what matters
          }
        }
        // re-entered create (src reassigned): the old player dies with its
        // streams before the new one takes the handle
        final stale = _entries.remove(handle);
        if (stale != null) unawaited(stale.dispose());

        final entry = _AudioEntry(player: AudioPlayer(), autoplay: autoplay);
        _entries[handle] = entry;
        unawaited(
          _load(
            entry: entry,
            handle: handle,
            src: src,
            loop: loop,
            volume: volume,
            devUri: engine.devUri,
            devGeneration: engine.tree.generation,
          ),
        );
        return null;
      })
      ..register('fjs.audio.cmd', (args) {
        final handle = _int(args, 0);
        final entry = _entries[handle];
        if (entry == null) return null; // stale handle (VM rebuilt) — drop it
        final cmd = args.length > 1 ? args[1]?.toString() ?? '' : '';
        unawaited(
          _command(entry, handle, cmd, args.length > 2 ? args[2] : null),
        );
        return null;
      })
      ..register('fjs.audio.get', (args) {
        final entry = _entries[_int(args, 0)];
        if (entry == null) return 0.0;
        return (args.length > 1 ? args[1]?.toString() : 'position') == 'duration'
            ? entry.cachedDuration.inMilliseconds / 1000.0
            : entry.cachedPosition.inMilliseconds / 1000.0;
      })
      ..register('fjs.audio.dispose', (args) {
        final handle = _int(args, 0);
        final entry = _entries.remove(handle);
        if (entry != null) unawaited(entry.dispose());
        return null;
      });
  }

  static void _invalidateOnReload() {
    final generation = _engine?.tree.generation ?? -1;
    if (generation == _generation) return;
    _generation = generation;
    for (final entry in _entries.values) {
      unawaited(entry.dispose());
    }
    _entries.clear();
  }

  /// The dispatch guard the core modules keep internally (`_disposed ||
  /// _vm == null`) is not visible here — a late ended/error racing a reload
  /// would throw inside _requireVm, and a lost completion event is better
  /// than an exception in a fire-and-forget future.
  static void _dispatch(int handle, Map<String, Object?> payload) {
    final engine = _engine;
    if (engine == null) return;
    try {
      engine.dispatchEvent(handle, _eventAudio, text: jsonEncode(payload));
    } catch (_) {}
  }

  static Future<void> _load({
    required _AudioEntry entry,
    required int handle,
    required String src,
    required bool loop,
    required double volume,
    required Uri? devUri,
    required int devGeneration,
  }) async {
    Future<void> die(String err) async {
      _dispatch(handle, {'t': 'error', 'err': err});
      _entries.remove(handle);
      await entry.dispose();
    }

    try {
      await entry.player
          .setReleaseMode(loop ? ReleaseMode.loop : ReleaseMode.stop);
      await entry.player.setVolume(volume.clamp(0.0, 1.0).toDouble());

      final source = await _resolveSource(src, devUri, devGeneration);
      if (source == null) {
        await die('audio load failed: $src');
        return;
      }
      entry.source = source;

      entry._positionSub = entry.player.onPositionChanged.listen(
        (d) => entry.cachedPosition = d,
      );
      entry._durationSub = entry.player.onDurationChanged.listen(
        (d) => entry.cachedDuration = d,
      );
      entry._completeSub = entry.player.onPlayerComplete.listen((_) {
        // ReleaseMode.loop never completes; ended only fires on one-shots —
        // which is exactly wx's loop semantics
        _dispatch(handle, {'t': 'ended'});
      });

      if (entry.autoplay) {
        await entry.player.play(source);
      } else {
        // preload so the first play() is instant and a bad source errors
        // HERE, at create time, not at the first play
        await entry.player.setSource(source);
      }
    } on MissingPluginException {
      // audioplayers has no implementation for this platform (ohos) — say
      // so instead of erroring invisibly on every play (constitution V)
      _warnNoPlatformImplementation();
      await die('audio unavailable on this platform');
    } catch (_) {
      // the platform's exception type does not cross: the page gets the
      // same fixed message on both platforms, as canvas image loads do
      await die('audio load failed: $src');
    }
  }

  static Future<void> _command(
    _AudioEntry entry,
    int handle,
    String cmd,
    Object? value,
  ) async {
    void reportError(String err) =>
        _dispatch(handle, {'t': 'error', 'err': err});

    try {
      switch (cmd) {
        case 'play':
          final state = entry.player.state;
          if (state == PlayerState.playing) return;
          if (state == PlayerState.paused) {
            await entry.player.resume();
          } else {
            final source = entry.source;
            if (source != null) {
              await entry.player.play(source);
            } else {
              await entry.player.resume();
            }
          }
        case 'pause':
          await entry.player.pause();
        case 'stop':
          await entry.player.stop();
        case 'seek':
          final ms = (((value as num?)?.toDouble() ?? 0.0) * 1000).round();
          entry.cachedPosition = Duration(milliseconds: ms);
          await entry.player.seek(Duration(milliseconds: ms));
        case 'loop':
          await entry.player.setReleaseMode(
            value == true ? ReleaseMode.loop : ReleaseMode.stop,
          );
        case 'volume':
          final v =
              ((value as num?)?.toDouble() ?? 1.0).clamp(0.0, 1.0).toDouble();
          await entry.player.setVolume(v);
        default:
          break;
      }
    } on MissingPluginException {
      _warnNoPlatformImplementation();
      reportError('audio unavailable on this platform');
    } catch (_) {
      reportError('audio $cmd failed');
    }
  }

  /// Resolves the same three src forms `<image>` takes (see
  /// fjsResolveImageSource — one src shape, one meaning, two consumers; keep
  /// the normalization in step). Local paths come back as preloaded bytes;
  /// explicit remote URLs stay streaming. Null for forms audio cannot use
  /// (data:, unusable paths).
  static Future<Source?> _resolveSource(
    String src,
    Uri? devUri,
    int devGeneration,
  ) async {
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return UrlSource(src);
    }
    if (src.startsWith('data:')) {
      return null;
    }
    var path = src;
    if (path.startsWith('asset://')) path = path.substring('asset://'.length);
    path = path.replaceFirst(RegExp(r'^/+'), '');
    if (path.isEmpty || path.contains('..')) return null;

    if (devUri != null) {
      final base = devUri.toString().replaceAll(RegExp(r'/+$'), '');
      // same cache-busting counter <image> uses on dev URLs
      final bust = devGeneration > 0 ? '?fjs=$devGeneration' : '';
      final bytes = await _httpGetBytes(Uri.parse('$base/$path$bust'));
      return bytes == null ? null : BytesSource(bytes);
    }
    try {
      final data = await rootBundle.load('assets/fjs/public/$path');
      return BytesSource(
        data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
      );
    } catch (_) {
      return null;
    }
  }

  static Future<Uint8List?> _httpGetBytes(Uri uri) async {
    try {
      final client = HttpClient();
      try {
        final request = await client.getUrl(uri);
        final response = await request.close();
        if (response.statusCode != 200) return null;
        final builder = BytesBuilder(copy: false);
        await for (final chunk in response) {
          builder.add(chunk);
        }
        return builder.takeBytes();
      } finally {
        client.close();
      }
    } catch (_) {
      return null;
    }
  }

  static bool _warnedNoPlatform = false;
  static void _warnNoPlatformImplementation() {
    if (_warnedNoPlatform) return;
    _warnedNoPlatform = true;
    // the one platform audioplayers does not build for today (ohos) — every
    // audio call would otherwise die invisibly (constitution V)
    debugPrint(
      '[fjs] audio: no audioplayers implementation on this platform — audio is disabled',
    );
  }

  static int _int(List<Object?> args, int index) {
    if (index >= args.length) return 0;
    final value = args[index];
    return value is num ? value.toInt() : int.tryParse('$value') ?? 0;
  }
}

class _AudioEntry {
  _AudioEntry({required this.player, required this.autoplay});

  final AudioPlayer player;
  bool autoplay;
  Source? source;
  Duration cachedPosition = Duration.zero;
  Duration cachedDuration = Duration.zero;
  StreamSubscription<Duration>? _positionSub;
  StreamSubscription<Duration>? _durationSub;
  StreamSubscription<void>? _completeSub;
  bool _disposed = false;

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    unawaited(_positionSub?.cancel());
    unawaited(_durationSub?.cancel());
    unawaited(_completeSub?.cancel());
    await player.dispose();
  }
}
