// Build-time preparation for `fjs mcp` / `fjs ai init` (specs/213). Runs as
// the first half of `pnpm --filter @ufjs/cli run build`, before esbuild.
//
// Two jobs, both about keeping shipped artifacts in sync with the source
// they describe:
//
// 1. Generate src/mcp/knowledge.gen.ts — the machine-readable truth the MCP
//    knowledge tools answer from: tags.json / component-tags.json,
//    css/support.ts, element.ts's EventType table, plus the app-facing docs
//    corpus. The MCP server must quote the INSTALLED runtime's facts, and
//    prose copied by hand drifts the moment css-compat.md moves — so the
//    snapshot is regenerated on every build, the same way the bundler
//    inlines tags.json (AGENTS.md §4.6). The generated file is not in git;
//    a stale checkout fails loudly in server startup instead of quietly
//    answering from last month's runtime.
//
// 2. Copy packages/fjs/skills/ → dist/skills/ so `fjs ai init` (running
//    from dist) can stamp and install the SKILL.md files into a project.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/fjs/src/mcp
const pkgRoot = path.resolve(here, '../..'); // packages/fjs
const repoRoot = path.resolve(pkgRoot, '../..');
const runtimeSrc = path.join(repoRoot, 'packages/fjs-runtime/src');
const docsDir = path.join(repoRoot, 'docs');

const version = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'packages/fjs-runtime/package.json'), 'utf8'),
).version;

// ---- tags ---------------------------------------------------------------

const tags = JSON.parse(fs.readFileSync(path.join(runtimeSrc, 'tags.json'), 'utf8'));
const componentTags = JSON.parse(
  fs.readFileSync(path.join(runtimeSrc, 'component-tags.json'), 'utf8'),
);

