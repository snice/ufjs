// Session screen: the connected project owns the whole viewport, edge to
// edge — its own nav bar, tab bar and safe-area strips are what the user
// sees, exactly as in an embedded host. fjs go's controls live behind one
// small draggable button that opens the dev menu (reload / logs /
// disconnect).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_fjs/flutter_fjs.dart';

import 'dev_server.dart';
import 'log_store.dart';
import 'theme.dart';
import 'ui.dart';

class SessionScreen extends StatelessWidget {
  const SessionScreen({
    super.key,
    required this.engine,
    required this.server,
    required this.manifest,
    required this.logs,
    required this.onReload,
    required this.onDisconnect,
  });

  final FjsEngine engine;
  final DevServer server;
  final DevManifest manifest;
  final LogStore logs;
  final Future<void> Function() onReload;
  final VoidCallback onDisconnect;

  void _showMenu(BuildContext context) {
    unawaited(HapticFeedback.lightImpact());
    showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      builder: (sheet) => _DevMenu(
        server: server,
        manifest: manifest,
        logs: logs,
        onReload: () {
          Navigator.pop(sheet);
          onReload();
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(const SnackBar(
              content: Text('正在重新加载…'),
              duration: Duration(milliseconds: 1200),
            ));
        },
        onShowLogs: () {
          Navigator.pop(sheet);
          _showLogs(context);
        },
        onDisconnect: () {
          Navigator.pop(sheet);
          onDisconnect();
        },
      ),
    );
  }

  void _showLogs(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _LogSheet(logs: logs),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // FjsApp, not FjsView: the connected project's routes become
          // real Flutter routes, so the back gesture and the page
          // transition are the platform's
          Positioned.fill(
            child: FjsApp(
              engine: engine,
              placeholder: const Center(child: CircularProgressIndicator()),
            ),
          ),
          _DevButton(logs: logs, onTap: () => _showMenu(context)),
        ],
      ),
    );
  }
}

/// The floating handle to the dev menu. Draggable, snaps to the nearer
/// side, and stays clear of the safe area so it never sits on a nav bar
/// button of the project it floats over. A red badge is the only hint a
/// phone user gets that the JS side logged an error, so it lives here.
class _DevButton extends StatefulWidget {
  const _DevButton({required this.logs, required this.onTap});

  final LogStore logs;
  final VoidCallback onTap;

  @override
  State<_DevButton> createState() => _DevButtonState();
}

class _DevButtonState extends State<_DevButton> {
  static const _size = 48.0;
  static const _margin = 12.0;

  /// Fraction of the free vertical range, and which side it docks to.
  double _yFraction = 0.72;
  bool _right = true;

  /// Live position while a drag is in progress.
  Offset? _drag;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final pad = media.padding;
    final size = media.size;
    final minY = pad.top + _margin;
    final maxY = size.height - pad.bottom - _size - _margin - 56;
    final left = pad.left + _margin;
    final right = size.width - pad.right - _size - _margin;

    final docked = Offset(
      _right ? right : left,
      minY + (maxY - minY).clamp(0, double.infinity) * _yFraction,
    );
    final pos = _drag ?? docked;

