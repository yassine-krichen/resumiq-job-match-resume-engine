# Vendored code notice

The contents of `providers/`, `lib/ascii-fold.mjs`, and `user-agent.mjs` in this
directory are vendored verbatim (unmodified) from
[santifer/career-ops](https://github.com/santifer/career-ops) @ commit
`619a834dd7868092d8faa8a83add3b2c7afc6298`, MIT License (see `LICENSE` in this
directory).

Only the deterministic, zero-token "scanner" layer was vendored — the
`providers/*.mjs` modules and the shared helpers they import. career-ops's
agentic eval layer (`modes/*.md`), its own orchestrator (`scan.mjs`), and its
file-based application tracker were **not** vendored — this project's own
`src/orchestrator.ts` reads Postgres directly instead.

## Files

Providers (one per ATS/job board):
- `providers/greenhouse.mjs`
- `providers/lever.mjs`
- `providers/ashby.mjs`
- `providers/workday.mjs`
- `providers/smartrecruiters.mjs`
- `providers/remoteok.mjs`
- `providers/himalayas.mjs`
- `providers/remotive.mjs`
- `providers/weworkremotely.mjs`

Shared helpers (imported, transitively or directly, by the providers above):
- `providers/_http.mjs`
- `providers/_registry.mjs`
- `providers/_trust-validator.mjs`
- `providers/_ip-guard.mjs`
- `providers/_dns-cache.mjs`
- `providers/_html-to-text.mjs`
- `providers/_html-entities.mjs`
- `providers/_config-utils.mjs`
- `providers/_types.js`
- `lib/ascii-fold.mjs`
- `user-agent.mjs`

None of these files were modified from upstream. If a provider needs
patching in the future, prefer overriding/wrapping it from `src/` rather than
editing the vendored file, so future re-vendoring stays a clean diff.
