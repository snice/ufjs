// File-based routing: the conventions in pages.ts are what `fjs create
// page` prints, what the router receives and what the split build names its
// chunks, so a change in any of them is a change in all three.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  pagesFor,
  routeTableSource,
  routeTypesSource,
  scanPages,
  writeRouteTypes,
  ROUTE_TYPES_FILE,
} from '../src/project/pages.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-pages-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function page(rel: string, source = '<template><view /></template>\n'): void {
  const full = path.join(root, 'src', 'pages', rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, source);
}

describe('scanPages', () => {
  it('derives paths, names and chunks from the file names', () => {
    page('index.vue');
    page('about.vue');
    page('comp/Button.vue');
    page('user/[id].vue');
    page('[...rest].vue');

    const byName = Object.fromEntries(scanPages(root).map((p) => [p.name, p]));
    expect(byName.index.path).toBe('/');
    expect(byName.about.path).toBe('/about');
    // nested and camelCase segments are kebab-cased
    expect(byName['comp-button'].path).toBe('/comp/button');
    expect(byName['comp-button'].chunk).toBe('comp-button');
    // dynamic segments: the name keeps the bare param, the path gets ':'
    expect(byName['user-id'].path).toBe('/user/:id');
    expect(byName.rest.path).toBe('/*');
  });

  it('reads the <route> block: overrides go to the route, the rest to meta', () => {
    page(
      'settings.vue',
      '<route>\n{"path": "/prefs", "name": "prefs", "title": "设置", "tab": 2}\n</route>\n' +
        '<template><view /></template>\n',
    );

    const [route] = scanPages(root);
    expect(route.path).toBe('/prefs');
    expect(route.name).toBe('prefs');
    expect(route.meta).toEqual({ title: '设置', tab: 2 });
  });

  it('says which JSON is broken instead of failing later', () => {
    page('bad.vue', '<route>\n{ nope }\n</route>\n<template><view /></template>\n');
    expect(() => scanPages(root)).toThrow(/<route> block is not valid JSON/);
  });

  it('restricts a page to one target, by suffix or by block', () => {
    page('native.app.vue');
    page('browser.web.vue');
    page(
      'both.vue',
      '<route>\n{"platforms": ["web"]}\n</route>\n<template><view /></template>\n',
    );

    expect(pagesFor(root, 'app').map((p) => p.name)).toEqual(['native']);
    expect(pagesFor(root, 'web').map((p) => p.name).sort()).toEqual(['both', 'browser']);
  });
});

describe('routeTableSource', () => {
  it('bundles every page for a single Flutter bundle, run on first open', () => {
    page('index.vue');
    const source = routeTableSource(scanPages(root), 'app', true);
    expect(source).toContain("import { definePageLoader } from 'fjs/router'");
    // require(), not a static import: the page must not run before the
    // app's plugins do (specs/121)
    expect(source).toMatch(/definePageLoader\("\/", \(\) => require\(".*index\.vue"\)\.default\)/);
    expect(source).not.toMatch(/^import .*index\.vue/m);
  });

  it('names chunks for a split build and imports lazily on web', () => {
    page('about.vue');
    expect(routeTableSource(scanPages(root), 'app', false)).toContain('chunk: "about"');
    expect(routeTableSource(scanPages(root), 'web', false)).toContain('component: () => import(');
  });
});

describe('writeRouteTypes', () => {
  it('writes the name -> path table, and only when it changes', () => {
    page('about.vue');
    writeRouteTypes(root);
    const file = path.join(root, ROUTE_TYPES_FILE);
    expect(fs.readFileSync(file, 'utf8')).toBe(routeTypesSource(scanPages(root)));

    // the dev server watches this file: rewriting it unchanged would loop
    const before = fs.statSync(file).mtimeMs;
    writeRouteTypes(root);
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it('leaves a project with no pages alone', () => {
    writeRouteTypes(root);
    expect(fs.existsSync(path.join(root, ROUTE_TYPES_FILE))).toBe(false);
  });
});