    return AnimatedPositioned(
      duration: _drag == null
          ? const Duration(milliseconds: 260)
          : Duration.zero,
      curve: Curves.easeOutBack,
      left: pos.dx,
      top: pos.dy,
      child: GestureDetector(
        onTap: widget.onTap,
        onPanStart: (_) => setState(() => _drag = docked),
        onPanUpdate: (d) => setState(() {
          final p = (_drag ?? docked) + d.delta;
          _drag = Offset(
            p.dx.clamp(left, right),
            p.dy.clamp(minY, maxY < minY ? minY : maxY),
          );
        }),
        onPanEnd: (_) => setState(() {
          final p = _drag!;
          _right = p.dx + _size / 2 > size.width / 2;
          _yFraction = maxY > minY ? (p.dy - minY) / (maxY - minY) : 0;
          _drag = null;
        }),
        child: Tooltip(
          message: '开发菜单',
          child: ListenableBuilder(
            listenable: widget.logs,
            builder: (context, _) => _Bubble(
              size: _size,
              hasErrors: widget.logs.hasErrors,
            ),
          ),
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.size, required this.hasErrors});

  final double size;
  final bool hasErrors;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return SizedBox(
      width: size + 6,
      height: size + 6,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: 3,
            top: 3,
            child: Container(
              width: size,
              height: size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: dark
                    ? const Color(0xE62A2A2E)
                    : Brand.ink.withValues(alpha: 0.88),
                border: Border.all(
                  color: Colors.white.withValues(alpha: dark ? 0.12 : 0.0),
                  width: 0.5,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.25),
                    blurRadius: 14,
                    offset: const Offset(0, 5),
                  ),
                ],
              ),
              child: ShaderMask(
                shaderCallback: Brand.gradient.createShader,
                child: const Icon(Icons.bolt_rounded,
                    color: Colors.white, size: 28),
              ),
            ),
          ),
          if (hasErrors)
            Positioned(
              right: 2,
              top: 2,
              child: Container(
                width: 14,
                height: 14,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.error,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DevMenu extends StatelessWidget {
  const _DevMenu({
    required this.server,
    required this.manifest,
    required this.logs,
    required this.onReload,
    required this.onShowLogs,
    required this.onDisconnect,
  });

  final DevServer server;
  final DevManifest manifest;
  final LogStore logs;
  final VoidCallback onReload;
  final VoidCallback onShowLogs;
  final VoidCallback onDisconnect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final go = GoColors.of(context);
    final error = theme.colorScheme.error;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // project header
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: go.card,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: Brand.gradient,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.bolt_rounded,
                      color: Colors.white, size: 26),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        manifest.displayName,
                        style: theme.textTheme.titleMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          Container(
                            width: 7,
                            height: 7,
                            decoration: const BoxDecoration(
                              color: Brand.success,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              manifest.isHosted
                                  ? '在线演示 · ${server.host}'
                                  : '已连接 · ${server.label}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: go.secondaryText,
                                fontFeatures: const [
                                  FontFeature.tabularFigures()
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          GroupCard(
            children: [
              GoRow(
                leading: const IconTile(
                  icon: Icons.refresh_rounded,
                  color: Color(0xFF0A84FF),
                ),
                title: '重新加载',
                subtitle: manifest.isHosted ? '重新下载并启动' : '保存文件时会自动重载',
                onTap: onReload,
              ),
              ListenableBuilder(
                listenable: logs,
                builder: (context, _) {
                  final count = logs.entries.length;
                  return GoRow(
                    leading: IconTile(
                      icon: Icons.terminal_rounded,
                      color: logs.hasErrors ? error : const Color(0xFF8E8E93),
                    ),
                    title: '日志',
                    subtitle: logs.hasErrors ? '有错误输出' : 'console 输出与连接状态',
                    onTap: onShowLogs,
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (count > 0)
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: logs.hasErrors
                                  ? error
                                  : go.fieldFill,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              '$count',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: logs.hasErrors
                                    ? Colors.white
                                    : go.secondaryText,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        const Chevron(),
                      ],
                    ),
                  );
                },
              ),
            ],
          ),
          const SizedBox(height: 12),
          GroupCard(
            children: [
              GoRow(
                leading: IconTile(icon: Icons.logout_rounded, color: error),
                title: manifest.isHosted ? '退出演示' : '断开连接',
                titleStyle: theme.textTheme.bodyLarge?.copyWith(
                  color: error,
                  fontWeight: FontWeight.w500,
                ),
                onTap: onDisconnect,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _LogSheet extends StatelessWidget {
  const _LogSheet({required this.logs});

  final LogStore logs;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final go = GoColors.of(context);
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.65,
      maxChildSize: 0.95,
      builder: (context, controller) => ListenableBuilder(
        listenable: logs,
        builder: (context, _) {
          final entries = logs.entries.reversed.toList();
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 12, 8),
                child: Row(
                  children: [
                    Text('日志', style: theme.textTheme.titleLarge),
                    const SizedBox(width: 8),
                    Text(
                      '${entries.length}',
                      style: theme.textTheme.titleMedium
                          ?.copyWith(color: go.tertiaryText),
                    ),
                    const Spacer(),
                    TextButton(
                      onPressed: entries.isEmpty ? null : logs.clear,
                      child: const Text('清空'),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: entries.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.terminal_rounded,
                                size: 40, color: go.tertiaryText),
                            const SizedBox(height: 10),
                            Text(
                              '暂无输出',
                              style: theme.textTheme.bodyMedium
                                  ?.copyWith(color: go.secondaryText),
                            ),
                          ],
                        ),
                      )
                    : Container(
                        margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                        decoration: BoxDecoration(
                          color: go.card,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: ListView.separated(
                          controller: controller,
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          itemCount: entries.length,
                          separatorBuilder: (_, __) => Divider(
                            height: 0.5,
                            indent: 14,
                            color: go.separator,
                          ),
                          itemBuilder: (context, i) =>
                              _LogRow(entry: entries[i]),
                        ),
                      ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _LogRow extends StatelessWidget {
  const _LogRow({required this.entry});

  final LogEntry entry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final go = GoColors.of(context);
    final (color, tint) = switch (entry.level) {
      LogLevel.error => (scheme.error, scheme.error.withValues(alpha: 0.07)),
      LogLevel.warn => (
          const Color(0xFFC77700),
          const Color(0xFFFF9F0A).withValues(alpha: 0.08),
        ),
      LogLevel.status => (scheme.primary, Colors.transparent),
      LogLevel.log => (scheme.onSurface, Colors.transparent),
    };
    final t = entry.at;
    final stamp = '${t.hour.toString().padLeft(2, '0')}:'
        '${t.minute.toString().padLeft(2, '0')}:'
        '${t.second.toString().padLeft(2, '0')}';
    const mono = TextStyle(
      fontFamily: 'Menlo',
      fontFamilyFallback: ['monospace', 'Courier'],
    );
    return Container(
      color: tint,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Text(
              stamp,
              style: mono.copyWith(fontSize: 11, color: go.tertiaryText),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: SelectableText(
              entry.message,
              style: mono.copyWith(fontSize: 12, color: color, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}
