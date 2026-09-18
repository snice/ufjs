// "如何连接" sheet: the three ways in, which address to type where, and the
// failures that do not explain themselves (iOS local-network permission,
// pointing the scanner at `fjs dev --web`).
import 'dart:io' show Platform;

import 'package:flutter/material.dart';

import 'dev_server.dart';
import 'theme.dart';
import 'ui.dart';

Future<void> showConnectHelp(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => const _HelpSheet(),
  );
}

class _HelpSheet extends StatelessWidget {
  const _HelpSheet();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final go = GoColors.of(context);
    const port = DevServer.defaultPort;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      maxChildSize: 0.95,
      builder: (context, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
        children: [
          Text('如何连接', style: theme.textTheme.titleLarge),
          const SizedBox(height: 6),
          Text(
            '在电脑上的 fjs 工程目录运行 fjs dev，它会在终端打印地址和二维码。',
            style: theme.textTheme.bodyMedium?.copyWith(color: go.secondaryText),
          ),
          const SizedBox(height: 16),
          const _Terminal(lines: ['cd my-fjs-app', 'fjs dev']),
          const SectionHeader('三种连接方式'),
          GroupCard(
            children: [
              if (Platform.isAndroid || Platform.isIOS)
                const _Step(
                  icon: Icons.qr_code_scanner_rounded,
                  color: Brand.orange,
                  title: '扫一扫',
                  body: '对准 fjs dev 终端里的二维码，真机最快的方式。',
                ),
              const _Step(
                icon: Icons.wifi_tethering_rounded,
                color: Color(0xFF0A84FF),
                title: '附近的服务器',
                body: '同一 Wi-Fi 下，fjs dev 会自动出现在首页列表，点一下即可。',
              ),
              const _Step(
                icon: Icons.keyboard_rounded,
                color: Color(0xFF8E8E93),
                title: '手动输入',
                body: '填写 host:port，也可以直接粘贴完整 URL。',
              ),
            ],
          ),
          const SectionHeader('该填哪个地址'),
          const GroupCard(
            dividerIndent: 14,
            children: [
              _AddressRow(where: 'iOS 模拟器 / macOS', address: '127.0.0.1:$port'),
              _AddressRow(where: 'Android 模拟器', address: '10.0.2.2:$port'),
              _AddressRow(where: '真机（同一局域网）', address: '192.168.x.x:$port'),
            ],
          ),
          const SectionHeader('连不上？'),
          GroupCard(
            dividerIndent: 14,
            children: [
              if (!Platform.isAndroid)
                const _Tip(
                  title: 'iOS 本地网络权限',
                  body: '首次连接时若点了“不允许”，列表仍能看到服务器但连不上。'
                      '到 设置 → fjs go → 本地网络 打开即可。',
                ),
              const _Tip(
                title: '确认在同一网络',
                body: '访客网络、AP 隔离、跨网段都会让手机和电脑互相看不见。'
                    '这种情况请扫码或手动输入。',
              ),
              const _Tip(
                title: '扫对二维码',
                body: '请扫 fjs dev 或 fjs dev --pages 的码（默认端口 $port）。'
                    'fjs dev --web 是给浏览器用的，不能连。',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Terminal extends StatelessWidget {
  const _Terminal({required this.lines});

  final List<String> lines;

  @override
  Widget build(BuildContext context) {
    const mono = TextStyle(
      fontFamily: 'Menlo',
      fontFamilyFallback: ['monospace', 'Courier'],
      fontSize: 13,
      height: 1.6,
    );
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
      decoration: BoxDecoration(
        color: const Color(0xFF16161A),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              _Light(Color(0xFFFF5F57)),
              _Light(Color(0xFFFEBC2E)),
              _Light(Color(0xFF28C840)),
            ],
          ),
          const SizedBox(height: 10),
          for (final line in lines)
            Text.rich(
              TextSpan(children: [
                const TextSpan(
                  text: '\$ ',
                  style: TextStyle(color: Brand.orange),
                ),
                TextSpan(text: line),
              ]),
              style: mono.copyWith(color: const Color(0xFFE6E6EA)),
            ),
        ],
      ),
    );
  }
}

class _Light extends StatelessWidget {
  const _Light(this.color);

  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: 10,
        height: 10,
        margin: const EdgeInsets.only(right: 6),
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      );
}

class _Step extends StatelessWidget {
  const _Step({
    required this.icon,
    required this.color,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          IconTile(icon: icon, color: color),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleSmall),
                const SizedBox(height: 2),
                Text(
                  body,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: GoColors.of(context).secondaryText),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AddressRow extends StatelessWidget {
  const _AddressRow({required this.where, required this.address});

  final String where;
  final String address;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      child: Row(
        children: [
          Expanded(child: Text(where, style: theme.textTheme.bodyMedium)),
          SelectableText(
            address,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: GoColors.of(context).secondaryText,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _Tip extends StatelessWidget {
  const _Tip({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: theme.textTheme.titleSmall),
          const SizedBox(height: 4),
          Text(
            body,
            style: theme.textTheme.bodySmall?.copyWith(
              color: GoColors.of(context).secondaryText,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}