// ---- CSS support table --------------------------------------------------
// support.ts is TypeScript, and the snapshot must not depend on a ts loader —
// esbuild is already a dependency, so bundle it to CJS in memory and eval.
const supportTs = fs.readFileSync(path.join(runtimeSrc, 'css/support.ts'), 'utf8');
const bundled = await esbuild.build({
  stdin: {
    contents: supportTs,
    sourcefile: 'support.ts',
    resolveDir: path.join(runtimeSrc, 'css'),
    loader: 'ts',
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const supportModule = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(
  supportModule,
  supportModule.exports,
);
const support = supportModule.exports;

// ---- event table --------------------------------------------------------
// EventType is a plain object literal embedded in element.ts; importing the
// module would drag the whole element API into build for one table. The
// literal is contiguous, so slice it and let the JS parser do the work —
// the count is pinned by test/mcp-knowledge.test.ts so a refactor that
// moves the table fails here instead of shipping an empty snapshot.
const elementTs = fs.readFileSync(path.join(runtimeSrc, 'ui/element.ts'), 'utf8');
const eventMatch = elementTs.match(
  /export const EventType: Record<string, number> = \{([\s\S]*?)\n\};/,
);
if (!eventMatch) throw new Error('snapshot: EventType table not found in ui/element.ts');
const events = new Function(`return {${eventMatch[1]}}`)();

// ---- docs corpus --------------------------------------------------------

const DOC_IDS = [
  'ui-api',
  'css-compat',
  'vue3',
  'routing',
  'modules',
  'miniprogram',
  'overlay-host',
  'third-party-components',
  'canvas-compat',
  'fjs-go',
  'toolchain',
];
const DOC_CAP = 64000; // chars per doc; keeps dist lean and tool replies sane

const docs = DOC_IDS.map((id) => {
  const file = path.join(docsDir, `${id}.md`);
  const raw = fs.readFileSync(file, 'utf8');
  const truncated = raw.length > DOC_CAP;
  const body = truncated ? `${raw.slice(0, DOC_CAP)}\n\n<!-- truncated by snapshot -->` : raw;
  const titleMatch = raw.match(/^# (.+)$/m);
  return {
    id,
    title: titleMatch ? titleMatch[1] : id,
    path: `docs/${id}.md`,
    body,
    truncated,
  };
});

// ---- emit ---------------------------------------------------------------

// Only the tables the knowledge tools answer from; Sets become arrays
// (JSON has no Set). Named exports stay flat so a tool can quote one table.
const css = {
  droppedProperties: support.DROPPED_PROPERTIES,
  unsupportedDisplayValues: [...support.UNSUPPORTED_DISPLAY_VALUES],
  unsupportedSizeKeywords: [...support.UNSUPPORTED_SIZE_KEYWORDS],
  sizeProperties: [...support.SIZE_PROPERTIES],
  unsupportedUnits: [...support.UNSUPPORTED_UNITS],
  verticalAlignValues: [...support.VERTICAL_ALIGN_VALUES],
  transitionableOnApp: [...support.TRANSITIONABLE_ON_APP],
  keyframesAnimatableOnApp: [...support.KEYFRAMES_ANIMATABLE_ON_APP],
  supportedPseudoClasses: [...support.SUPPORTED_PSEUDO_CLASSES],
  supportedNotArgs: [...support.SUPPORTED_NOT_ARGS],
  supportedPseudoElements: [...support.SUPPORTED_PSEUDO_ELEMENTS],
  supportedAttrSelectors: [...support.SUPPORTED_ATTR_SELECTORS],
  droppedAtRules: support.DROPPED_AT_RULES,
  supportedMediaTypes: [...support.SUPPORTED_MEDIA_TYPES],
  supportedMediaFeatures: [...support.SUPPORTED_MEDIA_FEATURES],
  fontFaceUnsupportedSrc: support.FONT_FACE_UNSUPPORTED.src,
  fontFaceUnsupportedDescriptors: [...support.FONT_FACE_UNSUPPORTED.descriptors],
};

const gen = `// GENERATED by src/mcp/snapshot.mjs — do not edit; regenerate via build.
// Sources: fjs-runtime tags/css/events + docs corpus, ufjs ${version} (specs/213).
export const UFJS_VERSION = ${JSON.stringify(version)};
export const TAGS: string[] = ${JSON.stringify(tags, null, 2)};
export const COMPONENT_TAGS: string[] = ${JSON.stringify(componentTags, null, 2)};
export const EVENTS: Record<string, number> = ${JSON.stringify(events, null, 2)};
export interface CssSnapshot {
  droppedProperties: Record<string, string>;
  droppedAtRules: Record<string, string>;
  unsupportedDisplayValues: string[];
  unsupportedSizeKeywords: string[];
  sizeProperties: string[];
  unsupportedUnits: string[];
  verticalAlignValues: string[];
  transitionableOnApp: string[];
  keyframesAnimatableOnApp: string[];
  supportedPseudoClasses: string[];
  supportedNotArgs: string[];
  supportedPseudoElements: string[];
  supportedAttrSelectors: string[];
  supportedMediaTypes: string[];
  supportedMediaFeatures: string[];
  fontFaceUnsupportedSrc: string[];
  fontFaceUnsupportedDescriptors: string[];
}
export const CSS: CssSnapshot = ${JSON.stringify(css, null, 2)};
export interface SnapshotDoc {
  id: string;
  title: string;
  path: string;
  body: string;
  truncated: boolean;
}
export const DOCS: SnapshotDoc[] = ${JSON.stringify(docs, null, 2)};
`;
fs.writeFileSync(path.join(here, 'knowledge.gen.ts'), gen);
console.log(
  `snapshot: knowledge.gen.ts — ${tags.length} tags, ${componentTags.length} component tags, ` +
    `${Object.keys(events).length} event keys, ${docs.length} docs ` +
    `(${docs.filter((d) => d.truncated).length} truncated)`,
);

// ---- skills → dist ------------------------------------------------------

const skillsSrc = path.join(pkgRoot, 'skills');
const skillsOut = path.join(pkgRoot, 'dist/skills');
fs.rmSync(skillsOut, { recursive: true, force: true });
fs.mkdirSync(skillsOut, { recursive: true });
for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  fs.cpSync(path.join(skillsSrc, entry.name), path.join(skillsOut, entry.name), {
    recursive: true,
  });
}
console.log(`snapshot: copied skills/ → dist/skills/`);
