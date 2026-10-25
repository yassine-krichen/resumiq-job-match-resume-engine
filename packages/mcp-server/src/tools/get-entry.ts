import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { IndexedEntry, buildIndex } from '../inventory/entries';
import { Section, SectionSchema } from '../inventory/sections';

import { ToolDeps } from './tool-deps';
import { registerReadOnlyTool } from './register-read-only-tool';
import { fail, ok } from './tool-result';

const inputSchema = {
  section: SectionSchema.describe('Section the entry belongs to.'),
  id: z
    .union([z.number().int().min(0).max(100000), z.string().trim().min(1).max(200)])
    .describe('Entry index within the section, an id from search_profile ("projects:3"), or the exact entry name (case-insensitive).'),
};

type Lookup = { found: IndexedEntry } | { candidates: IndexedEntry[] } | { error: string };

function lookup(entries: IndexedEntry[], section: Section, id: number | string): Lookup {
  const inSection = entries.filter((e) => e.section === section);
  const byIndex = (index: number): Lookup => {
    const found = inSection.find((e) => e.index === index);
    return found ? { found } : { error: `No ${section} entry at index ${index} (${inSection.length} entries)` };
  };

  if (typeof id === 'number') return byIndex(id);

  const idForm = /^([a-z]+):(\d+)$/.exec(id);
  if (idForm) {
    return idForm[1] === section ? byIndex(Number(idForm[2])) : { error: `Id "${id}" belongs to another section than "${section}"` };
  }
  if (/^\d+$/.test(id)) return byIndex(Number(id));

  const wanted = id.toLowerCase();
  const matches = inSection.filter((e) => e.name.toLowerCase() === wanted || e.title.toLowerCase() === wanted);
  if (matches.length === 1) return { found: matches[0] };
  if (matches.length > 1) return { candidates: matches };
  return { error: `No ${section} entry named "${id}"; use search_profile to find the right entry` };
}

export function registerGetEntry(server: McpServer, deps: ToolDeps): void {
  registerReadOnlyTool(server, {
    name: 'get_entry',
    title: 'Get a career entry',
    description:
      'Fetch one full entry (all achievements, metrics, technologies and sources) from the career inventory by section and index, ' +
      'search_profile id, or exact name. An ambiguous name returns the candidate ids instead. Contact details are never returned.',
    inputSchema,
    handler: ({ section, id }) => {
      const loaded = deps.store.load();
      if (!loaded.ok) return fail(loaded.error);
      const result = lookup(buildIndex(loaded.snapshot.view), section, id);
      if ('error' in result) return fail(result.error);
      if ('candidates' in result) {
        return ok({
          ambiguous: true,
          message: 'Several entries share that name; call get_entry again with one of these ids.',
          candidates: result.candidates.map((c) => ({ id: c.id, title: c.title })),
        });
      }
      return ok({ entry: result.found.entry });
    },
  });
}
