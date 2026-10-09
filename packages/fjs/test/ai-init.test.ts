// `fjs ai init` idempotence contract (specs/213): the pack is written, is
// stable across re-runs, refreshes on --force / version bumps, never
// clobbers a user's own MCP entries, and refuses (rather than repairs) a
// malformed config file. `fjs create` runs the same code path end to end.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiInit } from '../src/commands/ai.js';

const distCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');

let host: string;

beforeEach(() => {
  host = fs.mkdtempSync(path.join(os.tmpdir(), 'fjs-ai-init-'));
});

afterAll(() => {
  fs.rmSync(path.join(os.tmpdir(), 'fjs-ai-init-'), { recursive: true, force: true });
});

const SKILL_NAMES = ['ufjs-app-dev', 'ufjs-build', 'ufjs-debug', 'ufjs-ui'];

describe('ai init', () => {
  it('writes 4 skills to two locations plus both MCP registrations', async () => {
    const report = await aiInit({ dir: host, quiet: true });
    for (const skill of SKILL_NAMES) {
      expect(fs.existsSync(path.join(host, `skills/${skill}/SKILL.md`))).toBe(true);
      expect(fs.existsSync(path.join(host, `.claude/skills/${skill}/SKILL.md`))).toBe(true);
    }
    expect(fs.existsSync(path.join(host, '.mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(host, '.agents/mcp.json'))).toBe(true);
    expect(report.written).toHaveLength(10);
  });

  it('stamps the frontmatter with the ufjs version', async () => {
    await aiInit({ dir: host, quiet: true });
    const body = fs.readFileSync(path.join(host, 'skills/ufjs-ui/SKILL.md'), 'utf8');
    expect(body).toMatch(/^ufjs-version: \d+\.\d+\.\d+/m);
    expect(body).toMatch(/^name: ufjs-ui$/m);
  });

  it('is idempotent: a second run writes nothing', async () => {
    await aiInit({ dir: host, quiet: true });
    const before = fs.readFileSync(path.join(host, '.mcp.json'), 'utf8');
    const report = await aiInit({ dir: host, quiet: true });
    expect(report.written).toHaveLength(0);
    expect(report.unchanged).toHaveLength(10);
    expect(fs.readFileSync(path.join(host, '.mcp.json'), 'utf8')).toBe(before);
  });

  it('upserts only mcpServers.ufjs, keeping the user’s servers and keys', async () => {
    fs.writeFileSync(
      path.join(host, '.mcp.json'),
      JSON.stringify(
        { mcpServers: { mine: { command: 'uvx', args: ['mine-mcp'] } }, comment: 'keep me' },
        null,
        2,
      ),
    );
    await aiInit({ dir: host, quiet: true });
    const config = JSON.parse(fs.readFileSync(path.join(host, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
      comment?: string;
    };
    expect(config.mcpServers.mine).toEqual({ command: 'uvx', args: ['mine-mcp'] });
    expect(config.comment).toBe('keep me');
    expect((config.mcpServers.ufjs as { command: string }).command).toBe('npx');

    // And the refresh stays idempotent for the user's entries too.
    const report = await aiInit({ dir: host, quiet: true });
    expect(report.written.filter((file) => file.endsWith('.json'))).toHaveLength(0);
  });

  it('refuses to overwrite a malformed .mcp.json', async () => {
    const broken = '{ "mcpServers": { "mine": ';
    fs.writeFileSync(path.join(host, '.mcp.json'), broken);
    await expect(aiInit({ dir: host, quiet: true })).rejects.toThrow(/will not overwrite/);
    expect(fs.readFileSync(path.join(host, '.mcp.json'), 'utf8')).toBe(broken);
  });

  it('a version bump refreshes the pack without --force', async () => {
    await aiInit({ dir: host, quiet: true });
    const skillPath = path.join(host, 'skills/ufjs-ui/SKILL.md');
    fs.writeFileSync(skillPath, fs.readFileSync(skillPath, 'utf8').replace(/ufjs-version: .*/, 'ufjs-version: 0.0.1'));
    const report = await aiInit({ dir: host, quiet: true });
    expect(report.written.some((file) => file === 'skills/ufjs-ui/SKILL.md')).toBe(true);
    expect(fs.readFileSync(skillPath, 'utf8')).toMatch(new RegExp(`ufjs-version: \\d+\\.\\d+\\.\\d+`));
  });
});

describe.runIf(fs.existsSync(distCli))('fjs create installs the pack', () => {
  it('scaffolds a project that is AI-ready in one step', async () => {
    const project = path.join(host, 'fresh');
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [distCli, 'create', 'fresh', '--yes'],
        { cwd: host },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    expect(fs.existsSync(path.join(project, 'skills/ufjs-app-dev/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.claude/skills/ufjs-ui/SKILL.md'))).toBe(true);
    const mcp = JSON.parse(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(mcp.mcpServers.ufjs.args).toEqual(['@ufjs/cli', 'mcp']);
  }, 60_000);
});
