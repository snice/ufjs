// v-for lists are projected to the properties the template reads (spec 061):
// everything else would still cross the setData bridge AND still count as a
// change, so an animation writing `dot.scale` re-sent all 25 dots per frame.
import { describe, expect, it } from 'vitest';

import { project } from '../src/wx/style';

describe('project', () => {
  it('keeps only the properties the template reads, so the list stops changing', () => {
    const dots = [
      { id: 0, scale: 1, color: '#007aff' },
      { id: 1, scale: 1, color: '#07c160' },
    ];
    const a = project(dots, ['id']);
    dots[0].scale = 0.25; // an animation tick
    expect(project(dots, ['id'])).toEqual(a);
    expect(a).toEqual([{ id: 0 }, { id: 1 }]);
  });

  it('passes through a non-array list and primitive items', () => {
    expect(project(3, ['id'])).toBe(3);
    expect(project({ a: 1 }, ['id'])).toEqual({ a: 1 });
    expect(project(['a', 'b'], ['id'])).toEqual(['a', 'b']);
  });

  it('reads a missing property as undefined, not as the whole item', () => {
    expect(project([{ a: 1 }], ['b'])).toEqual([{ b: undefined }]);
  });
});
