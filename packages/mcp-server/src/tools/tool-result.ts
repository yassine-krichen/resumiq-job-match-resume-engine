import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { sanitizeMessage } from '../sanitize';

/** Compact JSON on purpose: the caller pays for every character in context. */
export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: sanitizeMessage(message) }] };
}
