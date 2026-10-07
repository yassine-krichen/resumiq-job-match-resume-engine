import { z } from 'zod';

// ── Outreach feature schemas (see docs/outreach/SPEC.md) ────────────────────
// Every LLM/agent-written payload in the outreach pipeline is validated with
// these before it reaches the DB or the sender.

/** The agent may write "" or null for a field it has nothing for. */
function optionalText(max: number): z.ZodType<string | undefined, z.ZodTypeDef, unknown> {
  return z.preprocess(
    (value) => (value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value),
    z.string().trim().max(max).optional(),
  );
}

// `Intl` is the cheapest dependency-free IANA check. Abbreviations such as
// "EST" are accepted by Intl but are not DST-aware zones, so require a region
// segment ("Europe/Paris") or "UTC".
function isIanaTimeZone(value: string): boolean {
  if (value !== 'UTC' && !value.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimezoneSchema = z.string().trim().refine(isIanaTimeZone, 'must be an IANA timezone such as Europe/Paris');
const CountrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 country code');

export const OutreachLanguageSchema = z.enum(['en', 'fr']);
export const OutreachTrackSchema = z.enum(['ai', 'swe', 'fullstack']);
// Gmail API only: the uni mailbox is Google Workspace and the fallback account is
// personal Gmail, which is the same provider with a different OAuth login.
export const OutreachProviderSchema = z.enum(['gmail']);

// ── Input ───────────────────────────────────────────────────────────────────

export const OutreachInputRowSchema = z.object({
  company: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  name: optionalText(200),
  role: optionalText(200),
  website: optionalText(300),
  notes: optionalText(1000),
});

export const OutreachNormalizedListSchema = z.object({
  rows: z.array(OutreachInputRowSchema).max(2000),
});

// ── Sourcing (phase 3) ──────────────────────────────────────────────────────

export const EmailSourceSchema = z.enum(['page_quote', 'pattern_guess', 'hunter']);

// Where on a saved page the address was read. The ingest script checks that the quote is in the snapshot and
// contains the address; the snapshot id only counts if the run's manifest lists it.
export const SourcedEvidenceSchema = z.object({
  snapshot_id: z.string().trim().min(1).max(128),
  quote: z.string().trim().min(8).max(300),
});

export const SourcedCandidateSchema = z
  .object({
    company: z.string().trim().min(1).max(200),
    website: z.string().trim().min(1).max(300),
    // One line on why it matches the criteria.
    why: z.string().trim().min(1).max(500),
    contact_name: optionalText(200),
    contact_role: optionalText(200),
    email: z.preprocess(
      (value) => (value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value),
      z.string().trim().email().max(254).optional(),
    ),
    email_source: z.preprocess((value) => (value === null ? undefined : value), EmailSourceSchema.optional()),
    evidence: z.preprocess((value) => (value === null ? undefined : value), SourcedEvidenceSchema.optional()),
  })
  .superRefine((candidate, ctx) => {
    if (candidate.email !== undefined && candidate.email_source === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email_source'], message: 'an email needs an email_source' });
    }
    if (candidate.email_source === 'page_quote' && candidate.evidence === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence'], message: 'a page_quote email needs evidence (snapshot_id and quote)' });
    }
  });

// Rows are validated one by one by the ingest script, so one bad candidate never loses the list.
export const SourcedCandidatesFileSchema = z.object({ candidates: z.array(z.unknown()).max(200) });

export const ContactConfidenceSchema = z.enum(['normal', 'low']);

// ── Verification (phase 4) ──────────────────────────────────────────────────

// The blind verifier's answer for one draft: a verdict per sentence of the body and the follow-up.
export const VerifySentenceVerdictSchema = z.object({
  i: z.number().int().min(0),
  supported: z.boolean(),
  // A verified claim id, or "candidate" (the candidate facts given) or "config" (the availability lines given).
  by: z.preprocess((value) => (value === undefined ? null : value), z.string().trim().min(1).max(40).nullable()),
  // False for greetings, thanks, the question itself and other sentences that state no fact. Missing means true.
  fact: z.boolean().default(true),
});

export const VerifyOutputSchema = z.object({
  sentences: z.array(VerifySentenceVerdictSchema).min(1).max(60),
});

// ── Dossier ─────────────────────────────────────────────────────────────────

export const OutreachClaimSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, 'claim id must be 1-40 chars of [A-Za-z0-9_-]'),
  text: z.string().trim().min(1).max(500),
  url: z
    .string()
    .trim()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL'),
  snapshot_id: z.string().trim().min(1).max(128),
  // Verbatim excerpt of the saved snapshot; the quote verifier drops the
  // claim if the text is not really there.
  quote: z.string().trim().min(20).max(300),
});

