import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { loadHunterApiKey } from '../config/env';
import { isPlaybookAgent } from '../playbooks/playbook';
import type { PlaybookAgent } from '../playbooks/playbook';
import { writeCandidateBrief } from '../services/candidate-brief.service';
import { checkEmail } from '../core/email-check';
import { parseRowsFromText } from '../core/normalize-input';
import { processDossiers } from '../services/dossier-stage.service';
import { processDrafts } from '../services/draft-stage.service';
import { assertTrackResumesExist, processGeneric } from '../services/generic-draft.service';
import { runHunter } from '../services/hunter.service';
import { ingestSourced, readSourcedContacts } from '../services/ingest-sourced.service';
import { appendNormalizedRows, ingestRows } from '../services/ingest.service';
import { DEFAULT_PRUNE_DAYS, pruneDeadLeads } from '../services/prune.service';
import { pendingSlugs, statusText, summaryText } from '../services/report.service';
import type { PendingStage } from '../services/report.service';
import { buildTrackResumes } from '../services/resume.service';
import { RunLayout, defaultRunId, isSnapshotDir } from '../services/run-layout';
import { snapshotUrl } from '../services/snapshot.service';
import { pendingVerifySlugs, prepareVerify, processVerify } from '../services/verify-stage.service';

import { costCommand } from './cost-command';
import { createContext, createRenderer, loadConfigAndInventory, openStore } from './context';
import type { Context } from './context';
import { learnCommand, playbookCommand } from './playbook-commands';
import { authCommand, previewCommand, reviewCommand, signatureCommand, testSendCommand, tickCommand } from './send-commands';

const USAGE = `Usage: npm run outreach -- <command> [options]

  ingest <normalized.json> [--run <id>] [--no-mx] validate rows, dedupe, MX check, insert (run id defaults to run-YYYYMMDD-HHMM)
  new-run                                         print a fresh run id (for --source, which needs one before anything is ingested)
  prepare --run <id>                              write runs/<id>/candidate.json for the agents
  snapshot <url> <dir>                            save a page as evidence (dir: runs/<run>/companies/<slug>/snapshots or runs/<run>/sourcing/snapshots)
  hunter <domain> --run <id>                      optional: save Hunter's known addresses for a domain (needs HUNTER_API_KEY; otherwise does nothing)
  ingest-sourced --run <id> [--limit N] [--no-mx] verify the sourcer's candidates.json (quoted or Hunter address, guesses need MX), dedupe, insert
  process --run <id> --stage dossier|draft|verify verify dossiers / check, render and store drafts / apply the blind verifier's verdicts
  prepare-verify --run <id>                       write the verifier's input for every draft not yet verified
  pending --run <id> --stage research|write|verify slugs still waiting for an agent (for --resume)
  track-resumes                                   build the ai / swe / fullstack fallback resumes
  generic --run <id>                              generic email + track resume for unfinished companies
  status                                          pipeline counts for every run
  summary --run <id>                              end-of-run report
  cost --run <id> [--json] | --all                what the agents used, in API-equivalent USD: per company, orchestrator overhead, run total, averages
  preview --run <id> [--slug s] [--json]          write the exact initial + follow-up messages as storage/<run>/<slug>/*.eml (no Gmail, changes nothing)
  learn --agent <name> --situation "<text>" --fix "<text>"  record a workaround in playbooks/<name>.md (validated; what agents run)
  prune [--days 180] [--dry-run]                  owner only: erase contacts, dossiers, draft text, PDFs and run folders of dead leads (killed / dropped / sent without reply) older than N days
  review                                          terminal UI: approve / edit / kill drafts, open the PDF (interactive)
  auth                                            one-time Gmail sign-in (browser); saves the token outside the repo
  signature                                       fetch your Gmail signature into signature.html (every email needs it)
  tick                                            sync replies, schedule, send what is due (what the 5-minute task runs)
  test-send --run <id> --to <address> [--slug s] [--limit N]  owner only: send the real first email of N drafts (default 1) to YOUR address, subject-marked [TEST], changes no status
  playbook --agent <name> [--remove <n>]          owner only: list or prune what agents learned
`;

