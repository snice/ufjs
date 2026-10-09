// The tool registry `fjs mcp` serves (specs/213). Order is presentation
// order in tools/list: knowledge → workflow → runtime, the order an AI
// typically needs them.
import { KNOWLEDGE_TOOLS } from './tools-knowledge.js';
import { WORKFLOW_TOOLS } from './tools-workflow.js';
import { RUNTIME_TOOLS } from './tools-runtime.js';
import type { McpTool } from './server.js';

export const TOOLS: McpTool[] = [...KNOWLEDGE_TOOLS, ...WORKFLOW_TOOLS, ...RUNTIME_TOOLS];
