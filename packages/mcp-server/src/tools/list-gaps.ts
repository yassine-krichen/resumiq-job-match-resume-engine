import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { findGaps } from '../inventory/gaps';
import { SectionSchema } from '../inventory/sections';

import { ToolDeps } from './tool-deps';
import { registerReadOnlyTool } from './register-read-only-tool';
import { fail, ok } from './tool-result';

const MAX_GAPS_RETURNED = 200;

const inputSchema = {
  section: SectionSchema.optional().describe('Only report gaps in this section. Omit to check everything.'),
};

export function registerListGaps(server: McpServer, deps: ToolDeps): void {
  registerReadOnlyTool(server, {
    name: 'list_gaps',
    title: 'List inventory gaps',
    description:
      'Check the quality of the career inventory itself: empty technologies_used or raw_achievements, missing quantifiable_metrics, ' +
      'projects without sources, invalid dates and schema failures. Each gap is {path, message}. ' +
      'This checks inventory quality only, not the project registry or the codebase.',
    inputSchema,
    handler: ({ section }) => {
      const loaded = deps.store.load();
      if (!loaded.ok) return fail(loaded.error);
      const { view, schemaIssues, readWarnings } = loaded.snapshot;
      const gaps = findGaps(view, schemaIssues, readWarnings, section);
      return ok({
        total: gaps.length,
        truncated: gaps.length > MAX_GAPS_RETURNED,
        gaps: gaps.slice(0, MAX_GAPS_RETURNED),
      });
    },
  });
}
