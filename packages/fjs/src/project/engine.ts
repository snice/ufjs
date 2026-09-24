// JS engine flavor selection (spec 091, reshaped by spec 105).
//
// The flutter_fjs package ships BOTH engines prebuilt under abi/ and the
// platform builds pick one themselves: android/build.gradle and the
// podspecs read FJS_JS_ENGINE (environment first, then the host's
// --dart-define). This module resolves the flavor, exports it into the
// environment every later `flutter` child inherits, and runs the package's
// Dart runner (bin/engine.dart) for the two things a build file cannot do
// on its own: copy the flavor into ohos/libs (HARs only package libs/) and
// make the HOST re-run pod install after a switch. `dart run` resolves
// flutter_fjs through the host's package_config, so pure Flutter hosts run
// the very same command:
//
//   dart run flutter_fjs:engine quickjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export type JsEngine = 'primjs' | 'quickjs';

const ENGINES: JsEngine[] = ['primjs', 'quickjs'];

/** Engine id each flavor bakes into .fjsbundle headers (fjs_engine_id()). */
export const ENGINE_IDS: Record<JsEngine, string> = {
  primjs: 'primjs-4.1.1',
  quickjs: 'quickjs-ng-0.9.0',
};

/** --js-engine value, falling back to FJS_JS_ENGINE, then the default.
 * An explicit but unknown value throws with the accepted list. */
export function resolveJsEngine(explicit?: string): JsEngine {
  const raw = explicit ?? process.env.FJS_JS_ENGINE;
  if (!raw) return 'primjs';
  if ((ENGINES as string[]).includes(raw)) return raw as JsEngine;
  throw new Error(`unknown js engine '${raw}' — expected one of: ${ENGINES.join(', ')}`);
}

/** Selects [engine] for the Flutter build that follows. Sets
 * `FJS_JS_ENGINE` in this process's environment (the gradle file and the
 * podspecs read it; every `flutter` spawned afterwards inherits it), then
 * runs the flutter_fjs engine runner from [flutterDir] (see the header).
 *
 * The runner is not optional for a non-default flavor — ohos libs and the
 * host's pods depend on it — so a missing `dart` or a failing runner throws
 * then. For the default flavor android/ios/macos need nothing from it, so
 * the failure is reported once and the command goes on; it is never
 * silent, because the next build may still carry a previous switch.
 * `debugger` is accepted for the callers' sake and has no effect since
 * spec 105: release builds leave the debugger out at the build layer. */
export function materializeJsEngine(
  engine: JsEngine,
  opts: {
    flutterDir?: string;
    explicit?: boolean;
    debugger?: boolean;
    /** test seam */
    spawn?: typeof spawnSync;
    /** test seam */
    warn?: (line: string) => void;
  } = {},
): void {
  process.env.FJS_JS_ENGINE = engine;
  const cwd = opts.flutterDir ? path.resolve(opts.flutterDir) : process.cwd();
  const spawn = opts.spawn ?? spawnSync;
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  const r = spawn('dart', ['run', 'flutter_fjs:engine', engine, '--host', cwd], {
    cwd,
    stdio: 'pipe',
  });
  const tolerable = engine === 'primjs' && !opts.explicit;
  if (r.error) {
    const why =
      `cannot run 'dart' (${r.error.message}) — the engine runner ships inside ` +
      'flutter_fjs and needs the Dart SDK on PATH';
    if (tolerable) {
      warn(
        `fjs: engine runner skipped — ${why}. android/ios/macos still build primjs; ` +
          'an ohos host or a host switched away from primjs earlier needs the runner.',
      );
      return;
    }
    throw new Error(`--js-engine ${engine}: ${why}`);
  }
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) {
    if (tolerable) {
      warn(`fjs: engine runner failed — ${out.trim().split('\n')[0] ?? 'no output'}`);
      return;
    }
    throw new Error(`fjs engine runner failed:\n${out}`);
  }
  // the runner's own line may share stdout with dart's build-hook chatter
  const line = out.match(/fjs: engine flavor[^\r\n]*/)?.[0];
  if (line) console.log(line);
}
