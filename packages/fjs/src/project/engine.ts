// JS engine flavor selection (spec 091).
//
// The flutter_fjs package ships BOTH engines prebuilt, cached side by side
// under packages/flutter_fjs/abi/, and ships the materializer itself as a
// Dart executable (bin/engine.dart). This module only resolves the requested
// flavor and shells out to that runner from the host project — `dart run`
// resolves flutter_fjs through the host's own package_config, so there is
// exactly one copy implementation, usable verbatim by pure Flutter hosts:
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

/** Runs the flutter_fjs engine runner from [flutterDir] (the host project —
 * `dart run` resolves the flutter_fjs executable through the host's
 * package_config, which is what makes the same command work for pure
 * Flutter hosts). Idempotent: an already-materialized flavor is a no-op. */
export function materializeJsEngine(
  engine: JsEngine,
  opts: { flutterDir?: string; explicit?: boolean } = {},
): void {
  const cwd = opts.flutterDir ? path.resolve(opts.flutterDir) : process.cwd();
  const r = spawnSync('dart', ['run', 'flutter_fjs:engine', engine, '--host', cwd], {
    cwd,
    stdio: 'pipe',
  });
  if (r.error) {
    // no `dart` on PATH: the default flavor needs nothing (committed state
    // is primjs), an explicit request must fail loudly instead of silently
    // running the wrong engine
    if (engine === 'primjs' && !opts.explicit) return;
    throw new Error(
      `--js-engine ${engine}: cannot run 'dart' (${r.error.message}) — the engine ` +
        'runner ships inside flutter_fjs and needs the Dart SDK on PATH',
    );
  }
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) {
    // a failed DEFAULT (primjs) request must not take the command down —
    // the committed state already is primjs — but say why, loudly
    if (engine === 'primjs' && !opts.explicit) {
      console.warn(
        `fjs: engine materialization skipped — ${out.trim().split('\n')[0] ?? 'runner failed'}`,
      );
      return;
    }
    throw new Error(`fjs engine runner failed:\n${out}`);
  }
  // the runner's own line may share stdout with dart's build-hook chatter
  const line = out.match(/fjs: (?:materialized|engine flavor)[^\r\n]*/)?.[0];
  if (line) console.log(line);
}