class UsageError extends Error {}

function print(value: unknown): void {
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function requireRun(value: string | undefined): RunLayout['runId'] {
  if (!value) throw new UsageError('--run <id> is required');
  return value;
}

function requirePlaybookAgent(value: string | undefined): PlaybookAgent {
  if (!value || !isPlaybookAgent(value)) throw new UsageError('--agent must be researcher, writer, sourcer or verifier');
  return value;
}

function parseWholeNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d{0,5}$/.test(value)) throw new UsageError(`${flag} must be a whole number of at least 1`);
  return Number(value);
}

async function withStore<T>(action: (store: Awaited<ReturnType<typeof openStore>>['store']) => Promise<T>): Promise<T> {
  const { store, close } = await openStore();
  try {
    return await action(store);
  } finally {
    await close();
  }
}

async function runCommand(command: string, argv: string[], context: Context): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      run: { type: 'string' },
      stage: { type: 'string' },
      'no-mx': { type: 'boolean' },
      limit: { type: 'string' },
      days: { type: 'string' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
      all: { type: 'boolean' },
      slug: { type: 'string' },
      to: { type: 'string' },
      agent: { type: 'string' },
      situation: { type: 'string' },
      fix: { type: 'string' },
      remove: { type: 'string' },
    },
  });

  switch (command) {
    case 'ingest': {
      const [file] = positionals;
      if (!file) throw new UsageError('ingest needs the normalized list: ingest <normalized.json> --run <id>');
      const layout = new RunLayout(context.paths, values.run ?? defaultRunId());
      const rows = parseRowsFromText(await readFile(resolve(file), 'utf-8'));
      await appendNormalizedRows(layout, rows);
      const report = await withStore((store) =>
        ingestRows(
          { store, layout, checkMx: (email) => checkEmail(email, { resolveMx: values['no-mx'] ? null : undefined }) },
          rows,
        ),
      );
      print(report);
      return;
    }

    case 'new-run':
      print({ runId: defaultRunId() });
      return;

    case 'ingest-sourced': {
      const layout = new RunLayout(context.paths, requireRun(values.run));
      const limit = parseWholeNumber(values.limit, '--limit');
      print(
        await withStore((store) =>
          ingestSourced({ store, layout, limit, checkMx: (email) => checkEmail(email, { resolveMx: values['no-mx'] ? null : undefined }) }),
        ),
      );
      return;
    }

    case 'hunter': {
      const [domain] = positionals;
      if (!domain) throw new UsageError('hunter needs a domain: hunter <domain> --run <id>');
      const layout = new RunLayout(context.paths, requireRun(values.run));
      print(await runHunter({ layout, domain, apiKey: loadHunterApiKey() }));
      return;
    }

    case 'prepare-verify': {
      const layout = new RunLayout(context.paths, requireRun(values.run));
      const { config, db } = loadConfigAndInventory(context);
      print(await withStore((store) => prepareVerify({ store, layout, config, db })));
      return;
    }

    case 'prune': {
      const days = parseWholeNumber(values.days, '--days') ?? DEFAULT_PRUNE_DAYS;
      print(await withStore((store) => pruneDeadLeads({ store, paths: context.paths, days, dryRun: values['dry-run'] === true })));
      return;
    }

    case 'prepare': {
      const layout = new RunLayout(context.paths, requireRun(values.run));
      const { config, db } = loadConfigAndInventory(context);
      print({ candidateFile: await writeCandidateBrief(layout, config, db) });
      return;
    }

    case 'snapshot': {
      const [url, dir] = positionals;
      if (!url || !dir) throw new UsageError('snapshot needs a URL and a folder: snapshot <url> <dir>');
      // The researcher chooses these arguments after reading untrusted pages; it may only write into a company's snapshots folder.
      if (!isSnapshotDir(context.paths, dir)) throw new UsageError('snapshot folder must be runs/<run>/companies/<slug>/snapshots');
      print(await snapshotUrl(url, resolve(dir)));
      return;
    }

    case 'process': {
      const layout = new RunLayout(context.paths, requireRun(values.run));
      if (values.stage === 'dossier') {
        print(await withStore((store) => processDossiers({ store, layout })));
        return;
      }
      if (values.stage === 'draft') {
        const { config, db } = loadConfigAndInventory(context);
        await assertTrackResumesExist(layout);
        const renderer = createRenderer(context);
        print(await withStore((store) => processDrafts({ store, layout, config, db, renderer })));
        return;
      }
      if (values.stage === 'verify') {
        const { config, db } = loadConfigAndInventory(context);
        print(await withStore((store) => processVerify({ store, layout, config, db })));
        return;
      }
      throw new UsageError('--stage must be dossier, draft or verify');
    }

    case 'pending': {
      const stage = values.stage as PendingStage | undefined;
      if (stage !== 'research' && stage !== 'write' && stage !== 'verify') {
        throw new UsageError('--stage must be research, write or verify');
      }
      const runId = requireRun(values.run);
      print(
        await withStore(async (store) => ({
          runId,
          stage,
          slugs: stage === 'verify' ? await pendingVerifySlugs(store, new RunLayout(context.paths, runId)) : await pendingSlugs(store, runId, stage),
        })),
      );
      return;
    }

    case 'track-resumes': {
      const { config, db } = loadConfigAndInventory(context);
      print(await buildTrackResumes(db, config, context.paths, createRenderer(context)));
      return;
    }

    case 'generic': {
      const layout = new RunLayout(context.paths, requireRun(values.run));
      const { config, db } = loadConfigAndInventory(context);
      await assertTrackResumesExist(layout);
      print(await withStore((store) => processGeneric({ store, layout, config, db })));
      return;
    }

    case 'status':
      print(await withStore((store) => statusText(store)));
      return;

    case 'summary': {
      const runId = requireRun(values.run);
      const sourced = await readSourcedContacts(new RunLayout(context.paths, runId));
      print(await withStore((store) => summaryText(store, runId, sourced)));
      return;
    }

    case 'cost': {
      if (!values.all && !values.run) throw new UsageError('cost needs --run <id> or --all');
      print(await costCommand(context, { runId: values.run, all: values.all === true, json: values.json === true }));
      return;
    }

    case 'preview':
      print(await previewCommand(context, { runId: requireRun(values.run), slug: values.slug, json: values.json === true }));
      return;

    case 'learn':
      print(await learnCommand(context, { agent: requirePlaybookAgent(values.agent), situation: values.situation, fix: values.fix }));
      return;

    case 'playbook':
      print(await playbookCommand(context, { agent: requirePlaybookAgent(values.agent), remove: parseWholeNumber(values.remove, '--remove') }));
      return;

    case 'test-send':
      await testSendCommand(context, {
        runId: requireRun(values.run),
        to: values.to,
        slug: values.slug,
        limit: parseWholeNumber(values.limit, '--limit') ?? 1,
      });
      return;

    case 'review':
      await reviewCommand(context);
      return;

    case 'auth':
      await authCommand(context);
      return;

    case 'signature':
      await signatureCommand(context);
      return;

    case 'tick':
      await tickCommand(context);
      return;

    default:
      throw new UsageError(`unknown command "${command}"`);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }
  try {
    await runCommand(command, rest, createContext());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    if (error instanceof UsageError) console.error(`\n${USAGE}`);
    if (process.env.OUTREACH_DEBUG && error instanceof Error) console.error(error.stack);
    process.exitCode = 1;
  }
}

void main();
