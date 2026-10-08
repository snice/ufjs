import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import {
  DEFAULT_TAB_BAR_STYLE,
  GlassTabBar,
  getTabBarStyle,
  registerTabBarStyle,
  sliderLeftPercent,
  tabBarStyleNames,
} from '../index';

const Dummy = defineComponent({ render: () => null });

afterEach(() => vi.restoreAllMocks());

describe('tab bar style registry', () => {
  it('ships liquid-glass as the default style', () => {
    expect(tabBarStyleNames()).toContain(DEFAULT_TAB_BAR_STYLE);
    expect(getTabBarStyle(DEFAULT_TAB_BAR_STYLE)).toBe(GlassTabBar);
  });

  it('registers and replaces a style by name', () => {
    registerTabBarStyle('mine', Dummy);
    expect(getTabBarStyle('mine')).toBe(Dummy);
    const Other = defineComponent({ render: () => null });
    registerTabBarStyle('mine', Other);
    expect(getTabBarStyle('mine')).toBe(Other);
    expect(tabBarStyleNames().filter((n) => n === 'mine')).toHaveLength(1);
  });

  it('falls back to the default for an unknown name and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getTabBarStyle('nope')).toBe(GlassTabBar);
    expect(getTabBarStyle('nope')).toBe(GlassTabBar);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('nope');
  });
});

describe('sliderLeftPercent', () => {
  it('places the slider at active/count of the track', () => {
    expect(sliderLeftPercent(0, 4)).toBe(0);
    expect(sliderLeftPercent(2, 4)).toBe(50);
    expect(sliderLeftPercent(3, 4)).toBe(75);
  });

  it('stays at 0 off the tab group or with no tabs', () => {
    expect(sliderLeftPercent(null, 4)).toBe(0);
    expect(sliderLeftPercent(1, 0)).toBe(0);
  });

  it('clamps an out-of-range index into the track', () => {
    expect(sliderLeftPercent(9, 4)).toBe(75);
    expect(sliderLeftPercent(-1, 4)).toBe(0);
  });
});
