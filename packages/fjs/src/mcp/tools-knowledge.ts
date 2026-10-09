// Knowledge-query tools for `fjs mcp` (specs/213).
//
// Every answer comes from the build-time snapshot (knowledge.gen.ts) — the
// same tags.json / css/support.ts / element.ts tables the runtime, bundler
// and linter read — so a tool reply can never disagree with the installed
// runtime the way a memorized or web-scraped answer would. Prose quoted
// from docs/ always carries its source path; where a table is silent the
// tool says "unknown" instead of guessing from Web habits.
import {
  COMPONENT_TAGS,
  CSS,
  DOCS,
  EVENTS,
  TAGS,
  UFJS_VERSION,
  type SnapshotDoc,
} from './knowledge.gen.js';
import type { McpTool } from './server.js';

function doc(id: string): SnapshotDoc {
  const found = DOCS.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`no doc "${id}". available: ${DOCS.map((d) => d.id).join(', ')}`);
  }
  return found;
}

/** The `heading` section of a markdown body, up to the next heading of the
 * same or higher level. Headings may carry suffixes (`### web-view（模块
 * …）`), so the match is a prefix on the heading text; both H2 (`## 事件…`)
 * and H3 (`### scroll-view`) sections are found. Returns null when the doc
 * has no such section. */
