import { checkEmail } from '../core/email-check';
import { emailDomain, normalizeDomain } from '../core/normalize-input';
import { quoteAppearsInSnapshot } from '../core/quote-verifier';
import { contactConfidence, pageQuoteConfidence, quoteContainsEmail } from '../core/sourced-contact';
import type { OutreachStore } from '../db/outreach-store';
import { SourcedCandidateSchema, SourcedCandidatesFileSchema } from '../schemas/outreach';
import type { ContactConfidence, EmailSource, SourcedCandidate } from '../schemas/outreach';

import { HunterFileSchema } from './hunter.service';
import { appendNormalizedRows, ingestRows } from './ingest.service';
import type { IngestReport, MxChecker } from './ingest.service';
import { RunLayout, readJsonFile, writeJsonAtomic } from './run-layout';
import { createManifestSnapshotLoader } from './snapshot.service';

// Phase 3: the sourcer agent writes runs/<id>/sourcing/candidates.json. Nothing in it is trusted:
// a page_quote address must be inside a quote that really is in a saved page, a hunter address must
// be one the hunter command saved, a guessed address needs a domain that accepts mail and is flagged
// low confidence. Whatever passes goes through the normal ingest (dedupe against the DB and the
// suppression list, MX check, insert).

export type SourcedRejection =
  | 'no_email'
  | 'snapshot_missing'
  | 'quote_not_found'
  | 'quote_missing_email'
  | 'hunter_address_unknown'
  | 'pattern_guess_needs_mx_ok'
  | 'over_limit';

export interface SourcedContactNote {
  slug: string;
  company: string;
  email: string;
  email_source: EmailSource;
  contact_confidence: ContactConfidence;
}

export interface IngestSourcedReport {
  runId: string;
  total: number;
  rejected: Array<{ company: string; email?: string; reason: SourcedRejection }>;
  invalid: Array<{ index: number; errors: string[] }>;
  /** The result of the normal ingest for the candidates that passed; null when none did. */
  ingest: IngestReport | null;
  /** Inserted companies with where their address came from. */
  contacts: SourcedContactNote[];
}

export interface IngestSourcedDeps {
  store: OutreachStore;
  layout: RunLayout;
  /** Defaults to a real MX lookup. */
  checkMx?: MxChecker;
  /** Insert at most this many; the rest are reported as over_limit. */
  limit?: number;
}

interface Verified {
  candidate: SourcedCandidate & { email: string; email_source: EmailSource };
  confidence: ContactConfidence;
  evidenceUrl: string | null;
  evidenceQuote: string | null;
}

type Verdict = { ok: true; verified: Verified } | { ok: false; reason: SourcedRejection };

async function verifyQuote(layout: RunLayout, candidate: Verified['candidate']): Promise<Verdict> {
  const evidence = candidate.evidence;
  if (!evidence) return { ok: false, reason: 'snapshot_missing' };
  const record = await createManifestSnapshotLoader(layout.sourcingSnapshotsDir)(evidence.snapshot_id);
  if (record === null) return { ok: false, reason: 'snapshot_missing' };
  if (!quoteAppearsInSnapshot(record.text, evidence.quote)) return { ok: false, reason: 'quote_not_found' };
  if (!quoteContainsEmail(evidence.quote, candidate.email)) return { ok: false, reason: 'quote_missing_email' };
  return {
    ok: true,
    verified: { candidate, confidence: pageQuoteConfidence({ email: candidate.email, pageUrls: [record.url, record.finalUrl ?? record.url], website: candidate.website }), evidenceUrl: record.url, evidenceQuote: evidence.quote },
  };
}

async function verifyHunter(layout: RunLayout, candidate: Verified['candidate']): Promise<Verdict> {
  const domain = normalizeDomain(emailDomain(candidate.email));
  if (domain === null) return { ok: false, reason: 'hunter_address_unknown' };
  const read = await readJsonFile(layout.hunterFile(domain));
  const parsed = read.status === 'ok' ? HunterFileSchema.safeParse(read.value) : null;
  const entry = parsed?.success ? parsed.data.emails.find((item) => item.email === candidate.email) : undefined;
  if (!entry) return { ok: false, reason: 'hunter_address_unknown' };
  return { ok: true, verified: { candidate, confidence: contactConfidence('hunter', entry.confidence), evidenceUrl: null, evidenceQuote: null } };
}

async function verifyGuess(candidate: Verified['candidate'], checkMx: MxChecker): Promise<Verdict> {
  const check = await checkMx(candidate.email);
  if (!check.syntaxValid || check.mx !== 'ok') return { ok: false, reason: 'pattern_guess_needs_mx_ok' };
  return { ok: true, verified: { candidate, confidence: contactConfidence('pattern_guess'), evidenceUrl: null, evidenceQuote: null } };
}

async function verifyContact(layout: RunLayout, candidate: SourcedCandidate, checkMx: MxChecker): Promise<Verdict> {
  if (candidate.email === undefined || candidate.email_source === undefined) return { ok: false, reason: 'no_email' };
  const checked = { ...candidate, email: candidate.email.toLowerCase(), email_source: candidate.email_source };
  if (checked.email_source === 'page_quote') return verifyQuote(layout, checked);
  if (checked.email_source === 'hunter') return verifyHunter(layout, checked);
  return verifyGuess(checked, checkMx);
}

