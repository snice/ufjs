// specs/184: a pure-vapor app's non-release shared chunk exports every name
// of 'vue' / runtime-core / fjs/vapor but the VDOM renderer's.
import { describe, expect, it } from 'vitest';
import { PURE_VAPOR_UNSHARED, pureVaporSharedNames, sharedEntrySource } from '../src/bundler/build';
import { flutterAliases, SHARED_BARE_BUILTIN, vuePinPlugin } from '../src/bundler/vue-plugin';

describe('pure-vapor dev shared names (specs/184)', () => {
  it('narrows the runtime-core carriers, keeps everything else whole', async () => {
    const names = await pureVaporSharedNames([...SHARED_BARE_BUILTIN, 'fjs/vapor'], flutterAliases(true, false), [vuePinPlugin()]);
    for (const spec of ['vue', '@vue/runtime-core', 'fjs/vapor']) {
      const set = names.get(spec);
      expect(set, spec).toBeInstanceOf(Set);
      for (const n of ['ref', 'watch', 'nextTick', 'computed']) expect((set as Set<string>).has(n), `${spec}.${n}`).toBe(true);
      for (const n of PURE_VAPOR_UNSHARED) expect((set as Set<string>).has(n), `${spec}.${n}`).toBe(false);
    }
    expect((names.get('fjs/vapor') as Set<string>).has('createVaporApp')).toBe(true);
    expect(names.get('@vue/reactivity')).toBe('*');
    expect(names.get('fjs/router')).toBe('*');

    const src = sharedEntrySource(new Map(), ['fjs/vapor'], [], names);
    expect(src).toContain('import * as reactivity from "@vue/reactivity"');
    expect(src).not.toMatch(/\\bcreateRenderer\\b/);
  }, 30000);
});
