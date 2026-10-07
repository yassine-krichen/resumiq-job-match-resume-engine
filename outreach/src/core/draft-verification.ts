import type { AppConfig } from '../config/app-config';
import type { MasterDB } from '../resume/master-db';
import { VerifyOutputSchema } from '../schemas/outreach';
import type { OutreachLanguage } from '../schemas/outreach';

import { extractNumbers } from './text-utils';

// Phase 4, the blind verifier. A second agent that never saw the research reads only the finished
// email and the sources it may rest on, and says per sentence whether a source supports it. The
// script decides what the verdicts mean; the agent only judges.

export interface VerifySentence {
  /** Position across the body and then the follow-up, so one verdict list covers both. */
  i: number;
  part: 'body' | 'follow_up';
  text: string;
}

export interface VerifyInput {
  language: OutreachLanguage;
  company: string;
  sentences: VerifySentence[];
  /** Quote-verified claims only. The dossier's notes (one-liner, stack, fit reasons) are never included. */
  verified_claims: Array<{ id: string; text: string; quote: string }>;
  candidate_facts: string[];
  config_lines: string[];
}

export type VerificationIssueReason = 'unsupported' | 'no_source' | 'unknown_source';

export interface VerificationIssue {
  i: number;
  text: string;
  reason: VerificationIssueReason;
}

export type VerificationEvaluation =
  | { status: 'invalid'; errors: string[] }
  | { status: 'ok'; issues: VerificationIssue[] };

// A full stop after these does not end a sentence.
const ABBREVIATION_END = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|approx|dr|mr|mrs|ms|m|mme|mlle|st|no|fig|cf)\.$/i;

/**
 * Splits email text into sentences: after . ! ? or an ellipsis followed by a space, but not after a
 * common abbreviation and not before a lowercase word. Deterministic, so the script and the verifier
 * agree on what "sentence 3" is.
 */
