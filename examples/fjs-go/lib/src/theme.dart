// Visual language for fjs go's own screens (connect, scan, dev menu).
//
// Taken from the app icon: near-black ink, and the lightning bolt's
// yellow → orange → pink gradient as the single accent. Everything else is
// neutral so the accent only marks what is actionable. The connected
// project's pages are not styled from here — they bring their own look.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

abstract final class Brand {
  static const yellow = Color(0xFFFFC400);
  static const orange = Color(0xFFFF7A00);
  static const pink = Color(0xFFE83A6B);
  static const ink = Color(0xFF141414);

  /// The bolt's gradient, for the hero card and primary buttons.
  static const gradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFFF9500), orange, pink],
    stops: [0, 0.45, 1],
  );

  static const success = Color(0xFF34C759);
}

/// Colours the Material scheme has no slot for.
@immutable
class GoColors extends ThemeExtension<GoColors> {
  const GoColors({
    required this.card,
    required this.separator,
    required this.secondaryText,
    required this.tertiaryText,
    required this.fieldFill,
  });

  final Color card;
  final Color separator;
  final Color secondaryText;
  final Color tertiaryText;
  final Color fieldFill;

  static const light = GoColors(
    card: Colors.white,
    separator: Color(0x1F3C3C43),
    secondaryText: Color(0xFF6E6E73),
    tertiaryText: Color(0xFFA1A1A6),
    fieldFill: Color(0xFFF2F2F5),
  );

  static const dark = GoColors(
    card: Color(0xFF1C1C1F),
    separator: Color(0x33EBEBF5),
    secondaryText: Color(0xFF9A9AA0),
    tertiaryText: Color(0xFF636368),
    fieldFill: Color(0xFF2A2A2E),
  );

  static GoColors of(BuildContext context) =>
      Theme.of(context).extension<GoColors>() ?? light;

  @override
  GoColors copyWith({
    Color? card,
    Color? separator,
    Color? secondaryText,
    Color? tertiaryText,
    Color? fieldFill,
  }) =>
      GoColors(
        card: card ?? this.card,
        separator: separator ?? this.separator,
        secondaryText: secondaryText ?? this.secondaryText,
        tertiaryText: tertiaryText ?? this.tertiaryText,
        fieldFill: fieldFill ?? this.fieldFill,
      );

  @override
  GoColors lerp(GoColors? other, double t) {
    if (other == null) return this;
    return GoColors(
      card: Color.lerp(card, other.card, t)!,
      separator: Color.lerp(separator, other.separator, t)!,
      secondaryText: Color.lerp(secondaryText, other.secondaryText, t)!,
      tertiaryText: Color.lerp(tertiaryText, other.tertiaryText, t)!,
      fieldFill: Color.lerp(fieldFill, other.fieldFill, t)!,
    );
  }
}

ThemeData buildGoTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final go = dark ? GoColors.dark : GoColors.light;
  final background = dark ? const Color(0xFF0B0B0D) : const Color(0xFFF4F4F7);
  final onSurface = dark ? const Color(0xFFF5F5F7) : Brand.ink;
  // orange text on white is under 3:1; a deeper tone for the plain
  // (non-gradient) accent keeps links and icons legible
  final primary = dark ? const Color(0xFFFF9A3C) : const Color(0xFFE55F00);

  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.orange,
    brightness: brightness,
  ).copyWith(
    primary: primary,
    onPrimary: Colors.white,
    secondary: Brand.pink,
    surface: background,
    onSurface: onSurface,
    onSurfaceVariant: go.secondaryText,
    outline: go.tertiaryText,
    outlineVariant: go.separator,
    surfaceContainerLowest: go.card,
    surfaceContainerLow: go.card,
    surfaceContainer: go.card,
    surfaceContainerHigh: go.card,
    surfaceContainerHighest: go.fieldFill,
    error: dark ? const Color(0xFFFF6961) : const Color(0xFFD70015),
  );

  final base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: background,
    splashFactory: InkSparkle.splashFactory,
    extensions: [go],
  );

  final text = base.textTheme.apply(
    bodyColor: onSurface,
    displayColor: onSurface,
  );

  return base.copyWith(
    textTheme: text.copyWith(
      headlineMedium: text.headlineMedium?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.6,
      ),
      titleLarge: text.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
      ),
      titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      titleSmall: text.titleSmall?.copyWith(fontWeight: FontWeight.w600),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: background,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: true,
      systemOverlayStyle:
          dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
      titleTextStyle: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      foregroundColor: onSurface,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: go.fieldFill,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: TextStyle(color: go.tertiaryText),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: primary, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.error, width: 1.5),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.error, width: 1.5),
      ),
    ),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: primary,
      selectionColor: primary.withValues(alpha: 0.25),
      selectionHandleColor: primary,
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: primary,
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: background,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: go.tertiaryText,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: primary),
    dividerTheme: DividerThemeData(color: go.separator, thickness: 0.5),
    tooltipTheme: const TooltipThemeData(waitDuration: Duration(seconds: 1)),
  );
}
