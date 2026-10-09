// fjs mcp — serve the ufjs MCP server on stdio (specs/213).
//
// Registered by `fjs ai init` as `npx @ufjs/cli mcp`. The process talks
// newline-delimited JSON-RPC on stdin/stdout and nothing else may write
// there; errors go to stderr, which MCP clients surface as server logs.
import { runStdioServer } from '../mcp/server.js';
import { TOOLS } from '../mcp/tools.js';

export async function mcpCommand(argv: string[]): Promise<void> {
  for (const arg of argv) throw new Error(`unknown mcp option: ${arg}`);
  await runStdioServer(TOOLS);
}
