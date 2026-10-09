// fjs mcp — a Model Context Protocol server on stdio (specs/213).
//
// Hand-rolled newline-delimited JSON-RPC 2.0 rather than the official SDK:
// this server implements only initialize / tools/list / tools/call / ping,
// that subset has been stable across MCP revisions, and @ufjs/cli's sole
// runtime dependency is ws — pulling an SDK for ~200 lines of dispatch
// would be the toolchain's first step down the heavy-dependency path.
//
// protocolVersion is echoed from the client's initialize (the usual
// stdio-server convention: the client picked a version it speaks). Unknown
// methods answer -32601; a failing TOOL answers isError:true — a broken
// query is the tool's result, not a transport error, and the client should
// see the reason, not a protocol-level abort.
import readline from 'node:readline';
import { UFJS_VERSION } from './knowledge.gen.js';

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<string>;
}

const SERVER_INFO = {
  name: 'ufjs',
  title: 'ufjs app development — knowledge & workflow',
  version: UFJS_VERSION,
};

type JsonRpcId = string | number | null;

export interface McpResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorReply(id: JsonRpcId, code: number, message: string): McpResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** The one JSON-RPC message → one response mapping, kept pure so the
 * protocol tests drive it directly and the stdio loop below stays dumb.
 * Notifications (no id) return null — acknowledged, never answered. */
export function createDispatcher(tools: readonly McpTool[]) {
  return async (raw: unknown): Promise<McpResponse | null> => {
    if (!isRecord(raw)) {
      return errorReply(null, -32600, 'each line must be one JSON-RPC 2.0 object');
    }
    const id = (raw.id ?? null) as JsonRpcId;
    const hasId = raw.id !== undefined;
    const method = typeof raw.method === 'string' ? raw.method : '';

    if (raw.jsonrpc !== '2.0' || !method) {
      return hasId ? errorReply(id, -32600, 'not a JSON-RPC 2.0 request') : null;
    }
    // Batching was dropped from MCP; reject it instead of half-supporting.
    // (isRecord already returned false for arrays above.)

    switch (method) {
      case 'initialize': {
        if (!hasId) return null;
        const params = isRecord(raw.params) ? raw.params : {};
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion:
              typeof params.protocolVersion === 'string'
                ? params.protocolVersion
                : '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          },
        };
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return hasId ? { jsonrpc: '2.0', id, result: {} } : null;
      case 'tools/list': {
        if (!hasId) return null;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
        };
      }
      case 'tools/call': {
        if (!hasId) return null;
        const params = isRecord(raw.params) ? raw.params : {};
        const name = typeof params.name === 'string' ? params.name : '';
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) {
          return errorReply(id, -32602, `unknown tool: ${name || '(none)'}`);
        }
        const args = isRecord(params.arguments) ? params.arguments : {};
        try {
          const text = await tool.run(args);
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }] },
          };
        } catch (e) {
          // Tool-level failure: the caller gets the reason as the result.
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
              isError: true,
            },
          };
        }
      }
      default:
        if (!hasId) return null;
        if (method.startsWith('notifications/')) return null;
        return errorReply(id, -32601, `method not found: ${method}`);
    }
  };
}

/** Runs the server on stdio until stdin closes. Everything the server says
 * goes out as single-line JSON on stdout — which is why every tool runs
 * child processes with captured pipes, never inherited stdio. */
export async function runStdioServer(tools: readonly McpTool[]): Promise<void> {
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(
      'mcp: the knowledge snapshot is empty — run the package build ' +
        '(node src/mcp/snapshot.mjs && pnpm --filter @ufjs/cli run build) and retry',
    );
  }
  const dispatch = createDispatcher(tools);
  const rl = readline.createInterface({ input: process.stdin });
  const write = (response: McpResponse): void => {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  };
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      write(errorReply(null, -32700, 'parse error: not JSON'));
      continue;
    }
    const response = await dispatch(parsed);
    if (response) write(response);
  }
}
