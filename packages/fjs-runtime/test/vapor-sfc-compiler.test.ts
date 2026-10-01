// compileVaporSfc edge shapes (specs/168).
import { describe, expect, it } from 'vitest';
import { compileVaporSfc } from '../src/vapor/sfc-compiler';

const opts = { file: 'a.vue', id: 'data-v-1', web: false, moduleTags: new Set<string>() };

describe('compileVaporSfc', () => {
  // compiler-sfc drops a whitespace-only script block by default; the vapor
  // flag lives on it, so the page used to fall to the auto-vapor re-parse
  // and fail with "Duplicate attribute."
  it('compiles an SFC whose <script setup vapor> is empty', () => {
    for (const script of ['<script setup vapor>\n</script>', '<script setup vapor></script>']) {
      const res = compileVaporSfc(`${script}\n<template><text class="named">named</text></template>\n`, opts);
      if ('errors' in res) throw new Error(res.errors.map((e) => e.text).join('\n'));
      expect(res.code).toContain('__sfc__.__vapor = true');
      expect(res.code).toContain('named');
    }
  });

  it('still compiles a non-empty <script setup vapor>', () => {
    const res = compileVaporSfc(
      '<script setup vapor>\nconst a = 1\n</script>\n<template><text>{{ a }}</text></template>\n',
      opts,
    );
    expect('errors' in res).toBe(false);
  });
});
