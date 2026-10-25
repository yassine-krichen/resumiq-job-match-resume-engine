import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { sanitizeMessage } from '../sanitize';

import { fail } from './tool-result';

interface ReadOnlyToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>) => CallToolResult;
}

/**
 * Registers a tool annotated read-only and closed-world. The SDK types its
 * schema parameters against whichever zod copy npm hoists to the repo root
 * (4.x here, pulled in by better-auth), while this package validates with
 * zod 3. Both work at runtime (the SDK accepts either), but TypeScript sees two
 * unrelated declaration trees, so the SDK-facing types are bridged here once
 * instead of at every tool.
 */
export function registerReadOnlyTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  definition: ReadOnlyToolDefinition<Shape>,
): void {
  const callback = (args: z.infer<z.ZodObject<Shape>>): CallToolResult => {
    try {
      return definition.handler(args);
    } catch (error) {
      // Never forward a stack trace or the raw message to the caller.
      const reason = error instanceof Error ? error.message : 'unknown error';
      console.error(`[resumiq-mcp] ${definition.name} failed: ${sanitizeMessage(reason)}`);
      return fail('Unexpected internal error');
    }
  };

  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema as unknown as ZodRawShapeCompat,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    callback as unknown as ToolCallback<ZodRawShapeCompat>,
  );
}
