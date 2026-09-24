// specs/104: the Flutter renderer decides a handler's first argument from
// event-emits.ts, a hand-kept copy of what each web component emits. This
// pins the copy to the real `emits` so the two ends cannot drift silently —
// add or drop an event on a web component and this fails until the table
// follows.
import { describe, expect, it } from 'vitest';
import { fjsComponents } from '../src/web/components';
import { WEB_EMITS, emitsFor } from '../src/event-emits';

function declaredEmits(component: unknown): string[] {
  const emits = (component as { emits?: string[] | Record<string, unknown> }).emits;
  if (!emits) return [];
  return Array.isArray(emits) ? emits : Object.keys(emits);
}

describe('WEB_EMITS (specs/104)', () => {
  it.each(Object.entries(fjsComponents))('%s matches its web component', (tag, component) => {
    expect([...(WEB_EMITS[tag] ?? [])].sort()).toEqual(declaredEmits(component).sort());
  });

  it('lists only tags that have a web component', () => {
    for (const tag of Object.keys(WEB_EMITS)) expect(fjsComponents).toHaveProperty([tag]);
  });

  it('matches names case-insensitively and knows nothing about non-fjs tags', () => {
    expect(emitsFor('scroll-view').has('scrolltoupper')).toBe(true);
    expect(emitsFor('view').has('longpress')).toBe(true);
    expect(emitsFor('view').has('click')).toBe(false);
    expect(emitsFor('div').size).toBe(0);
  });
});
