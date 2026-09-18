// Connect screen: pick a `fjs dev` server. Defaults are platform-aware
// because "localhost" means different things to an emulator and a phone.
//
// Layout, top to bottom, in the order a user on a phone should try them:
// scan (hero card, mobile only) → servers heard on the LAN → recent ones →
// type an address. Every path ends in the same [ConnectScreen.onConnect].
import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'dev_server.dart';
import 'discovery.dart';
import 'help_sheet.dart';
import 'recent_servers.dart';
import 'scan_screen.dart';
import 'theme.dart';
import 'ui.dart';

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({
    super.key,
    required this.recents,
    required this.onConnect,
    this.error,
    this.busy = false,
  });

  final RecentServers? recents;
  final Future<void> Function(DevServer server) onConnect;
  final String? error;
  final bool busy;

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  late final TextEditingController _controller =
      TextEditingController(text: _defaultAddress());
  String? _parseError;

  /// The server a connect is in flight for, so the row (or button) that
  /// started it is the one that spins.
  DevServer? _pending;

  /// Whether [_pending] came from the address field (its button spins).
  bool _pendingFromField = false;

  /// Nearby servers, for as long as this screen is up. Listening stops on
  /// dispose: a connected session has no use for it, and an idle UDP socket
  /// on a phone is not free.
  final DevServerDiscovery _discovery = DevServerDiscovery();

  /// The camera path only exists on the platforms that have one worth using;
  /// on macOS the terminal with the QR code is on the same screen.
  static final bool _canScan = Platform.isAndroid || Platform.isIOS;

  /// An Android emulator reaches the host machine at 10.0.2.2; simulators and
  /// desktop share the host's loopback. A physical device needs the LAN IP
  /// that `fjs dev` prints — nothing here can guess it.
  static String _defaultAddress() {
    final host = Platform.isAndroid ? '10.0.2.2' : '127.0.0.1';
    return '$host:${DevServer.defaultPort}';
  }

  @override
  void initState() {
    super.initState();
    unawaited(_discovery.start());
  }

  @override
  void didUpdateWidget(ConnectScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.busy) _pending = null;
  }

  @override
  void dispose() {
    unawaited(_discovery.stop());
    _controller.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    final server = await scanDevServer(context);
    if (server == null || !mounted) return;
    _controller.text = server.label;
    _connect(server);
  }

  void _submitField([String? raw]) {
    final text = raw ?? _controller.text;
    try {
      _connect(DevServer.parse(text), fromField: true);
      setState(() => _parseError = null);
    } on FormatException catch (e) {
      setState(() => _parseError = e.message);
    }
  }

  void _connect(DevServer server, {bool fromField = false}) {
    if (widget.busy) return;
    FocusScope.of(context).unfocus();
    unawaited(HapticFeedback.selectionClick());
    setState(() {
      _pending = server;
      _pendingFromField = fromField;
    });
    unawaited(widget.onConnect(server));
  }

  Future<void> _forget(DevServer server) async {
    await widget.recents?.forget(server);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final go = GoColors.of(context);
    final recents = widget.recents?.entries ?? const <DevServer>[];
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            // on a tablet the content is shorter than the screen and sits
            // centred; on a phone it scrolls, exactly like a list
            child: LayoutBuilder(
              builder: (context, box) {
                final padding = EdgeInsets.fromLTRB(
                  20,
                  8,
                  20,
                  32 + MediaQuery.paddingOf(context).bottom,
                );
                return SingleChildScrollView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: padding,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: box.maxHeight - padding.vertical,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _TopBar(onHelp: () => showConnectHelp(context)),
                        const SizedBox(height: 24),
                        Text('开始调试', style: theme.textTheme.headlineMedium),
                        const SizedBox(height: 6),
                        Text(
                          '连接电脑上运行的 fjs dev，改完 JS / Vue 代码即刻生效，无需重新编译。',
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(color: go.secondaryText, height: 1.45),
                        ),
                        if (_canScan) ...[
                          const SizedBox(height: 20),
                          _ScanHero(
                            enabled: !widget.busy,
                            onTap: () => unawaited(_scan()),
                          ),
                        ],
                        const SizedBox(height: 12),
                        GroupCard(
                          children: [
                            GoRow(
                              leading: const IconTile(
                                icon: Icons.play_arrow_rounded,
                                color: Brand.pink,
                              ),
                              title: '在线演示',
                              subtitle: '还没有 fjs dev？先看看组件和示例',
                              trailing:
                                  widget.busy && _pending == DevServer.showcase
                                      ? const _RowSpinner()
                                      : const Chevron(),
                              onTap: widget.busy
                                  ? null
                                  : () => _connect(DevServer.showcase),
                            ),
                          ],
                        ),
                        AnimatedSize(
                          duration: const Duration(milliseconds: 220),
                          curve: Curves.easeOutCubic,
                          alignment: Alignment.topCenter,
                          child: widget.error == null
                              ? const SizedBox(width: double.infinity)
                              : Padding(
                                  padding: const EdgeInsets.only(top: 16),
                                  child: _ErrorCard(message: widget.error!),
                                ),
                        ),
                        _NearbyServers(
                          discovery: _discovery,
                          busy: widget.busy,
                          pending: _pending,
                          onPick: _connect,
                        ),
                        if (recents.isNotEmpty) ...[
                          const SectionHeader('最近连接'),
                          GroupCard(
                            children: [
                              for (final server in recents)
                                _RecentRow(
                                  server: server,
                                  busy: widget.busy,
                                  pending: widget.busy &&
                                      !_pendingFromField &&
                                      _pending == server,
                                  onTap: () => _connect(server),
                                  onForget: () => unawaited(_forget(server)),
                                ),
                            ],
                          ),
                        ],
                        const SectionHeader('输入地址'),
                        _AddressCard(
                          controller: _controller,
                          busy: widget.busy,
                          pending: widget.busy && _pendingFromField,
                          error: _parseError,
                          onSubmit: _submitField,
                        ),
                        const SizedBox(height: 28),
                        Center(
                          child: TextButton.icon(
                            onPressed: () => showConnectHelp(context),
                            icon: const Icon(Icons.help_outline_rounded,
                                size: 18),
                            label: const Text('连接遇到问题？'),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.onHelp});

  final VoidCallback onHelp;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        const BrandMark(size: 36),
        const SizedBox(width: 10),
        Text(
          'fjs go',
          style: theme.textTheme.titleLarge?.copyWith(fontSize: 21),
        ),
        const Spacer(),
        IconButton(
          tooltip: '如何连接',
          onPressed: onHelp,
          style: IconButton.styleFrom(
            backgroundColor: GoColors.of(context).card,
          ),
          icon: const Icon(Icons.question_mark_rounded, size: 20),
        ),
      ],
    );
  }
}

