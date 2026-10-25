import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildIndex } from '../inventory/entries';
import { searchEntries } from '../inventory/search';
import { SectionSchema } from '../inventory/sections';

import { ToolDeps } from './tool-deps';
import { registerReadOnlyTool } from './register-read-only-tool';
import { fail, ok } from './tool-result';

const inputSchema = {
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('What to look for, e.g. a technology, skill or phrase from a job description: "Redis caching", "RAG", "Spring Boot".'),
  sections: z
    .array(SectionSchema)
    .max(8)
    .optional()
    .describe('Restrict the search to these sections. Omit to search everything.'),
  limit: z.number().int().min(1).max(25).default(8).describe('Maximum number of results (1-25, default 8).'),
};

export function registerSearchProfile(server: McpServer, deps: ToolDeps): void {
  registerReadOnlyTool(server, {
    name: 'search_profile',
    title: 'Search career profile',
    description:
      "Search the owner's career inventory (projects, experience, education, certifications, awards, volunteering, skills, summary) " +
      'and return ranked matches with a short snippet and the evidence sources. Titles rank highest, then technologies and competencies, ' +
      'then achievements. Use get_entry with a result id to read the full entry. Contact details are never searched or returned.',
    inputSchema,
    handler: ({ query, sections, limit }) => {
      const loaded = deps.store.load();
      if (!loaded.ok) return fail(loaded.error);
      const results = searchEntries(buildIndex(loaded.snapshot.view), query, { sections, limit });
      // The query is not echoed back: the caller already has it, and it costs context.
      return ok({ count: results.length, results });
    },
  });
}
