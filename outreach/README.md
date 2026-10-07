# cold-outreach-job-agent

Cold outreach for part-time jobs and internships. Claude Code researches each company and writes a tailored
email and one-page resume; small tested scripts do everything else (ingest, quote verification, critic, LaTeX
render, database). You approve the drafts in a terminal UI and a 5-minute tick sends them through the Gmail API
(one follow-up each, replies and bounces tracked). Full design: [docs/SPEC.md](docs/SPEC.md).

## Setup

```
npm install                                   # also generates the Prisma client (postinstall)
cp .env.example .env                          # set OUTREACH_DATABASE_URL (must include ?schema=outreach)
cp outreach.config.example.json outreach.config.json
```

1. **Candidate data.** Set `data_inventory_path` in `outreach.config.json` to your own inventory (the MasterDB
   shape; see `examples/data-inventory.example.json`). Your real file stays outside this repo.
2. **Availability and tracks.** Edit the hours, start date, availability lines and the three track rules
   (`ai`, `swe`, `fullstack`) in `outreach.config.json`. The config is validated at startup.
3. **LaTeX.** Resumes compile with [tectonic](https://tectonic-typesetting.github.io/). Put it on `PATH` or set
   `TECTONIC_PATH` (on Windows: `C:\Tools\Tectonic\tectonic.exe`).
4. **Database.** Apply the migration yourself, once: `npm run db:deploy` (creates the `outreach` schema objects
   from `prisma/migrations/0001_init`). Roll back with `prisma/migrations/0001_init/down.sql`.
5. **Gmail (sending).** In your own Google Cloud project enable the Gmail API and create an OAuth client of type
   "Desktop app"; put its id and secret in `.env` (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`) and the sending address in
   `outreach.config.json` (`sender_email`, plus `daily_cap_week1` / `daily_cap`). Then, once:
   `npm run outreach -- auth` (browser sign-in; the token and the account it belongs to are saved under
   `%USERPROFILE%\.config\cold-outreach\`, never in the repo; `tick` refuses a token for another account than `sender_email`) and `npm run outreach -- signature` (caches your Gmail signature in `signature.html`; emails
   are refused without it).

## Use

```
npm run outreach -- track-resumes                 # build the 3 fallback resumes into storage/tracks/
claude                                            # in this folder; then type: /outreach input/list.pdf
npm run outreach -- status                        # pipeline counts per run
npm run outreach -- summary --run <runId>

npm run outreach:review                           # terminal UI: approve (a / A), edit (e), kill (k), open PDF (o), retry a failed send (r), filter (/)
npm run outreach -- auth                          # once: Gmail sign-in
npm run outreach -- signature                     # once, and again if you change your Gmail signature
npm run outreach:tick                             # one tick now: sync replies, schedule, send what is due
task outreach:install-schedule                    # Windows: run the tick every 5 min (task outreach:uninstall-schedule removes it)
```

From the monorepo root the same commands are `task outreach:review`, `outreach:auth`, `outreach:signature`,
`outreach:tick`, `outreach:install-schedule` and `outreach:uninstall-schedule`. The schedule only runs while you are
signed in and the PC is on; a run missed while it was off starts when it is back. Send a few test emails to your own
addresses with `tick` before installing it. A send Gmail rejected (or that could not be built) is marked `failed`
with the reason shown in `review` (key `r` queues it again after you fix the cause); it is never retried on its own. A
send whose outcome is unknown (network cut mid-send) is parked as `unknown` and never retried: check your Sent
folder. Logs: `logs/tick-YYYY-MM-DD.log` (counts only, no email text).

`/outreach --resume <runId>` continues a run, `/outreach <file> --generic` skips research, and
`/outreach --source "<criteria>" [--limit N]` finds the companies first (default 20): the sourcer agent searches the
web and writes candidates, `ingest-sourced` accepts an address only if it is quoted from a saved page, returned by
Hunter, or (flagged low confidence) guessed on a domain that accepts mail. Hunter is optional: set `HUNTER_API_KEY` in
`.env`, otherwise `npm run outreach -- hunter <domain> --run <id>` does nothing. Before the summary, a blind verifier
agent re-checks every sentence of every draft against its sources; a fact without a source marks that company
`needs_manual`: it is listed in the summary and as a `?` row in the review screen with the reason, where `e` edits it
(a saved edit puts it back in the normal queue), `a` approves it anyway after a y/N confirm, and `k` kills it.
Sourced contacts whose address was guessed or scored low carry an `@?` marker in the list and a note in the detail pane.

```
npm run outreach -- prune --dry-run               # owner only: what would be erased (dead leads older than 180 days)
npm run outreach -- prune --days 180              # (at least 30) erase contacts, dossiers, draft text, PDFs and run folders; domain + status stay
task outreach:prune -- --dry-run                  # same, from the monorepo root
```

Prune covers killed, dropped and sent-without-reply companies. It keeps a tombstone (domain key and status) so the
same company is never ingested again, and never touches the suppression list. See `CLAUDE.md` for the contract
between the agents and the scripts.

## Develop

```
npm test           # unit tests: no database, network or LaTeX needed
npm run build      # compile to dist/
npm run type-check
```