/// The primary path on a phone: a big, branded "scan" card.
class _ScanHero extends StatefulWidget {
  const _ScanHero({required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  State<_ScanHero> createState() => _ScanHeroState();
}

class _ScanHeroState extends State<_ScanHero> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed != value) setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '扫一扫',
      enabled: widget.enabled,
      child: GestureDetector(
        onTapDown: widget.enabled ? (_) => _setPressed(true) : null,
        onTapCancel: () => _setPressed(false),
        onTapUp: (_) => _setPressed(false),
        onTap: widget.enabled ? widget.onTap : null,
        child: AnimatedScale(
          scale: _pressed ? 0.97 : 1,
          duration: const Duration(milliseconds: 120),
          child: AnimatedOpacity(
            opacity: widget.enabled ? 1 : 0.55,
            duration: const Duration(milliseconds: 150),
            child: Container(
              height: 156,
              decoration: BoxDecoration(
                gradient: Brand.gradient,
                borderRadius: BorderRadius.circular(22),
                boxShadow: [
                  BoxShadow(
                    color: Brand.orange.withValues(alpha: 0.30),
                    blurRadius: 24,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  Positioned(
                    right: -18,
                    bottom: -26,
                    child: Icon(
                      Icons.qr_code_2_rounded,
                      size: 170,
                      color: Colors.white.withValues(alpha: 0.14),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.22),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(
                            Icons.qr_code_scanner_rounded,
                            color: Colors.white,
                            size: 24,
                          ),
                        ),
                        const Spacer(),
                        const Text(
                          '扫码连接',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '对准 fjs dev 终端里的二维码',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.88),
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Positioned(
                    right: 18,
                    top: 18,
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.arrow_forward_rounded,
                        color: Brand.orange,
                        size: 20,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The servers heard on the LAN. While none have been heard the section
/// says it is listening (with a hint where to look instead) rather than
/// vanishing, so the empty state reads as "searching", not "broken".
class _NearbyServers extends StatelessWidget {
  const _NearbyServers({
    required this.discovery,
    required this.busy,
    required this.pending,
    required this.onPick,
  });

  final DevServerDiscovery discovery;
  final bool busy;
  final DevServer? pending;
  final void Function(DevServer server) onPick;

  @override
  Widget build(BuildContext context) {
    final go = GoColors.of(context);
    final theme = Theme.of(context);
    return StreamBuilder<List<DiscoveredServer>>(
      stream: discovery.changes,
      initialData: discovery.servers,
      builder: (context, snapshot) {
        final found = snapshot.data ?? const <DiscoveredServer>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SectionHeader(
              '附近的服务器',
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  PulseDot(
                    color: found.isEmpty ? go.tertiaryText : Brand.success,
                    size: 6,
                  ),
                  const SizedBox(width: 2),
                  Text(
                    found.isEmpty ? '搜索中' : '${found.length} 个',
                    style: theme.textTheme.labelMedium
                        ?.copyWith(color: go.secondaryText),
                  ),
                ],
              ),
            ),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 250),
              child: found.isEmpty
                  ? const _NearbyEmpty(key: ValueKey('empty'))
                  : GroupCard(
                      key: const ValueKey('list'),
                      children: [
                        for (final nearby in found)
                          GoRow(
                            leading: const IconTile(
                              icon: Icons.bolt_rounded,
                              color: Brand.orange,
                            ),
                            title: nearby.name,
                            subtitle: nearby.mode == 'pages'
                                ? '${nearby.server.label} · 分页构建'
                                : nearby.server.label,
                            monospaceSubtitle: true,
                            trailing: busy && pending == nearby.server
                                ? const _RowSpinner()
                                : const Chevron(),
                            onTap: busy ? null : () => onPick(nearby.server),
                          ),
                      ],
                    ),
            ),
          ],
        );
      },
    );
  }
}

class _NearbyEmpty extends StatelessWidget {
  const _NearbyEmpty({super.key});

  @override
  Widget build(BuildContext context) {
    final go = GoColors.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      decoration: BoxDecoration(
        color: go.card,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          IconTile(icon: Icons.wifi_tethering_rounded, color: go.tertiaryText),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              '正在寻找同一 Wi-Fi 下的 fjs dev。没有出现时，可以扫码或手动输入地址。',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: go.secondaryText,
                    height: 1.45,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RecentRow extends StatelessWidget {
  const _RecentRow({
    required this.server,
    required this.busy,
    required this.pending,
    required this.onTap,
    required this.onForget,
  });

  final DevServer server;
  final bool busy;
  final bool pending;
  final VoidCallback onTap;
  final VoidCallback onForget;

  @override
  Widget build(BuildContext context) {
    final go = GoColors.of(context);
    return Dismissible(
      key: ValueKey('recent-${server.label}'),
      direction: busy ? DismissDirection.none : DismissDirection.endToStart,
      onDismissed: (_) => onForget(),
      background: Container(
        color: Theme.of(context).colorScheme.error,
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 22),
        child: const Icon(Icons.delete_outline_rounded, color: Colors.white),
      ),
      child: GoRow(
        leading: IconTile(icon: Icons.history_rounded, color: go.secondaryText),
        title: server.label,
        titleStyle: Theme.of(context).textTheme.bodyLarge?.copyWith(
          fontWeight: FontWeight.w500,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
        onTap: busy ? null : onTap,
        trailing: pending
            ? const _RowSpinner()
            : IconButton(
                tooltip: '移除',
                visualDensity: VisualDensity.compact,
                onPressed: busy ? null : onForget,
                icon:
                    Icon(Icons.close_rounded, size: 18, color: go.tertiaryText),
              ),
      ),
    );
  }
}

class _AddressCard extends StatelessWidget {
  const _AddressCard({
    required this.controller,
    required this.busy,
    required this.pending,
    required this.error,
    required this.onSubmit,
  });

  final TextEditingController controller;
  final bool busy;
  final bool pending;
  final String? error;
  final void Function([String? raw]) onSubmit;

  @override
  Widget build(BuildContext context) {
    final go = GoColors.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      decoration: BoxDecoration(
        color: go.card,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  enabled: !busy,
                  autocorrect: false,
                  enableSuggestions: false,
                  keyboardType: TextInputType.url,
                  textInputAction: TextInputAction.go,
                  onSubmitted: onSubmit,
                  style: const TextStyle(
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                  decoration: InputDecoration(
                    hintText: '192.168.1.20:${DevServer.defaultPort}',
                    errorText: error,
                    prefixIcon: Icon(Icons.dns_rounded,
                        size: 20, color: go.secondaryText),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(
                width: 76,
                child: GradientButton(
                  label: '连接',
                  height: 50,
                  busy: pending,
                  onPressed: busy ? null : () => onSubmit(),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              'host:port，或粘贴 fjs dev 打印的 URL、https 地址',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: go.tertiaryText),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final error = theme.colorScheme.error;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: error.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: error.withValues(alpha: 0.25), width: 0.5),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_rounded, color: error, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '连接失败',
                  style: theme.textTheme.titleSmall?.copyWith(color: error),
                ),
                const SizedBox(height: 4),
                SelectableText(
                  message,
                  style: theme.textTheme.bodySmall?.copyWith(height: 1.5),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RowSpinner extends StatelessWidget {
  const _RowSpinner();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.all(10),
        child: SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
}
