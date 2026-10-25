# @resumiq/mcp-server

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server that lets a Claude client
look things up in your Resumiq career inventory (`data_inventory.json`) instead of loading the whole
file into context. Retrieval only: the caller (Claude) does the tailoring itself.

- stdio transport, no network, no writes, no file rendering
- `personal_info` (name, email, phone, links) is never indexed, searchable or returned
- certification `credential_id` is stripped, and when a certification has one its `link`, `source`
  and `description` are dropped too (they usually embed the id)
- `publications_and_speaking` and `interests` are not exposed: they are not indexed, searchable or
  returnable, and have no section name
- a fixture-based test suite; the real inventory is never read by tests

## Tools

All three carry `readOnlyHint: true` and `openWorldHint: false`.

| Tool | Input | Returns |
| --- | --- | --- |
| `search_profile` | `query` (1-200 chars), `sections?`, `limit` (1-25, default 8) | `{count, results: [{section, id, title, snippet, score, sources}]}` ranked best first |
| `get_entry` | `section`, `id` (index, `projects:3` style id, or exact case-insensitive name) | `{entry}` with all allow-listed fields; an ambiguous name returns `{ambiguous, candidates}` |
| `list_gaps` | `section?` | `{total, truncated, gaps: [{path, message}]}` |

Sections: `summary`, `experience`, `education`, `projects`, `certifications`, `awards`,
`volunteering`, `skills` (one entry per skill category).

Ranking is deterministic token matching, no embeddings: a title match counts most, then
`technologies_used` / `core_competencies`, then `raw_achievements`, then other prose. Rarer query
terms weigh more, adjacent query words that are adjacent in the entry ("spring boot") get a bonus,
and ties break by section order then index. Snippets are capped at 240 characters.

`list_gaps` checks the quality of the inventory itself (empty `technologies_used` or
`raw_achievements`, missing `quantifiable_metrics`, projects without `sources`, invalid dates, and
failures against the shared `MasterDBSchema`). It does not check the project registry or any code.
Ids such as `projects:3` are positions in the current file; they change if you reorder entries.

The inventory is served even when it fails strict `MasterDBSchema` validation (for example projects
without `startDate`); those failures are listed by `list_gaps`. A file that is not JSON, or whose
sections have the wrong shape, is reported as a tool error instead.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `RESUMIQ_INVENTORY_PATH` | `data_inventory.json` at the repo root | Path of the inventory JSON (must end in `.json`) |

The file is re-read when its modification time or size changes, and a file over 5 MB is refused. Logs go to stderr only; stdout
carries nothing but JSON-RPC frames.

## Build and test

```bash
task mcp:build     # builds @resumiq/schemas, then this package
task mcp:test      # jest, fixture inventories only
task mcp:inspect   # MCP Inspector (pinned 0.17.2) against the built server
```

Without go-task: `npm run build -w @resumiq/schemas && npm run build -w @resumiq/mcp-server`.

## Register with Claude Code

The repo root has a project-scoped `.mcp.json`:

```json
{ "mcpServers": { "resumiq": { "type": "stdio", "command": "node", "args": ["packages/mcp-server/dist/main.js"] } } }
```

1. Build once (`task mcp:build`); `dist/` is not committed.
2. Start Claude Code in the repo root and approve the project server when prompted
   (`claude mcp list` shows its status).
3. To read an inventory elsewhere, export `RESUMIQ_INVENTORY_PATH` before starting Claude Code.

`MCP_TIMEOUT` (milliseconds, default 30000) limits server startup and `MCP_TOOL_TIMEOUT`
(milliseconds, default about 28 hours) limits a single tool call. Searches return in a few
milliseconds, so neither needs changing; set `MCP_TOOL_TIMEOUT` lower (for example `10000`) if you
want a hung call to fail fast.

## Dependency notes

- `@modelcontextprotocol/sdk` is pinned to `~1.32.2` (the v1 line). v2 drops zod 3, which the rest
  of this monorepo uses.
- Sibling packages are CommonJS with classic Node resolution, which ignores the SDK's `exports`
  map. This package therefore uses `module` and `moduleResolution` `node16` and still emits
  CommonJS. `tsc --noEmit` is the type check; ts-jest only transpiles (`isolatedModules`).
- The SDK's types resolve against the zod copy hoisted at the repo root (4.x, pulled in by
  better-auth) while this package validates with zod 3. Both work at runtime, so
  `src/tools/register-read-only-tool.ts` bridges the types in one place.

## Retrieval eval

`eval/queries.json` holds 20 hand-labelled job-description queries (entry names and a short
justification each, no inventory text). With the server built:

```bash
RESUMIQ_INVENTORY_PATH=/path/to/data_inventory.json node eval/run-eval.js
```

It prints recall@5, MRR, latency and bytes per call. The query set is small and written by Claude, so
treat the numbers as a sanity check, not a benchmark. The context-saving figure compares a
`search_profile` response with the whole `data_inventory.json`; a client that reads only the sections
it needs would save less.
