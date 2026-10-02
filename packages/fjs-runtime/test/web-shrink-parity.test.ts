// specs/180: the roots the web components render keep their natural size in
// a flex column (Flutter never shrinks a Column child). Asserted on the rule
// text: happy-dom does not evaluate :where(), the zero-specificity wrapper
// that lets a page's own flex rule win (checked in a real browser).
import { describe, expect, it } from 'vitest';
import { BASE_CSS } from '../src/web/base-css';

const ROOTS = [
  '.fjs-image', '.fjs-button', '.fjs-input', '.fjs-swiper', '.fjs-slider', '.fjs-picker-view',
  'divider', 'radio-group', 'checkbox-group', 'label', 'form', 'stack',
];

describe('web component roots do not shrink (specs/180)', () => {
  it('one zero-specificity rule covers every component root', () => {
    const m = /:where\(([^)]*)\)\s*\{\s*flex-shrink:\s*0;\s*\}/.exec(BASE_CSS);
    expect(m, 'the :where(...) { flex-shrink: 0 } rule').not.toBeNull();
    const selectors = m![1].split(',').map((s) => s.trim());
    for (const root of ROOTS) expect(selectors, root).toContain(root);
  });
});
