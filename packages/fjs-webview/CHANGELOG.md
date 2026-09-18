# @ufjs/webview

## 0.1.4

- Packaging fix: `files` used to allowlist the whole `flutter/` directory, and
  npm's `files` list overrides `.gitignore` — so the first `flutter test` run
  in this directory leaked `build/`, `.dart_tool/`, `pubspec.lock` and
  `.flutter-plugins*` into the published tarball (45 MB in @ufjs/webview
  0.1.3). Only `flutter/lib` and `flutter/pubspec.yaml` ship now.
- `flutter_fjs` constraint bumped to `^0.1.4`.

## 0.1.3

- First release. `<web-view>` is one tag: a platform WebView on the app
  (`webview_flutter`) and an iframe on the web, with the same `src`, navigation
  and message props on both. Version 0.1.3 to line up with the rest of the fjs
  packages; nothing before it was published.
- A `<web-view>` nested inside a `<scroll-view>` keeps its own gestures: the
  page scrolls under the finger instead of the outer scroller stealing the
  drag.
- `src` accepts an app-owned page from the project's `html/` directory
  (`/html/guide.html`), alongside http URLs and the `asset://` files a module
  ships. Requires `@ufjs/cli` >= 0.1.3, which serves and bundles that
  directory.
- The module no longer writes a second copy of its files into the app's
  `public/fjs-modules/`. `.fjs/modules/<name>/` is the only copy; the
  `/fjs-modules/<name>/<file>` URL contract is unchanged.
- The Flutter tests actually compile now — a missing
  `package:flutter/gestures.dart` import meant `flutter test` reported the file
  as a failed "loading …" and the suite had never run.

## Requirements

- `@ufjs/cli` >= 0.1.3 and `flutter_fjs` >= 0.1.3.
