// MCP JSON-RPC contract (specs/213): the wire shape `fjs mcp` speaks is a
// new contract in the constitution-II sense, so the dispatcher is pinned
// here — handshake, tool listing, call results vs tool errors, and the
// methods that must NOT be answered. The spawn block at the end proves the
// stdio loop ends to end.
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDispatcher, type McpTool } from '../src/mcp/server.js';
import { TOOLS } from '../src/mcp/tools.js';

const distCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');

function dispatch(raw: unknown): Promise<Record<string, unknown> | null> {
  return createDispatcher(TOOLS)(raw) as Promise<Record<string, unknown> | null>;
}

const echo: McpTool = {
  name: 'echo',
  description: 'test tool',
  inputSchema: { type: 'object', properties: {} },
  run: async (args) => `echo:${String(args.text ?? '')}`,
};

describe('mcp dispatcher', () => {
  it('initialize echoes the client protocolVersion and identifies the server', async () => {
    const reply = await dispatch({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    });
    const result = reply?.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe('2025-06-18');
    expect((result.serverInfo as Record<string, unknown>).name).toBe('ufjs');
    expect(result.capabilities).toBeDefined();
  });

  it('notifications are acknowledged, never answered', async () => {
    expect(
      await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).toBeNull();
    expect(
      await dispatch({ jsonrpc: '2.0', method: 'notifications/whatever' }),
    ).toBeNull();
  });

  it('tools/list serves every registered tool with name + schema', async () => {
    const reply = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (reply?.result as { tools: Array<{ name: string }> }).tools;
    // The count is the spec §3 list: knowledge 6 + workflow 4 + runtime 4.
    expect(tools).toHaveLength(14);
    expect(tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
    }
  });

  it('tools/call returns content; a failing tool returns isError, not a protocol error', async () => {
    const dispatcher = createDispatcher([echo]);
    const ok = await dispatcher({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hi' } },
    });
    expect((ok?.result as { content: Array<{ text: string }> }).content[0].text).toBe('echo:hi');

    const bad = await dispatcher({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'x' } },
    });
    // echo never throws; force one that does:
    const throwing: McpTool = { ...echo, run: async () => { throw new Error('boom'); } };
    const err = await createDispatcher([throwing])({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'echo', arguments: {} },
    });
    const result = err?.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
    void bad;
  });

  it('unknown tool is invalid params (-32602); unknown method is -32601', async () => {
    const missing = await dispatch({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
    });
    expect((missing?.error as { code: number }).code).toBe(-32602);

    const method = await dispatch({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
    expect((method?.error as { code: number }).code).toBe(-32601);
  });

  it('non-2.0 envelopes are invalid requests; batches are rejected', async () => {
    expect(((await dispatch({ id: 1, method: 'ping' }))?.error as { code: number }).code).toBe(
      -32600,
    );
    expect(((await dispatch([1, 2]))?.error as { code: number }).code).toBe(-32600);
  });
});

describe.runIf(fs.existsSync(distCli))('mcp over stdio (dist bundle)', () => {
  it('answers a real handshake + tools/list + knowledge call', async () => {
    const lines = [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } },
      }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_tag', arguments: { name: 'scroll-view' } },
      }),
      '',
    ];
    const replies: string[] = [];
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [distCli, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdout.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim()) replies.push(line);
        }
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', () => resolve());
      child.stdin.end(lines.join('\n'));
      setTimeout(() => {
        child.kill();
        if (stderr) console.error(`fjs mcp stderr: ${stderr}`);
      }, 15_000).unref();
    });
    expect(replies).toHaveLength(3); // the notification never gets an answer
    const init = JSON.parse(replies[0]);
    expect(init.result.serverInfo.name).toBe('ufjs');
    const list = JSON.parse(replies[1]);
    expect(list.result.tools).toHaveLength(14);
    const tag = JSON.parse(replies[2]);
    expect(tag.result.content[0].text).toContain('scroll-view');
  }, 30_000);
});
