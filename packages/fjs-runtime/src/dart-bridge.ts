// The JS-facing half of the structured object ABI (spec 159).
//
// `dartModule(name)` hands out the named Dart object module as an ES Proxy:
// every property read yields a constructor function, and calling it builds
// a Dart object through the native objectCall channel. What comes back is a
// native proxy (class "DartObject") whose members dispatch to the owning
// Dart adapter — fields consult it, methods are bound functions. See
// docs/modules.md for the Dart-side SPI (FjsObjectModule).
//
// The web has no engine, so the same business code runs against a TS stub
// implementation the module package (or the app) registers here — the same
// shape as an iconmind-style web stand-in. Missing native support AND
// missing stub is a warnOnce + throw (constitution V): a silently-undefined
// module would surface pages later as inexplicable no-ops.
import { hasNativeHost, host } from './host';

const stubs = new Map<string, unknown>();
const warned = new Set<string>();
const ctorCache = new Map<string, Map<string, unknown>>();

function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  // eslint-disable-next-line no-console -- the runtime's own warning channel
  console.warn(`[fjs] ${msg}`);
}

/** Registers a TS implementation for `dartModule(name)` on engines that
 * have none (the web). Registering after the module was already handed out
 * does not retroactively replace cached constructors — register at app
 * startup, before any page evaluates. */
export function registerDartModuleStub<T>(name: string, stub: T): void {
  stubs.set(name, stub);
  ctorCache.delete(`stub:${name}`);
}

export function hasDartModuleStub(name: string): boolean {
  return stubs.has(name);
}

/** The augmentation point for generated object-module types (spec 160):
 * `fjs autoimport` / module packages emit
 * `declare module '@ufjs/runtime' { interface FjsObjectModules { mmkv: … } }`
 * and `dartModule('mmkv')` picks the entry up by key — the same
 * declaration-merging trick `@ufjs/iconmind` uses for icon names. Without
 * any augmentation the key-name overload never matches and the plain
 * `<T>(name: string)` overload applies. */
export interface FjsObjectModules {}

/** True when this engine can serve Dart object modules at all: the host
 * knows the rich channel (FJS_ABI_VERSION 3, spec 159). */
export function hasDartObjectSupport(): boolean {
  return hasNativeHost && typeof host?.objectCall === 'function';
}

/** The named Dart object module. Members become constructor calls:
 *
 *   const m = dartModule('mmkv');
 *   const kv = m.MMKV();       // constructs a Dart object, returns a proxy
 *   kv.encodeString('k', 'v'); // method -> Dart
 *   kv.decodeString('k');      // a Dart `String?` answer is `string | null`
 *
 * With generated types on the program (spec 160) the name is checked
 * against `FjsObjectModules` and the return type comes from the generated
 * interface. On a host without object-ABI support the named TS stub is
 * returned instead; with neither, this throws after warning once. */
export function dartModule<M extends keyof FjsObjectModules>(
  name: M & string,
): FjsObjectModules[M];
export function dartModule<T = unknown>(name: string): T;
export function dartModule(name: string): unknown {
  const objectCall = host?.objectCall;
  if (objectCall) {
    let ctors = ctorCache.get(name);
    if (!ctors) {
      ctors = new Map();
      ctorCache.set(name, ctors);
    }
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== 'string') return undefined;
          let ctor = ctors!.get(prop);
          if (!ctor) {
            ctor = (...args: unknown[]) =>
              objectCall('construct', name, prop, ...(args as never[]));
            ctors!.set(prop, ctor);
          }
          return ctor;
        },
      },
    );
  }

  const stub = stubs.get(name);
  if (stub !== undefined) return stub;

  warnOnce(
    `dart-module:${name}`,
    `dartModule("${name}") has no implementation here — ` +
      (hasNativeHost
        ? 'this engine predates the object ABI (v3); '
        : 'the web build needs a TS stub registered via ' +
          `registerDartModuleStub("${name}", ...); `) +
      'throwing instead of handing out a dead module',
  );
  throw new Error(`[fjs] dartModule("${name}") is unavailable in this build`);
}
