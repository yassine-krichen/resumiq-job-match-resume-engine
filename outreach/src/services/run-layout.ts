import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { OutreachPaths } from '../config/paths';

// File contract between the agent and the scripts (see CLAUDE.md):
//
//   runs/<runId>/normalized.json                     copy of the list `ingest` was given
//   runs/<runId>/candidate.json                      written by `prepare`: the candidate facts the agents may use
//   runs/<runId>/companies/<slug>/input.json         written by `ingest`
//   runs/<runId>/companies/<slug>/snapshots/         written by `snapshot` (manifest.json + <sha1>.txt/.meta.json)
//   runs/<runId>/companies/<slug>/dossier.json       written by the researcher agent (raw: may hold claims that fail verification)
//   runs/<runId>/companies/<slug>/dossier.verified.json  written by `process --stage dossier`: the stored dossier, verified claims only; the writer reads only this
//   runs/<runId>/companies/<slug>/tailoring.json     written by the writer agent
//   runs/<runId>/companies/<slug>/draft.json         written by the writer agent
//   runs/<runId>/companies/<slug>/critic.json        written by `process` when a stage fails (feedback for the retry)
//   runs/<runId>/companies/<slug>/verify-input.json  written by `prepare-verify`: the draft sentences plus the sources they may rest on; the blind verifier reads only this
//   runs/<runId>/companies/<slug>/verify.json        written by the verifier agent: one verdict per sentence
//   runs/<runId>/companies/<slug>/verify-report.json written by `process --stage verify`: the outcome for one draft
//   runs/<runId>/companies/<slug>/verify-errors.json written by `process --stage verify`: attempt count and feedback when verify.json was unusable
//   runs/<runId>/sourcing/candidates.json            written by the sourcer agent (phase 3)
//   runs/<runId>/sourcing/snapshots/                 written by `snapshot`: the pages the sourced emails were quoted from
//   runs/<runId>/sourcing/hunter/<domain>.json       written by `hunter` (optional, needs HUNTER_API_KEY)
//   runs/<runId>/sourcing/ingest-sourced.json        written by `ingest-sourced`: what was inserted and why the rest was not

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidRunId(value: string): boolean {
  return RUN_ID.test(value) && !value.includes('..');
}

/** Default run id: run-YYYYMMDD-HHMM (UTC). */
export function defaultRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  return `run-${stamp}`;
}

/**
 * Folder name for a company. The hash suffix keeps "acme.com.fr" and
 * "acme-com.fr" (same readable part) from colliding.
 */
export function slugForDomainKey(domainKey: string): string {
  const readable = domainKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const hash = createHash('sha1').update(domainKey.toLowerCase()).digest('hex').slice(0, 6);
  return `${readable || 'company'}-${hash}`;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await rename(temp, path);
}

export type JsonRead = { status: 'missing' } | { status: 'invalid'; error: string } | { status: 'ok'; value: unknown };

export async function readJsonFile(path: string): Promise<JsonRead> {
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
  try {
    return { status: 'ok', value: JSON.parse(text.replace(/^﻿/, '')) };
  } catch (error) {
    return { status: 'invalid', error: `not valid JSON: ${(error as Error).message}` };
  }
}

/** Where one run keeps its files. */
export class RunLayout {
  readonly runDir: string;

  constructor(
    readonly paths: OutreachPaths,
    readonly runId: string,
  ) {
    if (!isValidRunId(runId)) {
      throw new Error(`Invalid run id "${runId}": use letters, digits, ".", "_" or "-" (max 64 chars)`);
    }
    this.runDir = join(paths.runsDir, runId);
  }

  get normalizedFile(): string {
    return join(this.runDir, 'normalized.json');
  }

  get candidateFile(): string {
    return join(this.runDir, 'candidate.json');
  }

  get ingestReportFile(): string {
    return join(this.runDir, 'ingest-report.json');
  }

  companyDir(slug: string): string {
    return join(this.runDir, 'companies', slug);
  }

  snapshotsDir(slug: string): string {
    return join(this.companyDir(slug), 'snapshots');
  }

  companyFile(
    slug: string,
    name:
      | 'input'
      | 'dossier'
      | 'dossier.verified'
      | 'tailoring'
      | 'draft'
      | 'critic'
      | 'dossier-errors'
      | 'verify-input'
      | 'verify'
      | 'verify-report'
      | 'verify-errors',
  ): string {
    return join(this.companyDir(slug), `${name}.json`);
  }

  get sourcingDir(): string {
    return join(this.runDir, 'sourcing');
  }

  get sourcingCandidatesFile(): string {
    return join(this.sourcingDir, 'candidates.json');
  }

  get sourcingSnapshotsDir(): string {
    return join(this.sourcingDir, 'snapshots');
  }

  get sourcingReportFile(): string {
    return join(this.sourcingDir, 'ingest-sourced.json');
  }

  /** `domain` must already be a normalized host (see normalizeDomain): it becomes a file name. */
  hunterFile(domain: string): string {
    return join(this.sourcingDir, 'hunter', `${domain}.json`);
  }

  /** Storage folder of one company's generated resumes, relative to outreach/. */
  storageDir(slug: string): string {
    return join(this.paths.storageDir, this.runId, slug);
  }
}

export function trackResumePath(paths: OutreachPaths, track: string): string {
  return join(paths.storageDir, 'tracks', `${track}.pdf`);
}

/** Path relative to outreach/, with forward slashes, as stored in the DB. */
export function relativeToRoot(paths: OutreachPaths, absolute: string): string {
  return relative(paths.root, absolute).split(sep).join('/');
}

/** True when `candidate` is `parent` or inside it (after resolving "..", so a crafted path cannot escape). */
export function isInside(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

const SNAPSHOT_DIR_SHAPE =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/(?:companies\/[a-z0-9][a-z0-9-]{0,79}|sourcing)\/snapshots$/;

/**
 * True only for runs/<runId>/companies/<slug>/snapshots or runs/<runId>/sourcing/snapshots.
 * The researcher and the sourcer pick the folder argument of the snapshot command after reading
 * untrusted pages, so they may write nowhere else.
 */
export function isSnapshotDir(paths: OutreachPaths, dir: string): boolean {
  const rel = relative(paths.runsDir, resolve(dir));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  return SNAPSHOT_DIR_SHAPE.test(rel.split(sep).join('/'));
}
