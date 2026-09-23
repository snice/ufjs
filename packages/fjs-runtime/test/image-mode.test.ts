import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_MODES,
  resolveImageMode,
} from '../src/image/mode';

describe('image mode', () => {
  it('covers the 14 uni-app mode names', () => {
    expect(IMAGE_MODES).toHaveLength(14);
    for (const mode of IMAGE_MODES) {
      expect(resolveImageMode(mode, undefined).mode).toBe(mode);
    }
  });

  it('uses mode before the legacy fit prop', () => {
    expect(resolveImageMode('aspectFit', 'cover')).toMatchObject({
      mode: 'aspectFit',
      objectFit: 'contain',
      objectPosition: 'center',
    });
  });

  it('keeps the old fit behavior when mode is absent', () => {
    expect(resolveImageMode(undefined, 'contain')).toMatchObject({
      objectFit: 'contain',
      objectPosition: 'center',
    });
    expect(resolveImageMode(undefined, 'fill').objectFit).toBe('fill');
  });

  it('defaults to scaleToFill and warns for an unknown mode', () => {
    const warnings: string[] = [];
    expect(resolveImageMode('diagonal', undefined, (message) => {
      warnings.push(message);
    })).toMatchObject({
      mode: 'scaleToFill',
      objectFit: 'fill',
    });
    expect(warnings).toEqual([
      'image received unsupported mode="diagonal"; using "scaleToFill".',
    ]);
  });

  it('maps directional modes to object positions', () => {
    expect(resolveImageMode('top left', undefined).objectPosition).toBe(
      'left top',
    );
    expect(resolveImageMode('bottom right', undefined).objectPosition).toBe(
      'right bottom',
    );
    expect(resolveImageMode('widthFix', undefined).fix).toBe('width');
    expect(resolveImageMode('heightFix', undefined).fix).toBe('height');
  });

  it('treats the nine positional modes as 1:1 crop windows (specs/102)', () => {
    // WeChat never scales these — it opens a natural-size window at the
    // named position. Cover+position was the old mapping and it measured
    // MAD 47-71 away from dist/mp on the same page.
    const positional = [
      'top',
      'bottom',
      'center',
      'left',
      'right',
      'top left',
      'top right',
      'bottom left',
      'bottom right',
    ];
    for (const mode of positional) {
      expect(resolveImageMode(mode, undefined).objectFit, mode).toBe('none');
    }
    // the five scaling modes keep their fits
    expect(resolveImageMode('scaleToFill', undefined).objectFit).toBe('fill');
    expect(resolveImageMode('aspectFit', undefined).objectFit).toBe('contain');
    expect(resolveImageMode('aspectFill', undefined).objectFit).toBe('cover');
    // the legacy fit prop is unchanged and has no `none` spelling
    expect(resolveImageMode(undefined, 'cover').objectFit).toBe('cover');
  });
});