export const OutreachFitSchema = z.object({
  score: z.number().int().min(1).max(5),
  reasons: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  track: OutreachTrackSchema,
});

export const OutreachDossierSchema = z
  .object({
    company: z.string().trim().min(1).max(200),
    one_liner: optionalText(300),
    hq_city: optionalText(100),
    contact_name: optionalText(200),
    // Technologies the company is known to use; the bullet guard treats any of
    // them as foreign unless the profile really lists it.
    tech_stack: z.array(z.string().trim().min(1).max(100)).max(40).default([]),
    country: CountrySchema,
    language: OutreachLanguageSchema,
    timezone: TimezoneSchema,
    claims: z.array(OutreachClaimSchema).max(30),
    fit: OutreachFitSchema,
  })
  .superRefine((dossier, ctx) => {
    const seen = new Set<string>();
    dossier.claims.forEach((claim, index) => {
      if (seen.has(claim.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['claims', index, 'id'],
          message: `duplicate claim id "${claim.id}"`,
        });
      }
      seen.add(claim.id);
    });
  });

// ── Tailoring ───────────────────────────────────────────────────────────────

export const OutreachTailoredBulletSchema = z.object({
  text: z.string().trim().min(10).max(300),
  // Name of the data_inventory entry (company for experience, name for
  // project) this bullet was rewritten from; bullet-guard checks the
  // numbers and technologies against it.
  source_entry: z.string().trim().min(1).max(200),
});

export const OutreachTailoredEntrySchema = z.object({
  kind: z.enum(['experience', 'project']),
  name: z.string().trim().min(1).max(200),
  bullets: z.array(OutreachTailoredBulletSchema).min(1).max(4),
});

export const OutreachTailoredSkillsSchema = z.object({
  programming_languages: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  frameworks_and_libraries: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  infrastructure_and_tools: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  databases: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
});

