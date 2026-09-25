/// JS/TS runtime for Flutter: QuickJS-ng embedded via FFI, JS UI tags
/// rendered as a mirror tree of Flutter widgets.
///
/// See docs/architecture.md for the layering. Entry points:
///   * [FjsEngine]         — the JS engine host (runSource / runBundle / dev)
///   * [FjsView]           — widget that renders the JS UI tree
///   * [FjsApp]            — Navigator driven by the JS router (native routes)
///   * [HostRegistry]      — Dart-side host modules callable from JS
///   * [ComponentRegistry] — Dart widgets rendered for JS tags
library flutter_fjs;

export 'src/bytes.dart' show FjsByteData;
export 'src/engine.dart' show FjsEngine, FjsException, NavEntry;
// event ids for FjsEngine.dispatchEvent (hosts that inject events by hand)
export 'src/ffi.dart' show FjsEvent;
export 'src/fjs_app.dart' show FjsApp, FjsTransitionPage;
// the named page transitions (`transition: 'fjs-fade'` on the JS side), for
// a host that wants to place one by hand
export 'src/transitions.dart'
    show
        fjsTransitionSpec,
        fjsTransitionBuilder,
        FjsTransitionSpec,
        FjsFadeTransitionsBuilder,
        FjsSlideUpTransitionsBuilder;
export 'src/fjs_view.dart' show FjsView;
// the dev perf monitor. FjsApp installs one; a host that places FjsView by
// hand wraps it in this to get the same panel.
export 'src/widgets/perf_overlay.dart' show FjsPerfOverlay;
export 'src/widgets/route_anchor.dart' show FjsRouteAnchor;
export 'src/log.dart' show FjsLogLevel;
export 'src/ui_ops.dart' show UiOpCode;
export 'src/registry/host.dart' show HostRegistry, HostResult;
export 'src/registry/component.dart' show ComponentRegistry, ComponentBuilder;
// the node a ComponentBuilder is handed: props, text and children ids. Part
// of the public surface because writing a builder means reading it.
export 'src/canvas/canvas_module.dart'
    show
        canvasDisplayOverride,
        canvasReadback,
        canvasNodeDisposed,
        FjsCanvasDisplayOverride,
        FjsCanvasReadback,
        FjsCanvasNodeDisposed;
export 'src/canvas/canvas_ops.dart' show CanvasChunkReader, CanvasOpException;
export 'src/canvas/images.dart' show FjsCanvasImages;
export 'src/mirror_tree.dart' show MirrorNode;
// how the widget layer itself reads a CSS color, for builders that read one
// off a node: every notation the style engine may send (#hex, rgb()/rgba(),
// hsl()/hsla(), the named colors), memoized, so a module and a built-in tag
// resolve `color: red` to the same Color.
export 'src/render/style_parse.dart' show parseColor;
export 'src/worker.dart' show FjsWorker;
