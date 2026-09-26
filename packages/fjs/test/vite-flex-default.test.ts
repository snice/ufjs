// specs/140: the Vite plugin's CSS entry points. SFC <style> blocks get the
// whole fjs rewrite (dialect + flex-direction default); plain .css imports —
// a library's dist styles — get only the flex default, never the dialect
// passes (a bare number in standard CSS is not a px length).
import { describe, expect, it } from 'vitest';
import { compileStyle } from '@vue/compiler-sfc';
import { fjs } from '../src/vite';

const plugin = fjs();
const FILL = '@layer fjs-flex{.nut-cell{flex-direction:row;align-items:stretch}}';

describe('vite plugin: flex-direction default', () => {
  it('rewrites library and project .css imports, flex default only', () => {
    const css = '.nut-cell { display: flex; line-height: 1; z-index: 2; padding: 4 }';
    for (const id of [
      '/p/node_modules/@nutui/nutui/dist/packages/cell/index.css',
      '/p/src/styles.css?used',
    ]) {
      const out = plugin.transform(css, id);
      expect(out).toContain(FILL);
      expect(out).toContain('padding: 4 }'); // no dialect pass on plain CSS
    }
  });

  it('leaves ?raw / ?url imports and non-css files alone', () => {
    const css = '.nut-cell { display: flex }';
    expect(plugin.transform(css, '/p/a.css?raw')).toBeNull();
    expect(plugin.transform(css, '/p/a.css?url')).toBeNull();
    expect(plugin.transform(css, '/p/a.scss')).toBeNull();
  });

  it('SFC blocks: full rewrite for css, no flex scan for scss', () => {
    const block = '.nut-cell { display: flex; padding: 4 }';
    const cssOut = plugin.transform(block, '/p/A.vue?vue&type=style&index=0&lang.css');
    expect(cssOut).toContain(FILL);
    expect(cssOut).toContain('padding: 4px');
    const scssOut = plugin.transform(block, '/p/A.vue?vue&type=style&index=0&lang.scss');
    expect(scssOut).not.toContain('@layer');
    expect(scssOut).toContain('padding: 4px');
  });

  it('scoped styles scope the layered rule too', () => {
    const pre = plugin.transform('.nut-cell { display: flex }', '/p/A.vue?vue&type=style&index=0&scoped=abc&lang.css')!;
    const { code, errors } = compileStyle({ source: pre, filename: 'A.vue', id: 'data-v-abc', scoped: true });
    expect(errors).toEqual([]);
    expect(code).toMatch(/@layer fjs-flex\s*\{\s*\.nut-cell\[data-v-abc\]\s*\{/);
  });
});