function toRow(verified: Verified): Record<string, unknown> {
  const { candidate } = verified;
  return {
    company: candidate.company,
    email: candidate.email,
    name: candidate.contact_name,
    role: candidate.contact_role,
    website: candidate.website,
    notes: candidate.why,
  };
}

/** Adds the sourcing facts to the company's input.json, which the researcher and the report read. */
async function addSourcingFacts(layout: RunLayout, slug: string, verified: Verified): Promise<void> {
  const path = layout.companyFile(slug, 'input');
  const read = await readJsonFile(path);
  const input = read.status === 'ok' && typeof read.value === 'object' && read.value !== null ? (read.value as Record<string, unknown>) : {};
  await writeJsonAtomic(path, {
    ...input,
    source: 'sourced',
    email_source: verified.candidate.email_source,
    contact_confidence: verified.confidence,
    why: verified.candidate.why,
    ...(verified.evidenceUrl === null ? {} : { evidence: { url: verified.evidenceUrl, quote: verified.evidenceQuote } }),
  });
}

async function appendSourcingReport(layout: RunLayout, report: IngestSourcedReport): Promise<void> {
  const existing = await readJsonFile(layout.sourcingReportFile);
  const earlier =
    existing.status === 'ok' && Array.isArray((existing.value as { reports?: unknown }).reports)
      ? (existing.value as { reports: unknown[] }).reports
      : [];
  await writeJsonAtomic(layout.sourcingReportFile, { reports: [...earlier, report] });
}

/** Companies inserted by earlier `ingest-sourced` calls of this run, with where their address came from. */
export async function readSourcedContacts(layout: RunLayout): Promise<SourcedContactNote[]> {
  const read = await readJsonFile(layout.sourcingReportFile);
  if (read.status !== 'ok') return [];
  const reports = (read.value as { reports?: Array<{ contacts?: SourcedContactNote[] }> }).reports;
  return Array.isArray(reports) ? reports.flatMap((report) => report.contacts ?? []) : [];
}

export async function ingestSourced(deps: IngestSourcedDeps): Promise<IngestSourcedReport> {
  const { store, layout } = deps;
  const checkMx = deps.checkMx ?? ((email: string) => checkEmail(email));

  const file = await readJsonFile(layout.sourcingCandidatesFile);
  if (file.status === 'missing') {
    throw new Error(`runs/${layout.runId}/sourcing/candidates.json does not exist: the sourcer has not written it`);
  }
  if (file.status === 'invalid') throw new Error(`candidates.json is ${file.error}`);
  const parsedFile = SourcedCandidatesFileSchema.safeParse(file.value);
  if (!parsedFile.success) throw new Error('candidates.json must be {"candidates": [ ... ]}');

  const report: IngestSourcedReport = { runId: layout.runId, total: parsedFile.data.candidates.length, rejected: [], invalid: [], ingest: null, contacts: [] };
  const accepted: Verified[] = [];
  for (const [index, raw] of parsedFile.data.candidates.entries()) {
    const parsed = SourcedCandidateSchema.safeParse(raw);
    if (!parsed.success) {
      report.invalid.push({ index, errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'candidate'}: ${issue.message}`) });
      continue;
    }
    const verdict = await verifyContact(layout, parsed.data, checkMx);
    if (verdict.ok) accepted.push(verdict.verified);
    else report.rejected.push({ company: parsed.data.company, ...(parsed.data.email ? { email: parsed.data.email } : {}), reason: verdict.reason });
  }

  const kept = deps.limit === undefined ? accepted : accepted.slice(0, deps.limit);
  for (const verified of accepted.slice(kept.length)) {
    report.rejected.push({ company: verified.candidate.company, email: verified.candidate.email, reason: 'over_limit' });
  }

  if (kept.length > 0) {
    const rows = kept.map(toRow);
    await appendNormalizedRows(layout, rows);
    const sourcedContacts = new Map(
      kept.map((item) => [item.candidate.email, { emailSource: item.candidate.email_source, contactConfidence: item.confidence }] as const),
    );
    report.ingest = await ingestRows({ store, layout, checkMx, sourcedContacts }, rows);
    for (const inserted of report.ingest.inserted) {
      const verified = kept.find((item) => item.candidate.email === inserted.email);
      if (!verified) continue;
      await addSourcingFacts(layout, inserted.slug, verified);
      const company = await store.getCompanyBySlug(inserted.slug);
      const note: SourcedContactNote = {
        slug: inserted.slug,
        company: inserted.company,
        email: inserted.email,
        email_source: verified.candidate.email_source,
        contact_confidence: verified.confidence,
      };
      report.contacts.push(note);
      if (company) await store.recordEvent(company.id, 'contact.sourced', { email_source: note.email_source, contact_confidence: note.contact_confidence });
    }
  }

  await appendSourcingReport(layout, report);
  await store.recordEvent(null, 'sourcing.ingested', {
    runId: layout.runId,
    inserted: report.contacts.length,
    rejected: report.rejected.length,
    invalid: report.invalid.length,
  });
  return report;
}