function extractSection(body: string, heading: string): string | null {
  const lines = body.split('\n');
  const headingOf = (line: string): { level: number; text: string } | null => {
    const match = line.match(/^(#{2,3}) (.+)$/);
    return match ? { level: match[1].length, text: match[2].trim() } : null;
  };
  let start = -1;
  let startLevel = 3;
  for (let i = 0; i < lines.length; i++) {
    const headingAt = headingOf(lines[i]);
    if (headingAt && headingAt.text.startsWith(heading)) {
      start = i;
      startLevel = headingAt.level;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const headingAt = headingOf(lines[i]);
    if (headingAt && headingAt.level <= startLevel) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function uiApi(): SnapshotDoc {
  return doc('ui-api');
}

/** The 标签全集 table rows that mention the tag in backticks. */
function tableRowsForTag(tag: string): string[] {
  const needle = `\`${tag}\``;
  return uiApi()
    .body.split('\n')
    .filter((line) => line.startsWith('|') && line.includes(needle));
}

function listTags(): string {
  const sections = uiApi()
    .body.split('\n')
    .filter((line) => line.startsWith('### '))
    .map((line) => line.slice(3).trim())
    .map((heading) => heading.replace(/（.*$/, '').trim());
  const lines: string[] = [
    `ufjs ${UFJS_VERSION} — 38 whitelist tags. Facts per tag: get_tag {name}.`,
    '',
    `element tags (${TAGS.length}, native on Flutter / web adapter):`,
    TAGS.map((tag) => (sections.includes(tag) ? `${tag}*` : tag)).join(', '),
    '  (* has a dedicated section in docs/ui-api.md — get_tag quotes it)',
    '',
    `JS component tags (${COMPONENT_TAGS.length}, implemented in fjs-runtime/src/components,`,
    'not native elements — constitution VII):',
    COMPONENT_TAGS.join(', '),
    '  (form and list-view appear in both lists; the component wins — same',
    '   precedence the SFC compiler applies)',
    '',
    'Module-provided tags (glass-surface, web-view, …) register at runtime and',
    'are covered by their docs — try search_docs.',
  ];
  return lines.join('\n');
}

function getTag(args: Record<string, unknown>): string {
  const name = String(args.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, '');
  if (!name) throw new Error('get_tag needs { name: "scroll-view" }');

  const isComponent = COMPONENT_TAGS.includes(name);
  const isElement = TAGS.includes(name);
  if (!isComponent && !isElement) {
    // Dash-insensitive matching: a typo like "scrollview" should still find
    // "scroll-view" — the suggestion is the answer, not an apology.
    const squash = (value: string): string => value.replace(/[-_]/g, '');
    const bare = squash(name);
    const suggestions = [...TAGS, ...COMPONENT_TAGS].filter((tag) => {
      const flat = squash(tag);
      return flat.includes(bare) || bare.includes(flat);
    });
    throw new Error(
      `unknown tag "${name}".` +
        (suggestions.length
          ? ` did you mean: ${suggestions.join(', ')}?`
          : ` it is not in the whitelist — see list_tags. A custom element` +
            ` tag must be registered via engine.registerComponent (search_docs "registerComponent").`),
    );
  }

  const lines: string[] = [];
  lines.push(`${name} — ${isComponent ? 'JS component tag' : 'element tag'} (ufjs ${UFJS_VERSION})`);
  if (isComponent) {
    lines.push(
      '  implemented as a Vue component in fjs-runtime/src/components (both hosts);',
      '  it is NOT a native element — constitution VII: JS first, Dart only when needed.',
    );
  }
  const rows = tableRowsForTag(name);
  if (rows.length) {
    lines.push('', `docs/ui-api.md 标签全集 row(s):`, ...rows.map((row) => `  ${row}`));
  }
  const section = extractSection(uiApi().body, name);
  if (section) {
    lines.push('', `docs/ui-api.md dedicated section:`, section);
  }
  if (!rows.length && !section) {
    lines.push('', 'no dedicated ui-api section — the tag is documented only in the table above.');
  }
  lines.push(
    '',
    'More: search_docs for behavior details; get_doc css-compat for style support.',
  );
  return lines.join('\n');
}

function queryCss(args: Record<string, unknown>): string {
  const property = String(args.property ?? '').trim().toLowerCase();
  if (!property) throw new Error('query_css needs { property: "position", value?: "fixed" }');
  const value = args.value === undefined ? undefined : String(args.value).trim();
  const context = args.context === 'keyframes' ? 'keyframes' : 'declaration';
  const footer =
    `\nSource: fjs-runtime/src/css/support.ts (snapshot, ufjs ${UFJS_VERSION}). ` +
    `Web/miniprogram differences and full context: get_doc css-compat, search_docs "${property}".`;

  if (context === 'keyframes') {
    const animatable = CSS.keyframesAnimatableOnApp.includes(property);
    return (
      `【${animatable ? 'ok' : 'warn'}】@keyframes frame property ${property}: ` +
      (animatable
        ? 'animates on the App.'
        : "the frame arrives but does NOT move on the App (web plays it natively) — the exact silent divergence this table exists for. Restrict keyframes to transform/opacity or the SVG stroke/fill family.") +
      footer
    );
  }

  const dropped = CSS.droppedProperties[property];
  if (dropped !== undefined) {
    return `【drop】${property}: ${dropped}. The declaration never takes effect on the App.${footer}`;
  }
  if (property === 'display' && value !== undefined) {
    const first = value.split(/[\s,]+/)[0]?.toLowerCase() ?? '';
    if (CSS.unsupportedDisplayValues.includes(first)) {
      return `【drop】display: ${first} — the rule applies but this declaration is skipped on the App. Use flex (row/column + wrap).${footer}`;
    }
  }
  if (property === 'vertical-align' && value !== undefined) {
    if (!CSS.verticalAlignValues.includes(value.toLowerCase()) && value !== 'inherit') {
      return `【drop】vertical-align: ${value} — only ${CSS.verticalAlignValues.join(' ')} are honored; anything else is skipped.${footer}`;
    }
  }
  if (CSS.sizeProperties.includes(property) && value !== undefined) {
    const keywords = CSS.unsupportedSizeKeywords.filter((keyword) => value.includes(keyword));
    if (keywords.length) {
      return `【warn】${property}: ${keywords.join(' ')} lay out as auto on the App (the Dart side warns once per value). fit-content is supported on width only.${footer}`;
    }
  }
  if (value !== undefined) {
    const units = CSS.unsupportedUnits.filter((unit) => value.includes(unit));
    if (units.length) {
      return `【drop】${property}: ${value} — ${units.join('/')} resolve nowhere on the App, the declaration is skipped wherever they appear. Use px or % (em/rem are rewritten by the build and work).${footer}`;
    }
  }
  if ((property === 'transition' || property === 'transition-property') && value !== undefined) {
    const names = value.match(/[a-z-]+/g) ?? [];
    const lines = names.map((name) => {
      if (name === 'all' || name === 'none' || name.startsWith('--')) {
        return `  ${name}: not judged (all covers the table; custom properties are unresolvable statically)`;
      }
      return CSS.transitionableOnApp.includes(name)
        ? `  ${name}: animates on the App`
        : `  ${name}: will NOT tween on the App — snaps (web animates it)`;
    });
    return `transition targets, per property:\n${lines.join('\n')}${footer}`;
  }
  return (
    `【unknown→likely ok】${property}` +
    (value !== undefined ? `: ${value}` : '') +
    ' is not in the App-side gap table (dropped properties / display values / size keywords /' +
    ' units / vertical-align), so the engine most likely honors it. That table is conservative' +
    ' by design — before relying on an unusual property, confirm in the docs:' +
    footer
  );
}

function listEvents(): string {
  const byOpcode = new Map<number, string[]>();
  for (const [key, opcode] of Object.entries(EVENTS)) {
    const keys = byOpcode.get(opcode) ?? [];
    keys.push(key);
    byOpcode.set(opcode, keys);
  }
  const lines: string[] = [
    `Event prop names (ufjs ${UFJS_VERSION}) — the table is fjs-runtime/src/ui/element.ts EventType.`,
    'Template spelling @name compiles to the onName prop. Aliases share one opcode.',
    'Payloads are ALWAYS strings; structured payloads are JSON — parse them.',
    '',
  ];
  for (const opcode of [...byOpcode.keys()].sort((a, b) => a - b)) {
    const keys = byOpcode.get(opcode) ?? [];
    lines.push(`  ${String(opcode).padStart(3)}  ${keys.join(' / ')}`);
  }
  const eventsSection = extractSection(uiApi().body, '事件（props');
  if (eventsSection) {
    lines.push('', 'Payload shapes, from docs/ui-api.md:', eventsSection);
  }
  return lines.join('\n');
}

/** Naive ranked search: term frequency per doc, CJK terms are substrings so
 * they work without tokenization. Good enough to route a question to the
 * right doc — the tool returns excerpts, not an index. */
function searchDocs(args: Record<string, unknown>): string {
  const query = String(args.query ?? '').trim();
  if (!query) throw new Error('search_docs needs { query: "position fixed 弹层" }');
  const limit = Math.max(1, Math.min(Number(args.limit ?? 4) || 4, DOCS.length));
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  const scored = DOCS.map((candidate) => {
    const body = candidate.body.toLowerCase();
    let score = 0;
    let firstTerm = terms[0] ?? '';
    let rarest = Number.POSITIVE_INFINITY;
    for (const term of terms) {
      let count = 0;
      let at = body.indexOf(term);
      if (at === -1) continue;
      while (at !== -1) {
        count++;
        at = body.indexOf(term, at + term.length);
      }
      if (count < rarest) {
        rarest = count;
        firstTerm = term;
      }
      score += count;
    }
    return { candidate, score, firstTerm };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (!scored.length) {
    return `no doc matches "${query}". available docs: ${DOCS.map((d) => d.id).join(', ')}`;
  }
  const blocks = scored.map(({ candidate, score, firstTerm }) => {
    const body = candidate.body;
    const at = body.toLowerCase().indexOf(firstTerm);
    const excerpt = excerptAround(body, at);
    return (
      `## ${candidate.id} — ${candidate.title}  (score ${score}${candidate.truncated ? ', snapshot truncated' : ''})\n` +
      `source: ${candidate.path} · full text: get_doc {id: "${candidate.id}"}\n` +
      excerpt
    );
  });
  return `docs matching "${query}":\n\n${blocks.join('\n\n')}`;
}

function excerptAround(body: string, center: number): string {
  if (center === -1) return '';
  const lines = body.split('\n');
  let consumed = 0;
  let lineIndex = 0;
  for (; lineIndex < lines.length; lineIndex++) {
    const next = consumed + lines[lineIndex].length + 1;
    if (next > center) break;
    consumed = next;
  }
  const from = Math.max(0, lineIndex - 3);
  const to = Math.min(lines.length, lineIndex + 9);
  const head = from > 0 ? '  …' : '  ';
  return `${head}${lines.slice(from, to).join('\n  ')}${to < lines.length ? '\n  …' : ''}`;
}

function getDoc(args: Record<string, unknown>): string {
  const id = String(args.id ?? '').trim();
  const found = doc(id);
  const header = found.truncated
    ? `docs/${found.id}.md (snapshot truncated at ${found.body.length} chars — read the file in the ufjs repo for the rest)\n\n`
    : '';
  return `${header}${found.body}`;
}

export const KNOWLEDGE_TOOLS: McpTool[] = [
  {
    name: 'list_tags',
    description:
      'List every ufjs tag: the built-in element tags and the JS component tags. ' +
      'Call before inventing HTML tags — ufjs renders a whitelist, anything else falls back to view.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => listTags(),
  },
  {
    name: 'get_tag',
    description:
      'Per-tag facts: props, events, gotchas, the docs/ui-api.md table row and dedicated section. ' +
      'Call for any tag you are about to use.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'tag name, e.g. "scroll-view"' } },
      required: ['name'],
      additionalProperties: false,
    },
    run: async (args) => getTag(args),
  },
  {
    name: 'query_css',
    description:
      'Ask whether a CSS property (optionally a value) works in the ufjs App engine. ' +
      'Answers drop / warn / likely-ok from the same support table the linter uses — never guess CSS support.',
    inputSchema: {
      type: 'object',
      properties: {
        property: { type: 'string', description: 'kebab-case property, e.g. "position"' },
        value: { type: 'string', description: 'optional value, e.g. "fixed" or "1px solid red"' },
        context: {
          type: 'string',
          enum: ['declaration', 'keyframes'],
          description:
            'declaration (default) judges a style declaration; keyframes judges a property used inside @keyframes frames',
        },
      },
      required: ['property'],
      additionalProperties: false,
    },
    run: async (args) => queryCss(args),
  },
  {
    name: 'list_events',
    description:
      'The event prop table with opcodes and aliases, plus payload-shape docs. ' +
      'Event payloads are always strings — check shapes here before wiring @events.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => listEvents(),
  },
  {
    name: 'search_docs',
    description:
      'Full-text search over the bundled ufjs app-facing docs (ui-api, css-compat, routing, ' +
      'overlay-host, …). Returns ranked docs with excerpts — the fastest way to route a how-to question.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'keywords, Chinese or English, e.g. "返回拦截 弹层"' },
        limit: { type: 'number', description: 'max docs to return (default 4)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: async (args) => searchDocs(args),
  },
  {
    name: 'get_doc',
    description: 'Read one bundled ufjs doc in full, by id (see search_docs / list output for ids).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'doc id, e.g. "overlay-host"' } },
      required: ['id'],
      additionalProperties: false,
    },
    run: async (args) => getDoc(args),
  },
];
