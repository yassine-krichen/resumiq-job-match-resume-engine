import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerGetEntry } from './tools/get-entry';
import { registerListGaps } from './tools/list-gaps';
import { registerSearchProfile } from './tools/search-profile';
import { ToolDeps } from './tools/tool-deps';

export const SERVER_NAME = 'resumiq';
export const SERVER_VERSION = '0.1.0';

export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerSearchProfile(server, deps);
  registerGetEntry(server, deps);
  registerListGaps(server, deps);
  return server;
}
