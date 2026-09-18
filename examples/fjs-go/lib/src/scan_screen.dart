// 扫一扫: read the QR code `fjs dev` draws in the terminal.
//
// Camera frames come from the official `camera` plugin; decoding is zxing2,
// see qr_decode.dart for why that pairing rather than a scanner plugin.
//
// The payload is the string the banner prints (http://192.168.x.x:38900),
// and [DevServer.parse] is what decides whether a code is one of ours. Any
// other QR in view is ignored and the camera keeps looking, which beats
// popping an error for every poster on the wall.
import 'dart:async';
import 'dart:isolate';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'dev_server.dart';
import 'qr_decode.dart';
import 'theme.dart';

/// Pushes the scanner and resolves to the scanned server, or null if the
/// user backed out.
Future<DevServer?> scanDevServer(BuildContext context) {
  return Navigator.of(context).push<DevServer>(
    MaterialPageRoute<DevServer>(
      fullscreenDialog: true,
      builder: (_) => const ScanScreen(),
    ),
  );
}

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen>
    with SingleTickerProviderStateMixin {
  /// A decode takes tens of milliseconds and runs off the frame stream, so
  /// frames arriving while one is in flight are dropped rather than queued.
  bool _decoding = false;

  /// Set once a code has been accepted: popping is not instant, and a second
  /// detection would pop the screen underneath this one.
  bool _done = false;

  CameraController? _camera;
  String? _error;
  bool _torch = false;

  /// Drives the sweep line inside the viewfinder.
  late final AnimationController _sweep = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..repeat();

  @override
  void initState() {
    super.initState();
    unawaited(_openCamera());
  }

  @override
  void dispose() {
    _sweep.dispose();
    // stop the stream before the controller goes: a frame delivered to a
    // disposed controller crashes on both platforms
    final camera = _camera;
    _camera = null;
    if (camera != null) {
      unawaited(() async {
        try {
          if (camera.value.isStreamingImages) await camera.stopImageStream();
        } catch (_) {
          // already stopped, or the platform side is gone
        }
        await camera.dispose();
      }());
    }
    super.dispose();
  }

  Future<void> _openCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) throw CameraException('no camera', '没有可用的相机');
      final back = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      final camera = CameraController(
        back,
        // enough pixels for a terminal QR at arm's length, few enough that a
        // pure-Dart decode stays well under a frame budget
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.yuv420,
      );
      await camera.initialize();
      if (!mounted) {
        await camera.dispose();
        return;
      }
      await camera.startImageStream(_onFrame);
      setState(() => _camera = camera);
    } on CameraException catch (e) {
      if (mounted) setState(() => _error = _explain(e));
    }
  }

  /// The two failures a user can act on, in the words they need.
  String _explain(CameraException e) {
    const denied = {'CameraAccessDenied', 'CameraAccessDeniedWithoutPrompt'};
    if (denied.contains(e.code)) {
      return '没有相机权限。到系统设置里允许 fjs go 使用相机，或者直接输入 fjs dev 打印的地址。';
    }
    return '相机打不开：${e.description ?? e.code}';
  }

  void _onFrame(CameraImage image) {
    if (_decoding || _done || !mounted) return;
    _decoding = true;
    unawaited(_decode(image).whenComplete(() => _decoding = false));
  }

  Future<void> _decode(CameraImage image) async {
    // plane 0 is the luminance plane in every yuv420 layout the plugin
    // produces (3-plane on Android, biplanar NV12 on iOS)
    final plane = image.planes.first;
    final frame = QrFrame(
      bytes: plane.bytes,
      rowStride: plane.bytesPerRow,
      width: image.width,
      height: image.height,
    );
    // off the UI isolate: a full decode is tens of milliseconds and the
    // preview should not stutter while the user is aiming
    final text = await Isolate.run(frame.decode);
    if (text == null || _done || !mounted) return;
    try {
      final server = DevServer.parse(text);
      _done = true;
      unawaited(HapticFeedback.mediumImpact());
      Navigator.of(context).pop(server);
    } on FormatException {
      // some other QR code: keep looking
    }
  }

  Future<void> _toggleTorch() async {
    final camera = _camera;
    if (camera == null) return;
    final next = !_torch;
    try {
      await camera.setFlashMode(next ? FlashMode.torch : FlashMode.off);
      if (mounted) setState(() => _torch = next);
    } on CameraException {
      // no torch on this camera (most tablets' back cameras, simulators)
    }
  }

  @override
  Widget build(BuildContext context) {
    final camera = _camera;
    final error = _error;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          fit: StackFit.expand,
          children: [
            if (error != null)
              _ScanMessage(text: error, icon: Icons.no_photography_outlined)
            else if (camera == null)
              const Center(
                child: CircularProgressIndicator(color: Colors.white70),
              )
            else
              _CoverPreview(camera: camera),
            if (error == null) _Viewfinder(sweep: _sweep),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: Row(
                  children: [
                    _GlassButton(
                      icon: Icons.close_rounded,
                      tooltip: '关闭',
                      onPressed: () => Navigator.of(context).maybePop(),
                    ),
                    const Expanded(
                      child: Text(
                        '扫码连接',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    // keeps the title centred when the torch is unavailable
                    Opacity(
                      opacity: camera == null ? 0 : 1,
                      child: _GlassButton(
                        icon: _torch
                            ? Icons.flashlight_on_rounded
                            : Icons.flashlight_off_rounded,
                        tooltip: _torch ? '关闭手电筒' : '打开手电筒',
                        active: _torch,
                        onPressed: camera == null
                            ? null
                            : () => unawaited(_toggleTorch()),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (error == null)
              Align(
                alignment: Alignment.bottomCenter,
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(32, 0, 32, 36),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text(
                          '对准 fjs dev 终端里的二维码',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '识别成功后会自动连接',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.65),
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The preview scaled to fill the screen (cropping, not letterboxing).
/// `previewSize` is reported in sensor orientation, i.e. landscape.
class _CoverPreview extends StatelessWidget {
  const _CoverPreview({required this.camera});

  final CameraController camera;

  @override
  Widget build(BuildContext context) {
    final preview = camera.value.previewSize;
    if (preview == null) return CameraPreview(camera);
    final portrait =
        MediaQuery.orientationOf(context) == Orientation.portrait;
    return ClipRect(
      child: FittedBox(
        fit: BoxFit.cover,
        child: SizedBox(
          width: portrait ? preview.height : preview.width,
          height: portrait ? preview.width : preview.height,
          child: CameraPreview(camera),
        ),
      ),
    );
  }
}

/// Dims everything but a centred square, with brand-coloured corners and a
/// sweep line — the conventional "point the code here" affordance.
class _Viewfinder extends StatelessWidget {
  const _Viewfinder({required this.sweep});

  final Animation<double> sweep;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, box) {
          final side = (box.biggest.shortestSide * 0.68).clamp(200.0, 320.0);
          final rect = Rect.fromCenter(
            center: box.biggest.center(const Offset(0, -24)),
            width: side,
            height: side,
          );
          return AnimatedBuilder(
            animation: sweep,
            builder: (context, _) => CustomPaint(
              size: box.biggest,
              painter: _ViewfinderPainter(rect: rect, t: sweep.value),
            ),
          );
        },
      ),
    );
  }
}

class _ViewfinderPainter extends CustomPainter {
  _ViewfinderPainter({required this.rect, required this.t});

  final Rect rect;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final hole = RRect.fromRectAndRadius(rect, const Radius.circular(24));
    canvas.drawPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRect(Offset.zero & size),
        Path()..addRRect(hole),
      ),
      Paint()..color = Colors.black.withValues(alpha: 0.55),
    );

    // corner brackets
    const len = 34.0;
    const r = 24.0;
    final corner = Paint()
      ..shader = Brand.gradient.createShader(rect)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4.5
      ..strokeCap = StrokeCap.round;
    final l = rect.left, tp = rect.top, rt = rect.right, b = rect.bottom;
    final path = Path()
      ..moveTo(l, tp + len)
      ..lineTo(l, tp + r)
      ..arcToPoint(Offset(l + r, tp), radius: const Radius.circular(r))
      ..lineTo(l + len, tp)
      ..moveTo(rt - len, tp)
      ..lineTo(rt - r, tp)
      ..arcToPoint(Offset(rt, tp + r), radius: const Radius.circular(r))
      ..lineTo(rt, tp + len)
      ..moveTo(rt, b - len)
      ..lineTo(rt, b - r)
      ..arcToPoint(Offset(rt - r, b), radius: const Radius.circular(r))
      ..lineTo(rt - len, b)
      ..moveTo(l + len, b)
      ..lineTo(l + r, b)
      ..arcToPoint(Offset(l, b - r), radius: const Radius.circular(r))
      ..lineTo(l, b - len);
    canvas.drawPath(path, corner);

    // sweep line: eases down, fades at both ends
    final eased = Curves.easeInOut.transform(t);
    final y = rect.top + 18 + (rect.height - 36) * eased;
    final fade = (1 - (2 * t - 1).abs()).clamp(0.0, 1.0);
    final line = Rect.fromLTWH(rect.left + 20, y - 1, rect.width - 40, 2);
    canvas.drawRRect(
      RRect.fromRectAndRadius(line, const Radius.circular(1)),
      Paint()
        ..shader = LinearGradient(colors: [
          Brand.orange.withValues(alpha: 0),
          Brand.orange.withValues(alpha: 0.95 * fade),
          Brand.pink.withValues(alpha: 0),
        ]).createShader(line),
    );
  }

  @override
  bool shouldRepaint(_ViewfinderPainter old) => old.t != t || old.rect != rect;
}

class _GlassButton extends StatelessWidget {
  const _GlassButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.active = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        backgroundColor:
            active ? Colors.white : Colors.white.withValues(alpha: 0.16),
        foregroundColor: active ? Brand.ink : Colors.white,
        fixedSize: const Size(44, 44),
      ),
      icon: Icon(icon, size: 22),
    );
  }
}

class _ScanMessage extends StatelessWidget {
  const _ScanMessage({required this.text, required this.icon});

  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(40),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: Colors.white70, size: 34),
              ),
              const SizedBox(height: 20),
              Text(
                text,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 15,
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
