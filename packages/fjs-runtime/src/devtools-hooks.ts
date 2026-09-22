// DevTools plumbing slots (spec 090). The only piece of the devtools data
// plane that lives in EVERY build: call sites (element.ts / renderer.ts /
// net/fetch.ts) poke these optional hooks, and — in dev / `--devtools`
// builds only — src/devtools.ts installs real implementations plus the
// `__fjsDevtools` global the `fjs debug` relay evaluates.
//
// Why a slots module instead of importing devtools.ts directly: a static
// import would pull the whole data plane into release bundles. With slots,
// release never references devtools.ts, the esbuild define
// `__FJS_DEVTOOLS__=false` drops the boot call, and the recording cost in
// production is one falsy check per op.

// Build-time define injected by the fjs bundler (spec 090). Declared here
// because this module is transitively included by every consumer tsconfig.
declare const __FJS_DEVTOOLS__: boolean;

export interface DevtoolsNode {
  id: number;
  tag: string;
  attrs: Record<string, string>;
  /** text content for text-bearing nodes, when recorded */
  text?: string;
  children: DevtoolsNode[];
}

export interface DevtoolsTreeProvider {
  roots(): number[];
  tag(id: number): string;
  childIds(id: number): number[];
  exists(id: number): boolean;
  classesOf(id: number): string[];
  inlineStyle(id: number): Record<string, unknown> | undefined;
  computedStyle(id: number): Record<string, unknown> | undefined;
  /** Rules that currently match the element, for the Styles panel's matched
   * list (spec 092). Optional so a provider built before this landed keeps
   * working; the panel then just shows no matched rules. */
  matchedRules?(id: number): Array<{ selectors: string[]; matched: number[]; decls: Record<string, unknown> }>;
}

export interface DevtoolsNetBody {
  base64?: string;
  size: number;
  truncated: boolean;
}

export interface DevtoolsNetRow {
  id: number;
  state: 'pending' | 'done';
  request?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyBase64?: string;
  };
  response?: {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
  };
  body?: DevtoolsNetBody;
}

export interface DevtoolsSlots {
  /** The Vue renderer's shadow tree, for Elements serialization. */
  provider: DevtoolsTreeProvider | null;
  recordProps(id: number, clean: Record<string, unknown>): void;
  recordText(id: number, text: string): void;
  netRequest(row: {
    id: number;
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyBase64?: string;
  }): void;
  netResponse(row: {
    id: number;
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyBase64?: string;
    handle: number | null;
  }): void;
  netBodyMaterialized(handle: number, bytes: Uint8Array): void;
}

/** All no-op until `fjs/devtools` (dev / `--devtools` builds) installs. */
export const devtoolsSlots: DevtoolsSlots = {
  provider: null,
  recordProps: () => {},
  recordText: () => {},
  netRequest: () => {},
  netResponse: () => {},
  netBodyMaterialized: () => {},
};

/** Bumped once per UI frame that actually goes out (host.ts flushNow), not
 * per op — exposed as `__fjsDevtools.cmd('Dom.version')` for tooling that
 * wants to know whether the tree is moving (spec 092). */
export const devtoolsTreeVersion = { value: 0 };

/** STRUCTURE only: bumped on element insert/remove and page-root add/remove
 * (spec 093 方案 A). The relay polls this at a low frequency and pushes
 * DOM.documentUpdated only when it changes — pure attribute / text / style
 * mutations must NOT move it, or a busy app would re-pull the whole document
 * on every frame (spec 092 R14 regression, measured with the real DevTools
 * frontend: the Styles sidebar spun forever). */
export const devtoolsStructuralVersion = { value: 0 };