export const OutreachTailoringSchema = z
  .object({
    summary: z.string().trim().min(20).max(500),
    entries: z.array(OutreachTailoredEntrySchema).min(2).max(4),
    skills: OutreachTailoredSkillsSchema,
  })
  .superRefine((tailoring, ctx) => {
    const seen = new Set<string>();
    tailoring.entries.forEach((entry, index) => {
      const key = `${entry.kind}:${entry.name.toLowerCase()}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'name'],
          message: `duplicate entry "${entry.name}"`,
        });
      }
      seen.add(key);
      if (entry.kind === 'project' && entry.bullets.length > 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'bullets'],
          message: 'a project has at most 3 bullets',
        });
      }
    });
  });

// ── Draft ───────────────────────────────────────────────────────────────────

export const OutreachDraftSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(3000),
    follow_up_body: z.string().trim().min(1).max(2000),
    // A follow-up that states a fact about the company cites its claim; the critic requires it to be a verified one.
    follow_up_claim_id: z.string().trim().min(1).max(40).nullable().optional(),
    cta: z.string().trim().min(1).max(300),
    // Generic drafts have no verified hook, so both are null for them.
    hook_claim_id: z.string().trim().min(1).max(40).nullable(),
    anchor_phrase: z.string().trim().min(1).max(300).nullable(),
    mentioned_projects: z.array(z.string().trim().min(1).max(200)).max(5),
    generic: z.boolean(),
  })
  .superRefine((draft, ctx) => {
    if (draft.generic) return;
    if (draft.hook_claim_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hook_claim_id'],
        message: 'a non-generic draft needs a hook_claim_id',
      });
    }
    if (draft.anchor_phrase === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchor_phrase'],
        message: 'a non-generic draft needs an anchor_phrase',
      });
    }
  });

// ── Config ──────────────────────────────────────────────────────────────────

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24h)');

// The critic requires the hours, start and overlap lines to appear in the email
// body verbatim, so the availability pitch is deterministic instead of whatever
// the writer invents. `ask_line` is the suggested one-sentence ask (part-time now
// or the summer internship); the critic only checks that the internship is
// mentioned, so the writer may rephrase it.
export const OutreachAvailabilityLinesSchema = z.object({
  hours_line: z.string().trim().min(1).max(200),
  start_line: z.string().trim().min(1).max(200),
  ask_line: z.string().trim().min(1).max(300),
  overlap: z.object({
    europe: z.string().trim().min(1).max(200),
    us: z.string().trim().min(1).max(200),
    other: z.string().trim().min(1).max(200),
  }),
});

export const OutreachConfigSchema = z
  .object({
    hours_per_week: z.number().int().min(1).max(40),
    start_date: DateOnlySchema,
    // Mandatory full-time internship for the degree; dates and duration are
    // optional because the program may not have published them yet.
    summer_internship: z.object({
      available: z.boolean(),
      start: DateOnlySchema.optional(),
      min_weeks: z.number().int().min(1).max(52).optional(),
    }),
    availability: z.object({
      en: OutreachAvailabilityLinesSchema,
      fr: OutreachAvailabilityLinesSchema,
    }),
    daily_cap: z.number().int().min(1).max(30),
    // Cap for the first 7 days after the first send (SPEC section 7); defaults to 20 where it is read.
    daily_cap_week1: z.number().int().min(1).max(30).optional(),
    // The mailbox the Gmail token belongs to; `auth`, `signature` and `tick` refuse to run without it.
    sender_email: z.string().trim().email().max(254).optional(),
    gap_min_minutes: z.number().min(1).max(60).default(4),
    gap_max_minutes: z.number().min(1).max(120).default(11),
    send_window: z
      .object({ start: ClockTimeSchema, end: ClockTimeSchema })
      .default({ start: '08:30', end: '10:30' }),
    follow_up_business_days: z.number().int().min(1).max(14).default(5),
    sender_name: z.string().trim().min(1).max(100),
    provider: OutreachProviderSchema,
  })
  .superRefine((config, ctx) => {
    if (config.gap_min_minutes > config.gap_max_minutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gap_max_minutes'],
        message: 'gap_max_minutes must be >= gap_min_minutes',
      });
    }
    if (config.send_window.start >= config.send_window.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['send_window', 'end'],
        message: 'send window end must be after start',
      });
    }
  });

export type OutreachLanguage = z.infer<typeof OutreachLanguageSchema>;
export type OutreachTrack = z.infer<typeof OutreachTrackSchema>;
export type OutreachProvider = z.infer<typeof OutreachProviderSchema>;
export type OutreachInputRow = z.infer<typeof OutreachInputRowSchema>;
export type OutreachNormalizedList = z.infer<typeof OutreachNormalizedListSchema>;
export type EmailSource = z.infer<typeof EmailSourceSchema>;
export type SourcedCandidate = z.infer<typeof SourcedCandidateSchema>;
export type ContactConfidence = z.infer<typeof ContactConfidenceSchema>;
export type VerifyOutput = z.infer<typeof VerifyOutputSchema>;
export type OutreachClaim = z.infer<typeof OutreachClaimSchema>;
export type OutreachFit = z.infer<typeof OutreachFitSchema>;
export type OutreachDossier = z.infer<typeof OutreachDossierSchema>;
export type OutreachTailoredBullet = z.infer<typeof OutreachTailoredBulletSchema>;
export type OutreachTailoredEntry = z.infer<typeof OutreachTailoredEntrySchema>;
export type OutreachTailoring = z.infer<typeof OutreachTailoringSchema>;
export type OutreachDraft = z.infer<typeof OutreachDraftSchema>;
export type OutreachAvailabilityLines = z.infer<typeof OutreachAvailabilityLinesSchema>;
export type OutreachConfig = z.infer<typeof OutreachConfigSchema>;
