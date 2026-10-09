// Project-workflow tools for `fjs mcp` (specs/213): scaffold, routes,
// doctor, build — thin wrappers that spawn this package's own CLI with
// captured pipes. Spawning (instead of importing the command functions)
// keeps command output/exit codes exactly as documented and keeps child
// stdout OUT of the MCP protocol stream; tools here must never inherit stdio.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpTool } from './server.js';

/** The running CLI. When bundled (the shipped case) this module's code lives
 * IN dist/cli.js, so import.meta.url already is the CLI; when the tests run
 * it from src/, walk to the sibling dist output. */
function resolveCliPath(): string {
  const here = fileURLToPath(import.meta.url);
  if (path.basename(here) === 'cli.js') return here;
  const candidate = path.resolve(path.dirname(here), '../../dist/cli.js');
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `the CLI bundle is missing at ${candidate} — build first: pnpm --filter @ufjs/cli run build`,
    );
  }
  return candidate;
}

interface RunResult {
  code: number;
  output: string;
}

async function runCli(args: string[], timeoutMs: number): Promise<RunResult> {
  const cliPath = resolveCliPath();
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        // A non-zero exit or a timeout are RESULTS here — the tool reports
        // them and the AI decides what to do; only a true spawn failure
        // (binary missing, …) rejects. error.code is a number on a normal
        // non-zero exit, a signal string when killed (timeout included).
        const exit = (error as { code?: number | string } | null)?.code;
        if (error !== null && typeof exit !== 'number') {
          const timedOut = (error as { killed?: boolean }).killed === true;
          const note = timedOut
            ? `timed out after ${timeoutMs}ms — pass timeoutMs or run the command in a terminal`
            : error.message;
          reject(new Error(`fjs ${args[0]}: ${note}`));
          return;
        }
        const output = [stdout, stderr].filter((part) => part.trim().length > 0).join('\n');
        resolve({ code: typeof exit === 'number' ? exit : 0, output: output.trim() });
      },
    );
  });
}

function tail(text: string, lines: number): string {
  const all = text.split('\n');
  const kept = all.slice(-lines);
  return (all.length > lines ? `… (${all.length - lines} earlier lines)\n` : '') + kept.join('\n');
}

const BUILD_PROFILES: Record<string, string[]> = {
  debug: [],
  web: ['--web'],
  mp: ['--mp'],
  pages: ['--pages'],
  release: ['--release'],
  'release-pages': ['--pages', '--release'],
};

function scaffoldTool(args: Record<string, unknown>): Promise<string> {
  const kind = String(args.kind ?? 'page');
  const name = String(args.name ?? '').trim();
  const argv: string[] = ['create'];
  if (kind !== 'project') {
    if (!name) throw new Error(`scaffold kind "${kind}" needs { name }`);
    argv.push(kind, name);
  } else if (name) {
    argv.push(name);
  }
  if (args.title !== undefined) argv.push('--title', String(args.title));
  if (args.dryRun === true) argv.push('--dry-run');
  return (async () => {
    const { code, output } = await runCli(argv, 60_000);
    return `exit ${code}\n${output}`;
  })();
}

async function routesTool(): Promise<string> {
  const { code, output } = await runCli(['routes', '--json'], 30_000);
  if (code !== 0) return `fjs routes failed (exit ${code}):\n${tail(output, 40)}`;
  try {
    const routes = JSON.parse(output.slice(output.indexOf('[') === -1 ? 0 : output.indexOf('[')));
    const rows = Array.isArray(routes) ? routes : (routes.routes ?? []);
    if (!Array.isArray(rows) || rows.length === 0) return `fjs routes returned no pages.\n${output}`;
    const lines = rows.map((route: Record<string, unknown>) => {
      const meta = (route.meta ?? {}) as Record<string, unknown>;
      const title = typeof meta.title === 'string' ? ` — ${meta.title}` : '';
      const platforms = Array.isArray(route.platforms) ? route.platforms.join('+') : '';
      return `  ${String(route.path ?? '?')}  [${String(route.name ?? '?')}]${title}${platforms ? `  (${platforms})` : ''}`;
    });
    return `routes (${rows.length}):\n${lines.join('\n')}\nraw JSON:\n${output}`;
  } catch {
    return output; // keep the CLI's own format if --json ever changes shape
  }
}

async function doctorTool(): Promise<string> {
  const { code, output } = await runCli(['doctor'], 120_000);
  return `exit ${code}\n${output}`;
}

async function buildTool(args: Record<string, unknown>): Promise<string> {
  const profile = String(args.profile ?? 'debug');
  const flags = BUILD_PROFILES[profile];
  if (!flags) {
    throw new Error(
      `unknown build profile "${profile}". profiles: ${Object.keys(BUILD_PROFILES).join(', ')}`,
    );
  }
  const timeoutMs = Math.max(10_000, Math.min(Number(args.timeoutMs ?? 300_000), 600_000));
  const { code, output } = await runCli(['build', ...flags], timeoutMs);
  const header =
    code === 0
      ? `fjs build ${profile}: OK`
      : `fjs build ${profile}: FAILED (exit ${code})`;
  return `${header}\n${tail(output, 80)}`;
}

export const WORKFLOW_TOOLS: McpTool[] = [
  {
    name: 'scaffold',
    description:
      'Run `fjs create` in the project: a new page (supports user/[id] dynamic segments), ' +
      'component, or module. Prefer this over hand-writing files — the generator also updates routes.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['page', 'component', 'module', 'project'] },
        name: {
          type: 'string',
          description: 'page/component/module name; pages may nest and be dynamic: "user/[id]"',
        },
        title: { type: 'string', description: 'page title, written to the <route> block' },
        dryRun: { type: 'boolean', description: 'print what would be written instead of writing' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    run: async (args) => scaffoldTool(args),
  },
  {
    name: 'routes',
    description: 'List the app pages and their routes (wraps `fjs routes --json`).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => routesTool(),
  },
  {
    name: 'doctor',
    description: 'Environment health check (wraps `fjs doctor`): toolchain, engines, host project.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => doctorTool(),
  },
  {
    name: 'build',
    description:
      'Run `fjs build` with a named profile. debug → dist/app, web → dist/web, mp → dist/mp, ' +
      'pages → split chunks, release → bytecode + Flutter host assets. Returns the output tail.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          enum: Object.keys(BUILD_PROFILES),
          description: 'default: debug',
        },
        timeoutMs: { type: 'number', description: 'kill the build after this long (default 300000)' },
      },
      additionalProperties: false,
    },
    run: async (args) => buildTool(args),
  },
];