export function splitSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return [];
  const pieces = flat.split(/(?<=[.!?…]["')»”]?)\s+/u);

  const sentences: string[] = [];
  for (const piece of pieces) {
    const previous = sentences[sentences.length - 1];
    const continues = previous !== undefined && (ABBREVIATION_END.test(previous) || /^\p{Ll}/u.test(piece));
    if (continues) sentences[sentences.length - 1] = `${previous} ${piece}`;
    else sentences.push(piece);
  }
  return sentences;
}

export function sentencesOfDraft(body: string, followUpBody: string): VerifySentence[] {
  const tagged = [
    ...splitSentences(body).map((text) => ({ part: 'body' as const, text })),
    ...splitSentences(followUpBody).map((text) => ({ part: 'follow_up' as const, text })),
  ];
  return tagged.map((sentence, i) => ({ i, ...sentence }));
}

function line(label: string, parts: ReadonlyArray<string | undefined>): string {
  const filled = parts.filter((part): part is string => part !== undefined && part.trim() !== '');
  return filled.length > 0 ? `${label}: ${filled.join('; ')}` : '';
}

function list(label: string, values: readonly string[]): string | undefined {
  return values.length > 0 ? `${label} ${values.join(', ')}` : undefined;
}

/**
 * Everything the email may say about the candidate, as short lines. It is built from the data
 * inventory and the config, never from the dossier, and leaves out phone and email.
 */
export function buildCandidateFacts(db: MasterDB, config: AppConfig): string[] {
  const facts: string[] = [];
  if (db.personal_info.location) facts.push(`Based in ${db.personal_info.location}`);
  for (const entry of db.education) {
    facts.push(
      line('Education', [
        [entry.degree_type, entry.major].filter(Boolean).join(' '),
        entry.institution,
        `${entry.startDate} to ${entry.endDate}`,
        list('coursework', entry.relevant_coursework),
        entry.description || undefined,
      ]),
    );
  }
  for (const entry of db.experience) {
    facts.push(
      line('Experience', [
        `${entry.role} at ${entry.company}`,
        `${entry.startDate} to ${entry.endDate}`,
        list('technologies', entry.technologies_used),
        ...entry.raw_achievements,
        list('metrics', entry.quantifiable_metrics),
      ]),
    );
  }
  for (const entry of db.projects) {
    facts.push(
      line('Project', [
        entry.name,
        entry.context || undefined,
        list('technologies', entry.technologies_used),
        ...entry.raw_achievements,
        list('metrics', entry.quantifiable_metrics),
      ]),
    );
  }
  const { skills } = db;
  facts.push(
    line('Skills', [
      list('languages', skills.programming_languages),
      list('frameworks', skills.frameworks_and_libraries),
      list('tools', skills.infrastructure_and_tools),
      list('databases', skills.databases),
      list('spoken', skills.spoken_languages.map((spoken) => `${spoken.language} (${spoken.fluency})`)),
    ]),
  );
  for (const entry of db.certifications) facts.push(line('Certification', [entry.name, entry.issuer || undefined]));
  for (const entry of db.awards_and_honors) {
    facts.push(line('Award', [entry.title, entry.issuer || undefined, entry.description || undefined]));
  }
  for (const entry of db.volunteering_and_leadership) {
    facts.push(line('Volunteering', [`${entry.role} at ${entry.organization}`, entry.description]));
  }
  if (db.interests.length > 0) facts.push(`Interests: ${db.interests.join(', ')}`);
  // The generic email names the focus of the track it was written for.
  for (const rules of Object.values(config.tracks)) facts.push(line('Role focus', [rules.label, rules.summary]));
  return facts.filter((fact) => fact !== '');
}

/** The availability pitch the config dictates: the sentences an email may repeat without a source on the web. */
export function buildConfigLines(config: AppConfig, language: OutreachLanguage): string[] {
  const { availability, hours_per_week, start_date, summer_internship } = config.outreach;
  const lines = availability[language];
  const result = [
    lines.hours_line,
    lines.start_line,
    lines.ask_line,
    lines.overlap.europe,
    lines.overlap.us,
    lines.overlap.other,
    `The candidate can commit about ${hours_per_week} hours a week from ${start_date}`,
  ];
  if (summer_internship.available) {
    const start = summer_internship.start ? ` starting ${summer_internship.start}` : '';
    const minimum = summer_internship.min_weeks ? ` of at least ${summer_internship.min_weeks} weeks` : '';
    result.push(`The candidate is available for a summer internship${start}${minimum}`);
  }
  return result;
}

const NON_CLAIM_SOURCES = ['candidate', 'config'];

/**
 * Turns the verifier's raw output into issues. Unusable output (wrong shape, a sentence without a
 * verdict, an invented or repeated index) is `invalid` so the caller can retry. A sentence is an
 * issue when it states a fact and is unsupported, names no source, or names a source that was not
 * in the input. A sentence the verifier calls "no fact" is still a fact when it holds a number.
 */
export function evaluateVerification(input: VerifyInput, raw: unknown): VerificationEvaluation {
  const parsed = VerifyOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      errors: parsed.error.issues.map((issue) => `verify.json ${issue.path.join('.') || 'file'}: ${issue.message}`),
    };
  }

  const known = new Map(input.sentences.map((sentence) => [sentence.i, sentence]));
  const seen = new Set<number>();
  const errors: string[] = [];
  for (const verdict of parsed.data.sentences) {
    if (!known.has(verdict.i)) errors.push(`verify.json has a verdict for sentence ${verdict.i}, which does not exist`);
    else if (seen.has(verdict.i)) errors.push(`verify.json has two verdicts for sentence ${verdict.i}`);
    seen.add(verdict.i);
  }
  const missing = input.sentences.filter((sentence) => !seen.has(sentence.i)).map((sentence) => sentence.i);
  if (missing.length > 0) errors.push(`verify.json has no verdict for sentence(s) ${missing.join(', ')}`);
  if (errors.length > 0) return { status: 'invalid', errors };

  const allowed = new Set([...input.verified_claims.map((claim) => claim.id), ...NON_CLAIM_SOURCES]);
  const issues: VerificationIssue[] = [];
  for (const verdict of parsed.data.sentences) {
    const sentence = known.get(verdict.i) as VerifySentence;
    const statesFact = verdict.fact || extractNumbers(sentence.text).length > 0;
    if (!statesFact) continue;
    if (!verdict.supported) issues.push({ i: verdict.i, text: sentence.text, reason: 'unsupported' });
    else if (verdict.by === null) issues.push({ i: verdict.i, text: sentence.text, reason: 'no_source' });
    else if (!allowed.has(verdict.by)) issues.push({ i: verdict.i, text: sentence.text, reason: 'unknown_source' });
  }
  return { status: 'ok', issues };
}
