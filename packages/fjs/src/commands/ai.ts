// fjs ai init — install the ufjs AI pack into the current project (specs/213).
//
// Three writes, all idempotent:
//   skills/ufjs-*/SKILL.md           the human-visible copy at the project root
//   .claude/skills/ufjs-*/SKILL.md   the same content where Claude Code looks
//   .mcp.json / .agents/mcp.json     register this CLI as the "ufjs" MCP server
//
// Idempotence is per-owner: whole `ufjs-*` skill directories belong to ufjs
// and are refreshed wholesale; anything else in skills/ is not ours to
// touch. MCP registration upserts ONLY the `mcpServers.ufjs` key — a user's
// other servers, or any other top-level key in those files, survives. A
// malformed target JSON is an error, never an overwrite: silent clobbering
// of user config is the failure mode this command exists to avoid.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UFJS_VERSION } from '../mcp/knowledge.gen.js';

/** The MCP server entry written into .mcp.json / .agents/mcp.json. `npx`
 * resolves the project's local @ufjs/cli first, so this works for both
 * locally-installed and one-off npx projects without pinning absolute
 * paths that break across machines. */
const UFJS_MCP_SERVER = { command: 'npx', args: ['@ufjs/cli', 'mcp'] };

const MCP_FILES = ['.mcp.json', '.agents/mcp.json'];

export interface AiInitResult {
  written: string[];
  unchanged: string[];
}

export interface AiInitOptions {
  /** Project root (default: cwd). */
  dir?: string;
  /** Rewrite even when content is unchanged. */
  force?: boolean;
  /** Don't print; the caller (fjs create) reports one line instead. */
  quiet?: boolean;
}

/** The skills source: dist/skills in the shipped CLI (esbuild bundles this
 * module into dist/cli.js, so import.meta.url is the bundle), packages/fjs/
 * skills when running from src (tests). */
function skillsSourceDir(): string {
  const bundled = fileURLToPath(new URL('./skills/', import.meta.url));
  if (fs.existsSync(bundled)) return bundled;
  return fileURLToPath(new URL('../../skills/', import.meta.url));
}

/** Put the ufjs version into the frontmatter so `ai init` can tell "same
 * version, nothing to do" from "upgraded, refresh the pack". */
function stampVersion(source: string): string {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return source;
  const front = match[1]
    .split('\n')
    .filter((line) => !line.startsWith('ufjs-version:'))
    .join('\n');
  return `---\n${front}\nufjs-version: ${UFJS_VERSION}\n---\n${source.slice(match[0].length)}`;
}

function writeIfChanged(target: string, contents: string, force: boolean): 'written' | 'unchanged' {
  if (!force && fs.existsSync(target) && fs.readFileSync(target, 'utf8') === contents) {
    return 'unchanged';
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return 'written';
}

function mergeMcpServers(projectRoot: string, report: AiInitResult, force: boolean): void {
  for (const file of MCP_FILES) {
    const target = path.join(projectRoot, file);
    let config: Record<string, unknown> = {};
    if (fs.existsSync(target)) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          config = parsed as Record<string, unknown>;
        }
      } catch (e) {
        throw new Error(
          `${file} is not valid JSON (${e instanceof Error ? e.message : String(e)}) — ` +
            'fix or remove it first; ai init will not overwrite it',
        );
      }
    }
    const servers =
      config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
        ? (config.mcpServers as Record<string, unknown>)
        : {};
    servers.ufjs = UFJS_MCP_SERVER;
    config.mcpServers = servers;
    const status = writeIfChanged(
      target,
      `${JSON.stringify(config, null, 2)}\n`,
      force,
    );
    report[status].push(file);
  }
}

export async function aiInit(options: AiInitOptions = {}): Promise<AiInitResult> {
  const projectRoot = path.resolve(options.dir ?? process.cwd());
  const force = options.force === true;
  const report: AiInitResult = { written: [], unchanged: [] };
  const sourceDir = skillsSourceDir();

  const skills = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (skills.length === 0) {
    throw new Error(`no skills found in ${sourceDir} — the package build looks broken`);
  }
  for (const skill of skills) {
    const source = fs.readFileSync(path.join(sourceDir, skill, 'SKILL.md'), 'utf8');
    const stamped = stampVersion(source);
    // Whole ufjs-* directories are ours; other names in skills/ are not.
    for (const relative of [`skills/${skill}/SKILL.md`, `.claude/skills/${skill}/SKILL.md`]) {
      const status = writeIfChanged(path.join(projectRoot, relative), stamped, force);
      report[status].push(relative);
    }
  }
  mergeMcpServers(projectRoot, report, force);

  if (!options.quiet) {
    const stamp = `ufjs ${UFJS_VERSION}`;
    if (report.written.length === 0) {
      console.log(`ai pack up to date (${stamp}); nothing written. --force rewrites.`);
    } else {
      console.log(`ai pack written (${stamp}):`);
      for (const file of report.written) console.log(`  + ${file}`);
      for (const file of report.unchanged) console.log(`  = ${file} (unchanged)`);
      console.log(
        'restart your AI tool / reopen the project so it picks up the MCP server;',
        're-run `npx @ufjs/cli ai init` after upgrading @ufjs/cli.',
      );
    }
  }
  return report;
}

export async function aiCommand(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub !== 'init') {
    throw new Error('usage: fjs ai init [--force] [--dir <path>]');
  }
  const options: AiInitOptions = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--force') options.force = true;
    else if (arg === '--dir') options.dir = rest[++i];
    else if (arg === '--quiet') options.quiet = true;
    else throw new Error(`unknown ai option: ${arg}`);
  }
  await aiInit(options);
}
