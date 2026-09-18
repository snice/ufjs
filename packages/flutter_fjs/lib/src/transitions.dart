// The named page transitions. `transition: 'fjs-fade'` on the JS side has
// to look the same on iOS, on Android and on web — the web half is a CSS
// family in the runtime's base stylesheet (base-css.ts), this is the
// native half. The default ('') is deliberately *not* in here: it stays
// the platform's own transition, which is what an app that never mentions
// transitions should get.
//
// CupertinoPageTransitionsBuilder lives in material on Flutter <= 3.43 and
// moved to cupertino in 3.44 (breaking change decouple-page-transition-
// builders). Neither library re-exports it across that line, so importing
// both is what compiles everywhere between our floor (3.38) and pub.dev's
// latest stable — on <= 3.43 the name resolves from material, on 3.44+
// from cupertino. The ignore is for the <= 3.43 side, where this import
// contributes nothing; on 3.44+ it is the one that provides the name.
// ignore: unnecessary_import
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class FjsTransitionSpec {
  const FjsTransitionSpec({
    required this.builder,
    required this.duration,
    this.cupertinoRoute = false,
  });

  final PageTransitionsBuilder builder;
  final Duration duration;
  final bool cupertinoRoute;
}

/// Route transition spec for a name from the JS side, or null when the name
/// has no native animation — 'none', and any name this side does not know
/// (a web CSS family of the app's own, which falls back to the platform's).
FjsTransitionSpec? fjsTransitionSpec(String name) {
  switch (name) {
    case 'fjs-slide':
      return const FjsTransitionSpec(
        builder: CupertinoPageTransitionsBuilder(),
        duration: Duration(milliseconds: 500),
        cupertinoRoute: true,
      );
    case 'fjs-zoom':
      return const FjsTransitionSpec(
        builder: ZoomPageTransitionsBuilder(),
        duration: Duration(milliseconds: 280),
      );
    case 'fjs-fade':
      return const FjsTransitionSpec(
        builder: FjsFadeTransitionsBuilder(),
        duration: Duration(milliseconds: 280),
      );
    case 'fjs-slide-up':
      return const FjsTransitionSpec(
        builder: FjsSlideUpTransitionsBuilder(),
        duration: Duration(milliseconds: 280),
      );
    default:
      return null;
  }
}

/// Route builder for a name from the JS side, or null when the name has no
/// native animation. Prefer [fjsTransitionSpec] when route duration matters.
PageTransitionsBuilder? fjsTransitionBuilder(String name) {
  return fjsTransitionSpec(name)?.builder;
}

/// Cross-fade, no movement. The leaving page stays put and fades under it,
/// which is what the CSS family does.
class FjsFadeTransitionsBuilder extends PageTransitionsBuilder {
  const FjsFadeTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T>? route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    return FadeTransition(
      opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
      child: child,
    );
  }
}

/// Up from the bottom — a modal / sheet-like page. Going back it drops
/// straight down again; the page underneath does not move.
class FjsSlideUpTransitionsBuilder extends PageTransitionsBuilder {
  const FjsSlideUpTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T>? route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    return SlideTransition(
      position: Tween<Offset>(begin: const Offset(0, 1), end: Offset.zero)
          .animate(
            CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
              reverseCurve: Curves.easeInCubic,
            ),
          ),
      child: child,
    );
  }
}
