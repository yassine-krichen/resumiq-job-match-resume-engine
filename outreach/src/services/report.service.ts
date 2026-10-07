import { COMPANY_STATUSES } from '../db/outreach-store';
import type { CompanyRecord, CompanyStatus, OutreachStore } from '../db/outreach-store';

import type { SourcedContactNote } from './ingest-sourced.service';

export type StatusCounts = Partial<Record<CompanyStatus, number>>;

function countByStatus(companies: readonly CompanyRecord[]): StatusCounts {
  const counts: StatusCounts = {};
  for (const company of companies) counts[company.status] = (counts[company.status] ?? 0) + 1;
  return counts;
}

function formatCounts(counts: StatusCounts): string {
  const parts = COMPANY_STATUSES.filter((status) => counts[status]).map((status) => `${status} ${counts[status]}`);
  return parts.length > 0 ? parts.join(' | ') : 'no companies';
}

/** Per-run pipeline strip across every run in the DB. */
export async function statusText(store: OutreachStore): Promise<string> {
  const companies = await store.listCompanies();
  const drafts = await store.listLatestDrafts();
  const runs = [...new Set(companies.map((company) => company.runId))];
  if (runs.length === 0) return 'No runs yet. Ingest a list with: npm run outreach -- ingest <normalized.json> --run <id>';

  const lines = runs.map((runId) => {
    const own = companies.filter((company) => company.runId === runId);
    return `${runId}: ${own.length} companies | ${formatCounts(countByStatus(own))}`;
  });
  const generic = drafts.filter((draft) => draft.generic).length;
  lines.push(`drafts: ${drafts.length} (${generic} generic)`);
  return lines.join('\n');
}

export type PendingStage = 'research' | 'write' | 'verify';

/** Slugs the orchestrator still has to hand to an agent; the basis of --resume. */
export async function pendingSlugs(store: OutreachStore, runId: string, stage: 'research' | 'write'): Promise<string[]> {
  const status: CompanyStatus = stage === 'research' ? 'ingested' : 'dossier_ready';
  const companies = await store.listCompanies({ runId, statuses: [status] });
  if (stage === 'research') return companies.map((company) => company.slug);

  // Researched companies with no verified claim take the generic path inside `process --stage draft`, not the writer.
  const result: string[] = [];
  for (const company of companies) {
    const dossier = await store.getLatestDossier(company.id);
    if (dossier && dossier.verifiedClaimCount > 0) result.push(company.slug);
  }
  return result;
}

/** What to tell the user at the end of a run, including everything that needs a human decision. */
export async function summaryText(
  store: OutreachStore,
  runId: string,
  sourcedContacts: readonly SourcedContactNote[] = [],
): Promise<string> {
  const companies = await store.listCompanies({ runId });
  if (companies.length === 0) return `Run ${runId}: no companies.`;
  const drafts = await store.listLatestDrafts(runId);
  const draftOf = new Map(drafts.map((draft) => [draft.companyId, draft]));

  const lines = [`Run ${runId}: ${companies.length} companies`, formatCounts(countByStatus(companies))];
  const tailored = drafts.filter((draft) => !draft.generic).length;
  lines.push(`drafts awaiting review: ${drafts.length} (${tailored} tailored, ${drafts.length - tailored} generic)`);

  const section = (title: string, rows: string[]): void => {
    if (rows.length > 0) lines.push('', `${title}:`, ...rows.map((row) => `  - ${row}`));
  };
  section(
    'Needs your decision',
    companies.filter((c) => c.status === 'needs_manual').map((c) => `${c.name} (${c.slug}): ${c.statusReason ?? ''}`),
  );
  section(
    'Failed',
    companies.filter((c) => c.status === 'failed').map((c) => `${c.name} (${c.slug}): ${c.statusReason ?? ''}`),
  );
  section(
    'Dropped',
    companies.filter((c) => c.status === 'dropped').map((c) => `${c.name}: ${c.statusReason ?? ''}`),
  );
  section(
    'Generic drafts',
    companies.filter((c) => draftOf.get(c.id)?.generic).map((c) => `${c.name} (${c.slug})`),
  );
  // Sourced addresses that were guessed or scored low: worth a look before approving.
  const alive = new Map(companies.filter((c) => c.status !== 'killed' && c.status !== 'dropped').map((c) => [c.slug, c]));
  section(
    'Low-confidence contacts (sourced address was guessed or scored low)',
    sourcedContacts
      .filter((note) => note.contact_confidence === 'low' && alive.has(note.slug))
      .map((note) => `${note.company} <${note.email}> (${note.email_source}, ${alive.get(note.slug)?.status})`),
  );
  section(
    'Not finished (re-run with --resume)',
    companies.filter((c) => c.status === 'ingested' || c.status === 'dossier_ready').map((c) => `${c.name}: ${c.status}`),
  );
  return lines.join('\n');
}
