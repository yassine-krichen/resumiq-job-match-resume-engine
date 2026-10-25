#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config';
import { createInventoryStore } from './inventory/inventory-store';
import { sanitizeMessage } from './sanitize';
import { createServer } from './server';

// stdout carries the JSON-RPC protocol; every log line must go to stderr.
async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer({ store: createInventoryStore(config.inventoryPath) });
  await server.connect(new StdioServerTransport());
  console.error('[resumiq-mcp] ready (stdio, read-only)');
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : 'unknown error';
  console.error(`[resumiq-mcp] fatal: ${sanitizeMessage(reason)}`);
  process.exit(1);
});
