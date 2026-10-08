// liquidglass — Liquid Glass as one fjs tag plus switchable tab bar styles.
//
//   <glass-surface :radius="26" :blur="20" :refraction="0.6" />
//
// The tag is a LEAF glass layer (position it absolutely under your content);
// see flutter/lib/fjs_liquidglass.dart for why it is not a container. The
// painting differs per target — Flutter runs the liquid_glass_widgets shader,
// the browser uses backdrop-filter plus an SVG displacement map — but the
// parameters are the same, so a page is written once.
//
// Tab bar styles are a name → component table. A style is any Vue component
// that takes the global tab bar's props (specs/210: `tabs`, `active`) and
// emits `select(path)`; the app decides which one to mount. The table lives
// here and not in the runtime's `tabBar` option on purpose: that option's
// contract is fixed by specs/210, and an app-level dispatcher already covers
// switching.
import type { Component } from 'vue';
import GlassTabBar from './components/GlassTabBar.vue';

/** What every tab bar style component receives. `tabs` / `active` come from
 * the framework (specs/210); the rest is what the app's dispatcher adds. */
export interface TabBarStyleProps {
  /** The route table's tab pages, in `meta.tab` order. */
  tabs: { path: string; title: string; tab: number }[];
  /** The current tab page's `meta.tab`; null off the tab group. */
  active: number | null;
  /** Light/dark appearance. */
  dark?: boolean;
}

const styles = new Map<string, Component>();
const warned = new Set<string>();

function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[liquidglass] ${msg}`);
}

/** The style a request falls back to when its name is unknown. */
export const DEFAULT_TAB_BAR_STYLE = 'liquid-glass';

/** Registers (or replaces) a tab bar style. */
export function registerTabBarStyle(name: string, component: Component): void {
  styles.set(name, component);
}

/** Looks a style up. An unknown name warns once and answers with the
 * default style — a missing style should be visible, not a blank bar
 * (constitution V). Returns undefined only if even the default is gone. */
export function getTabBarStyle(name: string): Component | undefined {
  const hit = styles.get(name);
  if (hit) return hit;
  warnOnce(`unknown tab bar style "${name}", using "${DEFAULT_TAB_BAR_STYLE}"`);
  return styles.get(DEFAULT_TAB_BAR_STYLE);
}

/** Registered style names, in registration order. */
export function tabBarStyleNames(): string[] {
  return [...styles.keys()];
}

registerTabBarStyle(DEFAULT_TAB_BAR_STYLE, GlassTabBar);

export { GlassTabBar };

export { sliderLeftPercent } from './slider';
