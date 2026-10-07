import { z } from 'zod';

// ── Career Profile Schemas ──────────────────────────────────────────────────

/**
 * Budget-tier LLM extraction (observed live with `gemini-3.5-flash-lite` via
 * freellmapi, the pinned onboarding-ingest model) frequently emits an
 * explicit `null` for a field it has no info for, rather than omitting the
 * key (e.g. `"issuer": null`, `"location": null`). Zod's `.optional()` /
 * `.default()` only activate on a *missing* key, not an explicit `null`, so
 * a single stray null field rejected an otherwise well-formed entry outright
 * — `IngestEntrySchema.safeParse()` in `parseCareerText` then silently
 * dropped the whole entry, not just the null field (observed: 8 of 9
 * correctly-extracted entries dropped over exactly this in one real paste).
 * Strip null-valued keys before validating each entry object so
 * `.optional()` / `.default()` behave as the field declarations intend.
 */
function withNullKeysStripped<T extends z.ZodTypeAny>(schema: T): z.ZodType<z.output<T>> {
  return z.preprocess((val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).filter(([, v]) => v !== null),
      );
    }
    return val;
  }, schema) as z.ZodType<z.output<T>>;
}

export const PersonalInfoSchema = z.object({
  name: z.string().min(1),
  location: z.string(),
  phone: z.string(),
  email: z.string().email(),
  work_authorization: z.array(z.string()).max(10),
  clearances: z.array(z.string()).max(10),
  links: z.array(z.object({ platform: z.string(), url: z.string().url() })).max(20),
});

// The `*Shape` object schemas below are the single source of truth for both
// the strict, shared schemas (`ExperienceEntrySchema` etc. — used by
// `MasterDBSchema`/`POST /profile/import`/`ProfileService.mutateSectionEntry`,
// which must stay at least as strict as before) and the onboarding-ingest
// path (further below), which layers lenient coercion of the AI's common
// shape drift *on top of* these same shapes rather than relaxing the shapes
// themselves. A shared shape only carries a relaxation here when it's a
// deliberate, harmless one that also makes sense for a human-edited/imported
// payload — e.g. `.default([])` on a genuinely optional list field so an
// omitted array doesn't fail validation.

const ExperienceEntryShape = z.object({
  company: z.string().min(1).max(200),
  // Frequently absent/unknown from casual raw-text extraction — default to
  // '' rather than require the LLM to fabricate or omit them, which would
  // otherwise fail validation and silently drop the whole entry (same
  // pattern as CertificationSchema below).
  company_industry: z.string().max(200).default(''),
  role: z.string().min(1).max(200),
  location: z.string().max(200).default(''),
  location_type: z.string().max(100).default(''),
  startDate: z.string().max(50),
  endDate: z.string().max(50),
  isCurrent: z.boolean(),
  // These are genuinely optional facts a caller may have no info for (e.g. a
  // role with no explicit "competencies" list) — defaulted to `[]` rather
  // than required, a deliberate relaxation from a bare required array.
  core_competencies: z.array(z.string()).max(30).default([]),
  technologies_used: z.array(z.string()).max(50).default([]),
  raw_achievements: z.array(z.string()).max(30).default([]),
  quantifiable_metrics: z.array(z.string()).max(30).default([]),
});
export const ExperienceEntrySchema = withNullKeysStripped(ExperienceEntryShape);

const ProjectEntryShape = z.object({
  name: z.string().min(1).max(200),
  context: z.string().max(2000).default(''),
  links: z.array(z.object({ type: z.string(), url: z.string() })).max(10).default([]),
  startDate: z.string().max(50),
  endDate: z.string().max(50),
  // See the same-named fields on `ExperienceEntryShape` above — optional
  // facts a caller legitimately has nothing for, rather than a required
  // field.
  technologies_used: z.array(z.string()).max(50).default([]),
  raw_achievements: z.array(z.string()).max(30).default([]),
  quantifiable_metrics: z.array(z.string()).max(30).default([]),
});
export const ProjectEntrySchema = withNullKeysStripped(ProjectEntryShape);

const EducationEntryShape = z.object({
  institution: z.string().min(1).max(200),
  // Frequently absent/unknown from casual raw-text extraction — default to
  // '' rather than require the LLM to fabricate or omit it, which would
  // otherwise fail validation and silently drop the whole entry (same
  // pattern as CertificationSchema below).
  degree_type: z.string().max(100).default(''),
  major: z.string().min(1).max(200),
  minor: z.string().max(200).default(''),
  location: z.string().max(200).default(''),
  startDate: z.string().max(50),
  endDate: z.string().max(50),
  gpa: z.string().max(20),
  // See the same-named fields on `ExperienceEntryShape` above — optional
  // facts a caller legitimately has nothing for, rather than a required
  // field.
  honors: z.array(z.string()).max(20).default([]),
  relevant_coursework: z.array(z.string()).max(30).default([]),
  thesis_or_capstone: z.string().max(500).default(''),
  extracurriculars: z.array(z.string()).max(20).default([]),
  description: z.string().max(5000).default(''),
});
export const EducationEntrySchema = withNullKeysStripped(EducationEntryShape);

export const SkillsSchema = z.object({
  programming_languages: z.array(z.string()).max(150),
  frameworks_and_libraries: z.array(z.string()).max(200),
  infrastructure_and_tools: z.array(z.string()).max(200),
  databases: z.array(z.string()).max(100),
  spoken_languages: z
    .array(z.object({ language: z.string(), fluency: z.string(), note: z.string().optional() }))
    .max(20),
  soft_skills: z.array(z.string()).max(100),
});

const CertificationShape = z.object({
  name: z.string().min(1).max(200),
  // Frequently absent/unknown from casual raw-text extraction — default to
  // '' rather than require the LLM to fabricate or omit it, which would
  // otherwise fail validation and silently drop the whole entry (same
  // pattern as the fields below).
  issuer: z.string().max(200).default(''),
  // Frequently absent from casual raw-text extraction (the user rarely
  // states an exact certification date) — default to '' like the fields
  // below rather than require the LLM to fabricate or omit it, which
  // would otherwise fail validation and silently drop the whole entry.
  date: z.string().max(50).default(''),
  // These are frequently absent from casual raw-text extraction (the user
  // rarely states an expiration date, credential ID, or verification link)
  // — default to '' rather than require the LLM to fabricate or omit them,
  // which would otherwise fail validation and silently drop the whole entry.
  expiration_date: z.string().max(50).default(''),
  credential_id: z.string().max(200).default(''),
  link: z.string().max(2000).default(''),
  description: z.string().max(5000).default(''),
});
export const CertificationSchema = withNullKeysStripped(CertificationShape);

const AwardShape = z.object({
  title: z.string().min(1).max(200),
  // Frequently absent/unknown from casual raw-text extraction — default to
  // '' rather than require the LLM to fabricate or omit them, which would
  // otherwise fail validation and silently drop the whole entry (same
  // pattern as CertificationSchema above).
  issuer: z.string().max(200).default(''),
  date: z.string().max(50).default(''),
  description: z.string().max(5000).default(''),
  related_skills: z.array(z.string()).max(20).optional(),
});
export const AwardSchema = withNullKeysStripped(AwardShape);

const SummaryEntryShape = z.object({
  target_role: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
});
export const SummaryEntrySchema = withNullKeysStripped(SummaryEntryShape);

const PublicationEntryShape = z.object({
  title: z.string().min(1).max(200),
  venue: z.string().max(200).optional(),
  date: z.string().max(50).default(''),
  url: z.string().max(2000).optional(),
  description: z.string().max(5000).optional(),
});
export const PublicationEntrySchema = withNullKeysStripped(PublicationEntryShape);

const VolunteeringEntryShape = z.object({
  organization: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  location: z.string().max(200).optional(),
  // Frequently absent/unknown from casual raw-text extraction — relax to
  // optional (same pattern as the sibling fields below) rather than
  // require the LLM to fabricate or omit it, which would otherwise fail
  // validation and silently drop the whole entry.
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  isCurrent: z.boolean().optional(),
  description: z.string().max(5000).optional(),
});
export const VolunteeringEntrySchema = withNullKeysStripped(VolunteeringEntryShape);

// A single interest is a short freeform tag (e.g. "Competitive Programming")
// — same bound as other short label fields (Award.title, Certification.name).
export const InterestEntrySchema = z.string().min(1).max(200);

export const MasterDBSchema = z.object({
  personal_info: PersonalInfoSchema,
  summaries: z.array(SummaryEntrySchema).max(10),
  experience: z.array(ExperienceEntrySchema).max(50),
  education: z.array(EducationEntrySchema).max(20),
  projects: z.array(ProjectEntrySchema).max(50),
  skills: SkillsSchema,
  certifications: z.array(CertificationSchema).max(50),
  awards_and_honors: z.array(AwardSchema).max(50),
  publications_and_speaking: z.array(PublicationEntrySchema).max(50),
  volunteering_and_leadership: z.array(VolunteeringEntrySchema).max(30),
  interests: z.array(InterestEntrySchema).max(50),
});

// ── API Request/Response Schemas ────────────────────────────────────────────

export const CreateJobSchema = z.object({
  raw_jd: z
    .string()
    .min(50, 'Job description too short')
    .max(20000, 'Job description is too long — trim it to under 20,000 characters'),
  company_info: z.string().optional(),
  pages: z.union([z.literal(1), z.literal(2)]).default(2),
  source_url: z.string().url().optional(),
  title: z.string().optional(),
  company_name: z.string().optional(),
  location: z.string().optional(),
  remote: z.boolean().optional(),
  salary_range: z.string().optional(),
});

export const UpdateCareerProfileSchema = MasterDBSchema.partial();

// Array-shaped `MasterDB` sections that the profile UI's manual add/edit/
// delete-entry controls operate on (mirrors `ArraySectionKey` in
// `use-profile-section.ts` — every key here has an array value in
// `MasterDBSchema`, `skills`/`personal_info` are deliberately excluded).
export const ProfileArraySectionSchema = z.enum([
  'summaries',
  'experience',
  'education',
  'projects',
  'certifications',
  'awards_and_honors',
  'publications_and_speaking',
  'volunteering_and_leadership',
  'interests',
]);

/**
 * Body of `PATCH /profile/entries` — a single add/update/remove operation on
 * one entry of an array-shaped profile section. Validated for *shape* only
 * here (section/operation/index); the `entry` payload itself is validated
 * against the section's own per-entry schema server-side, as part of
 * re-validating the full merged `MasterDB` document after the mutation is
 * applied (see `ProfileService#mutateSectionEntry`) — the same
 * read-fresh-then-write-once-inside-the-lock pattern `mergeSection` already
 * uses, so overlapping requests can no longer silently drop each other's
 * entry the way the old client-computed-full-array `PATCH /profile` did.
 *
 * `update`/`remove` additionally carry `expectedEntry` — the entry as the
 * client last knew it — since `index` alone is addressed against a
 * transaction-fresh array and can silently land on the wrong entry if some
 * other request changed the array's length ahead of this one (e.g. a
 * concurrent remove shifting indices). The server compares the entry it
 * actually finds at `index` against `expectedEntry` before applying the
 * mutation and rejects with a conflict if they differ, rather than silently
 * mutating whatever now happens to sit at that index (see
 * `ProfileService#mutateSectionEntry`).
 */
export const ProfileEntryMutationSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('add'),
    section: ProfileArraySectionSchema,
    entry: z.unknown(),
  }),
  z.object({
    operation: z.literal('update'),
    section: ProfileArraySectionSchema,
    index: z.number().int().min(0),
    entry: z.unknown(),
    expectedEntry: z.unknown(),
  }),
  z.object({
    operation: z.literal('remove'),
    section: ProfileArraySectionSchema,
    index: z.number().int().min(0),
    expectedEntry: z.unknown(),
  }),
]);

// ── Manual Job Intake — paste-and-parse extraction ──────────────────────────

export const ExtractJobIntakeSchema = z.object({
  raw_text: z
    .string()
    .min(50, 'Paste more of the job posting')
    .max(20000, 'Job description is too long — trim it to under 20,000 characters'),
});

export const JobIntakeResultSchema = z.object({
  title: z.string().nullable(),
  company_name: z.string().nullable(),
  location: z.string().nullable(),
  remote: z.boolean().nullable(),
  salary_range: z.string().nullable(),
  company_info_summary: z.string().nullable(),
});

// ── AI Bridge output validation — analyzeJob / checkCompatibility ──────────

// LLM output occasionally collapses a documented string[] field into a bare
// prose string (observed live in checkCompatibility's `reasons` field — 2 of
// 3 real calls returned a string, which crashed MatchScoreDisplay's
// `reasons.map()` in production). Coerce a bare string into a 1-element
// array rather than failing the whole request over this specific, common
// shape drift.
//
// Exported (not module-private) so read paths can re-run the same coercion
// against legacy rows written before this schema existed — see
// `applications.service.ts`'s `findOwnedWithJob`, which normalizes
// `matchReasons` on the way out for rows persisted before this fix landed.
export const stringArrayWithStringCoercion = z.preprocess(
  (val) => (typeof val === 'string' ? [val] : val),
  z.array(z.string()),
);

/**
 * Runs `stringArrayWithStringCoercion` against an arbitrary value and
 * returns a plain `string[]`, falling back to `[]` if the value is neither a
 * string nor an array of strings (e.g. `null`/`undefined`/a malformed shape).
 * Used at read time to normalize legacy DB rows that predate this coercion.
 */
export function coerceToStringArray(val: unknown): string[] {
  const parsed = stringArrayWithStringCoercion.safeParse(val);
  return parsed.success ? parsed.data : [];
}

export const CompatibilityResultSchema = z.object({
  compatible: z.boolean(),
  score: z.number().min(0).max(100),
  blockers: stringArrayWithStringCoercion,
  warnings: stringArrayWithStringCoercion,
  suggestions: stringArrayWithStringCoercion,
  reasons: stringArrayWithStringCoercion,
  missing_skills: z.array(
    z.object({
      skill: z.string(),
      priority: z.enum(['mandatory', 'nice-to-have']),
      suggested_resources: stringArrayWithStringCoercion,
    }),
  ),
  strengths: stringArrayWithStringCoercion,
  recommendations: stringArrayWithStringCoercion,
});

export const JobDNASchema = z.object({
  job_title: z.string().min(1),
  seniority: z.string().min(1),
  mandatory_technical_skills: stringArrayWithStringCoercion,
  mandatory_soft_skills: stringArrayWithStringCoercion,
  nice_to_have_skills: stringArrayWithStringCoercion,
  ats_keywords: stringArrayWithStringCoercion,
  company_culture_and_values: stringArrayWithStringCoercion,
  primary_responsibilities_summary: z.string(),
  tone_recommendation: z.string(),
});

// ── Phase 2: Applications — resume selection / email draft edits ───────────

const SectionTypeSchema = z.enum([
  'education',
  'experience',
  'projects',
  'skills',
  'certifications',
  'awards',
  'summary',
  'spoken_languages',
  'volunteering',
  'publications',
  'interests',
]);

export const UpdateResumeSelectionSchema = z.object({
  reasoning: z.string(),
  match_score: z.number().min(0).max(100).optional(),
  match_reasoning: z.string().optional(),
  section_order: z.array(SectionTypeSchema),
  summary: z.string().optional(),
  experience: z.array(
    z.object({
      company: z.string(),
      role: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
  skills: z.object({
    languages: z.array(z.string()),
    frameworks_and_libraries: z.array(z.string()),
    infrastructure_and_tools: z.array(z.string()),
    databases: z.array(z.string()),
  }),
  certifications: z.array(z.string()),
  awards: z.array(z.string()),
  volunteering: z.array(z.string()).optional(),
  publications: z.array(z.string()).optional(),
});

export const UpdateEmailDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export const UpdateGapReportSchema = z.object({
  match_score: z.number().min(0).max(100),
  missing_skills: z.array(
    z.object({
      skill: z.string(),
      priority: z.enum(['mandatory', 'nice-to-have']),
      suggested_resources: z.array(z.string()),
      completed: z.boolean().optional(),
    }),
  ),
  strengths: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export const IngestBodySchema = z.object({
  raw_text: z
    .string()
    .min(1)
    .max(20000, 'Text is too long — trim it to under 20,000 characters'),
});

// Onboarding "paste raw text" ingestion may surface multiple distinct career
// facts (a job, a cert, a project) in one paste — the LLM returns an array of
// typed entries rather than a single best-guess type.
const IngestSkillsEntrySchema = withNullKeysStripped(SkillsSchema.partial());

export const IngestEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('experience'), entry: ExperienceEntrySchema }),
  z.object({ type: z.literal('project'), entry: ProjectEntrySchema }),
  z.object({ type: z.literal('education'), entry: EducationEntrySchema }),
  z.object({ type: z.literal('certification'), entry: CertificationSchema }),
  z.object({ type: z.literal('award'), entry: AwardSchema }),
  z.object({ type: z.literal('skills'), entry: IngestSkillsEntrySchema }),
  z.object({ type: z.literal('summary'), entry: SummaryEntrySchema }),
  z.object({ type: z.literal('publication'), entry: PublicationEntrySchema }),
  z.object({ type: z.literal('volunteering'), entry: VolunteeringEntrySchema }),
  z.object({ type: z.literal('interest'), entry: InterestEntrySchema }),
]);

// ── Onboarding-ingest field coercions ───────────────────────────────────────
// The onboarding "paste raw text" flow (see `toIngestDraft` below) runs
// against freellmapi's `model: "auto"` — a rotating pool of free-tier models
// with heavy shape drift. These coercions absorb the common drift patterns
// observed live so a well-extracted entry isn't dropped over a formatting
// quirk. They're applied ONLY on the ingest path (layered on top of the
// shared strict `*Shape` schemas above via `z.preprocess`, further below) —
// never on the shared schemas themselves, since those also gate
// `POST /profile/import` and manual profile-edit payloads, which must stay
// at least as strict/untrusted as raw LLM output.

/**
 * Bullet/prose array fields (e.g. `raw_achievements`, `quantifiable_metrics`)
 * sometimes come back as a single string with embedded newlines or bullet
 * markers instead of a JSON array. Split on newlines, strip leading bullet
 * markers, trim, and drop empty lines; non-string array items are stringified
 * rather than dropped.
 */
function coerceBulletListValue(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
  }
  if (typeof val === 'string') {
    return val
      .split('\n')
      .map((line) => line.replace(/^\s*[-•*]\s*/, '').trim())
      .filter(Boolean);
  }
  return val;
}

/**
 * Tag-list fields (e.g. `technologies_used`, `core_competencies`, skills
 * categories, `honors`) sometimes come back as a single comma/semicolon/
 * newline-separated string instead of a JSON array.
 */
function coerceTagListValue(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
  }
  if (typeof val === 'string') {
    return val
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return val;
}

/**
 * `isCurrent` frequently arrives as a string ("true"/"yes"/"present") rather
 * than a JSON boolean. Coerces the common truthy/falsy string spellings
 * (case-insensitive); leaves other values untouched so a still-invalid value
 * surfaces as a validation failure rather than being silently swallowed.
 */
function coerceLooseBooleanValue(val: unknown): unknown {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (['true', 'yes', 'present', 'current'].includes(normalized)) return true;
    if (['false', 'no'].includes(normalized)) return false;
  }
  return val;
}

/** `gpa` occasionally arrives as a bare JSON number (e.g. `3.8`) rather than a string. */
function coerceGpaValue(val: unknown): unknown {
  return typeof val === 'number' ? String(val) : val;
}

/**
 * A project link is occasionally a bare URL string ("hosted at https://...")
 * rather than the documented `{ type, url }` object.
 */
function coerceProjectLinksValue(val: unknown): unknown {
  if (!Array.isArray(val)) return val;
  return val.map((item) => (typeof item === 'string' ? { type: '', url: item } : item));
}

/**
 * An `interest` entry is documented as a bare string, but sometimes arrives
 * as `{ name | title | interest | value: "..." }` instead.
 */
function coerceInterestValue(val: unknown): unknown {
  if (val !== null && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const candidate = obj.name ?? obj.title ?? obj.interest ?? obj.value;
    if (typeof candidate === 'string') return candidate;
  }
  return val;
}

/**
 * Unwraps a field schema (possibly `.optional()`/`.default()`-wrapped) down
 * to its underlying `ZodArray`, if it is one. Used to read a field's declared
 * max length directly off the shared shape schema rather than duplicating
 * the bound in a second, driftable constant.
 */
function unwrapArraySchema(schema: z.ZodTypeAny): z.ZodArray<z.ZodTypeAny> | null {
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodOptional) {
    return unwrapArraySchema(schema._def.innerType);
  }
  return schema instanceof z.ZodArray ? schema : null;
}

/** Reads the `.max(N)` bound off a shared shape's array field, if any. */
function arrayMaxLength(schema: z.ZodTypeAny): number | undefined {
  const arraySchema = unwrapArraySchema(schema);
  return arraySchema?._def.maxLength?.value ?? undefined;
}

/**
 * Applies `coerceFn` to `obj[key]` (only if the key is present) and, when the
 * coerced result is an array, clamps it to `maxLen` (keeping the first N
 * items) — so a well-extracted entry with e.g. 31 `raw_achievements` isn't
 * dropped/flagged over 1 item past the shared schema's `.max(30)`, it's
 * clamped and the rest silently trimmed, same as any other array-shortening
 * edit a user could make themselves.
 */
function coerceAndClampArrayField(
  obj: Record<string, unknown>,
  key: string,
  coerceFn: (val: unknown) => unknown,
  maxLen: number | undefined,
): void {
  if (!(key in obj)) return;
  const coerced = coerceFn(obj[key]);
  obj[key] = Array.isArray(coerced) && maxLen !== undefined ? coerced.slice(0, maxLen) : coerced;
}

/** Shallow-copies `raw` if it's a plain object, otherwise returns it unchanged. */
function shallowCopyIfObject(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
}

const CURRENT_ROLE_END_DATE_PATTERN = /^(present|current|now|ongoing|to date)$/i;

/**
 * The free-tier LLM sometimes reports a currently-held role's `endDate` as
 * the literal word "Present"/"Current"/"Ongoing"/etc. rather than the empty
 * string the schema documents for an open-ended role, or reports
 * `isCurrent: true` while leaving `endDate` absent/null entirely. Either one
 * otherwise flags a genuinely current role as incomplete over a field it has
 * no real value for (observed live: "Mar 2022 - Present" flagged for a
 * missing `endDate`). Mutates `obj` in place; assumes `isCurrent` has already
 * been boolean-coerced by the caller.
 */
function coerceCurrentRoleDates(obj: Record<string, unknown>): void {
  if (typeof obj.endDate === 'string' && CURRENT_ROLE_END_DATE_PATTERN.test(obj.endDate.trim())) {
    obj.endDate = '';
    obj.isCurrent = true;
    return;
  }
  if (obj.isCurrent === true && (obj.endDate === undefined || obj.endDate === null)) {
    obj.endDate = '';
  }
}

function coerceExperienceIngestEntry(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = shallowCopyIfObject(raw);
  coerceAndClampArrayField(
    obj,
    'core_competencies',
    coerceTagListValue,
    arrayMaxLength(ExperienceEntryShape.shape.core_competencies),
  );
  coerceAndClampArrayField(
    obj,
    'technologies_used',
    coerceTagListValue,
    arrayMaxLength(ExperienceEntryShape.shape.technologies_used),
  );
  coerceAndClampArrayField(
    obj,
    'raw_achievements',
    coerceBulletListValue,
    arrayMaxLength(ExperienceEntryShape.shape.raw_achievements),
  );
  coerceAndClampArrayField(
    obj,
    'quantifiable_metrics',
    coerceBulletListValue,
    arrayMaxLength(ExperienceEntryShape.shape.quantifiable_metrics),
  );
  // Omitted entirely on plenty of real pastes — default to `false` here
  // (rather than in the shared schema, which requires it) so an entry isn't
  // flagged incomplete over a field the model legitimately had nothing to
  // report.
  obj.isCurrent = 'isCurrent' in obj ? coerceLooseBooleanValue(obj.isCurrent) : false;
  coerceCurrentRoleDates(obj);
  return obj;
}

function coerceProjectIngestEntry(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = shallowCopyIfObject(raw);
  coerceAndClampArrayField(
    obj,
    'links',
    coerceProjectLinksValue,
    arrayMaxLength(ProjectEntryShape.shape.links),
  );
  coerceAndClampArrayField(
    obj,
    'technologies_used',
    coerceTagListValue,
    arrayMaxLength(ProjectEntryShape.shape.technologies_used),
  );
  coerceAndClampArrayField(
    obj,
    'raw_achievements',
    coerceBulletListValue,
    arrayMaxLength(ProjectEntryShape.shape.raw_achievements),
  );
  coerceAndClampArrayField(
    obj,
    'quantifiable_metrics',
    coerceBulletListValue,
    arrayMaxLength(ProjectEntryShape.shape.quantifiable_metrics),
  );
  return obj;
}

function coerceEducationIngestEntry(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = shallowCopyIfObject(raw);
  if ('gpa' in obj) obj.gpa = coerceGpaValue(obj.gpa);
  coerceAndClampArrayField(
    obj,
    'honors',
    coerceTagListValue,
    arrayMaxLength(EducationEntryShape.shape.honors),
  );
  coerceAndClampArrayField(
    obj,
    'relevant_coursework',
    coerceTagListValue,
    arrayMaxLength(EducationEntryShape.shape.relevant_coursework),
  );
  coerceAndClampArrayField(
    obj,
    'extracurriculars',
    coerceTagListValue,
    arrayMaxLength(EducationEntryShape.shape.extracurriculars),
  );
  return obj;
}

function coerceAwardIngestEntry(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = shallowCopyIfObject(raw);
  coerceAndClampArrayField(
    obj,
    'related_skills',
    coerceTagListValue,
    arrayMaxLength(AwardShape.shape.related_skills),
  );
  return obj;
}

function coerceVolunteeringIngestEntry(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = shallowCopyIfObject(raw);
  if ('isCurrent' in obj) obj.isCurrent = coerceLooseBooleanValue(obj.isCurrent);
  coerceCurrentRoleDates(obj);
  return obj;
}

function coerceSkillsIngestEntry(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = shallowCopyIfObject(raw);
  for (const key of [
    'programming_languages',
    'frameworks_and_libraries',
    'infrastructure_and_tools',
    'databases',
    'soft_skills',
  ] as const) {
    coerceAndClampArrayField(obj, key, coerceTagListValue, arrayMaxLength(SkillsSchema.shape[key]));
  }
  return obj;
}

// ── Onboarding-ingest lenient drafts ────────────────────────────────────────
// Strict `IngestEntrySchema` above stays the server-side gate for what can
// actually be *saved* to a profile (`ConfirmIngestSchema` reuses it
// unmodified). But at parse time, an entry that fails strict validation over
// one bad/missing field (e.g. a missing `startDate`) should surface to the
// user as an editable draft — not vanish silently. `toIngestDraft` below is
// the lenient path: normalize the AI's top-level shape drift, apply the
// per-type ingest-only coercions above, try strict validation, and on
// failure fall back to a per-type "lenient" schema (every genuinely-required
// field optional) with only the offending keys stripped, recording those
// keys as `missingFields` so the review UI can prompt the user to fill them
// in. An entry is only fully dropped when its type can't be recognized at
// all or even the lenient parse fails outright.

type KnownIngestType = IngestEntryDto['type'];

const KNOWN_INGEST_TYPES = new Set<KnownIngestType>([
  'experience',
  'project',
  'education',
  'certification',
  'award',
  'skills',
  'summary',
  'publication',
  'volunteering',
  'interest',
]);

// Conservative synonym map for the free-tier LLM's common type-name drift
// (casing/pluralization/near-synonyms) — deliberately narrow so an
// ambiguous/unrecognized type is dropped rather than silently miscategorized.
const INGEST_TYPE_SYNONYMS: Record<string, KnownIngestType> = {
  job: 'experience',
  work: 'experience',
  employment: 'experience',
  role: 'experience',
  position: 'experience',
  internship: 'experience',
  degree: 'education',
  school: 'education',
  academic: 'education',
  study: 'education',
  cert: 'certification',
  certificate: 'certification',
  license: 'certification',
  awards: 'award',
  honor: 'award',
  achievement: 'award',
  hobby: 'interest',
  hobbies: 'interest',
  interests: 'interest',
  volunteer: 'volunteering',
  leadership: 'volunteering',
  talk: 'publication',
  speaking: 'publication',
  article: 'publication',
  publications: 'publication',
  paper: 'publication',
  profile_summary: 'summary',
  bio: 'summary',
  about: 'summary',
  objective: 'summary',
  skill: 'skills',
  skillset: 'skills',
  personal_project: 'project',
  side_project: 'project',
  projects: 'project',
};

/**
 * Recovers `{ type, entry }` from an arbitrary AI-returned entry object,
 * absorbing observed shape drift: type casing/synonyms, and `entry` nested
 * under `data`/`value` or flattened onto the top-level object instead of
 * under an `entry` key. Returns `null` when the object isn't recognizable at
 * all (not an object, or `type` doesn't map to a known type).
 */
function normalizeIngestEntryShape(raw: unknown): { type: KnownIngestType; entry: unknown } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.type !== 'string') return null;
  const normalizedTypeName = obj.type.trim().toLowerCase();
  const type = INGEST_TYPE_SYNONYMS[normalizedTypeName] ?? (normalizedTypeName as KnownIngestType);
  if (!KNOWN_INGEST_TYPES.has(type)) return null;

  let entry: unknown = obj.entry ?? obj.data ?? obj.value;
  if (entry === undefined) {
    // Flattened: every key except "type" belongs to the entry itself.
    const { type: _type, ...rest } = obj;
    entry = rest;
  }
  return { type, entry };
}

/**
 * Top-level keys of a per-type `*Shape` object schema that are actually
 * required — i.e. neither `.optional()` nor `.default(...)`. Used to filter
 * `toIngestDraft`'s `missingFields` down to fields the user genuinely needs
 * to fill in when they're absent from the raw entry.
 */
function requiredKeysOf(shape: z.ZodObject<z.ZodRawShape>): Set<string> {
  return new Set(
    Object.entries(shape.shape)
      .filter(([, fieldSchema]) => !(fieldSchema instanceof z.ZodOptional || fieldSchema instanceof z.ZodDefault))
      .map(([key]) => key),
  );
}

/**
 * Builds a "lenient" version of a shared `*Shape` object schema: every
 * genuinely-required field becomes optional, while fields that already carry
 * a `.default(...)` keep that default (rather than `.partial()`, which wraps
 * a `ZodDefault` in `ZodOptional` too and turns an absent defaulted field
 * into `undefined` instead of its declared default, e.g. `[]`).
 */
function toLenientShape<Shape extends z.ZodRawShape>(shape: z.ZodObject<Shape>): z.ZodObject<z.ZodRawShape> {
  const lenientShape: z.ZodRawShape = {};
  for (const [key, fieldSchema] of Object.entries(shape.shape)) {
    lenientShape[key] =
      fieldSchema instanceof z.ZodOptional || fieldSchema instanceof z.ZodDefault
        ? fieldSchema
        : fieldSchema.optional();
  }
  return z.object(lenientShape);
}

/** `entry === undefined` is the natural "raw entry isn't an object" case. */
function ingestPreprocess<T extends z.ZodTypeAny>(coerceFn: (raw: unknown) => unknown, schema: T): z.ZodType<z.output<T>> {
  return withNullKeysStripped(z.preprocess(coerceFn, schema)) as unknown as z.ZodType<z.output<T>>;
}

const ENTRY_SCHEMA_BY_TYPE: Record<Exclude<KnownIngestType, 'interest'>, z.ZodTypeAny> = {
  experience: ingestPreprocess(coerceExperienceIngestEntry, ExperienceEntryShape),
  project: ingestPreprocess(coerceProjectIngestEntry, ProjectEntryShape),
  education: ingestPreprocess(coerceEducationIngestEntry, EducationEntryShape),
  certification: CertificationSchema,
  award: ingestPreprocess(coerceAwardIngestEntry, AwardShape),
  skills: ingestPreprocess(coerceSkillsIngestEntry, SkillsSchema.partial()),
  summary: SummaryEntrySchema,
  publication: PublicationEntrySchema,
  volunteering: ingestPreprocess(coerceVolunteeringIngestEntry, VolunteeringEntryShape),
};

// `skills` is already fully-partial at the strict level (no required
// fields), so its "lenient" schema is the same schema — there's nothing
// further to relax.
const LENIENT_ENTRY_SCHEMA_BY_TYPE: Record<Exclude<KnownIngestType, 'interest'>, z.ZodTypeAny> = {
  experience: ingestPreprocess(coerceExperienceIngestEntry, toLenientShape(ExperienceEntryShape)),
  project: ingestPreprocess(coerceProjectIngestEntry, toLenientShape(ProjectEntryShape)),
  education: ingestPreprocess(coerceEducationIngestEntry, toLenientShape(EducationEntryShape)),
  certification: withNullKeysStripped(toLenientShape(CertificationShape)),
  award: ingestPreprocess(coerceAwardIngestEntry, toLenientShape(AwardShape)),
  skills: ENTRY_SCHEMA_BY_TYPE.skills,
  summary: withNullKeysStripped(toLenientShape(SummaryEntryShape)),
  publication: withNullKeysStripped(toLenientShape(PublicationEntryShape)),
  volunteering: ingestPreprocess(coerceVolunteeringIngestEntry, toLenientShape(VolunteeringEntryShape)),
};

const REQUIRED_KEYS_BY_TYPE: Record<Exclude<KnownIngestType, 'interest'>, Set<string>> = {
  experience: requiredKeysOf(ExperienceEntryShape),
  project: requiredKeysOf(ProjectEntryShape),
  education: requiredKeysOf(EducationEntryShape),
  certification: requiredKeysOf(CertificationShape),
  award: requiredKeysOf(AwardShape),
  // Already fully optional at the strict level — nothing is ever "required".
  skills: new Set(),
  summary: requiredKeysOf(SummaryEntryShape),
  publication: requiredKeysOf(PublicationEntryShape),
  volunteering: requiredKeysOf(VolunteeringEntryShape),
};

// Ingest-only interest schema — coerces the common `{ name | title | ... }`
// object shape drift into the bare string the shared `InterestEntrySchema`
// requires. Kept off the shared schema so `POST /profile/import` /
// `mutateSectionEntry` reject that shape rather than silently accepting it.
const IngestInterestEntrySchema = z.preprocess(coerceInterestValue, InterestEntrySchema);

export const IngestDraftEntrySchema = z.object({
  type: z.enum([
    'experience',
    'project',
    'education',
    'certification',
    'award',
    'skills',
    'summary',
    'publication',
    'volunteering',
    'interest',
  ]),
  entry: z.unknown(),
  // Dotted top-level field names that failed strict validation and were
  // stripped to let the rest of the entry survive as an editable draft, or
  // were required and absent entirely. Never trust this list after the user
  // edits the entry client-side — recompute against the strict schema
  // instead (see review page).
  missingFields: z.array(z.string()),
});

export type IngestDraftEntryDto = z.infer<typeof IngestDraftEntrySchema>;

export interface IngestDroppedEntry {
  type: string;
  reason: string;
  snippet: string;
}

function snippetOf(raw: unknown): string {
  try {
    return JSON.stringify(raw).slice(0, 300);
  } catch {
    return String(raw).slice(0, 300);
  }
}

/**
 * Converts one AI-returned raw entry into either a survivable
 * `IngestDraftEntryDto` (complete or incomplete-but-editable) or a full drop
 * reason. Never throws — every branch is a `safeParse`.
 */
export function toIngestDraft(raw: unknown): IngestDraftEntryDto | IngestDroppedEntry {
  const snippet = snippetOf(raw);
  const shaped = normalizeIngestEntryShape(raw);
  if (!shaped) {
    const typeGuess =
      typeof raw === 'object' && raw !== null && 'type' in raw
        ? String((raw as { type?: unknown }).type)
        : 'unknown';
    return { type: typeGuess, reason: 'unrecognized or missing "type"', snippet };
  }
  const { type, entry } = shaped;

  if (type === 'interest') {
    const parsed = IngestInterestEntrySchema.safeParse(entry);
    if (parsed.success) {
      return { type, entry: parsed.data, missingFields: [] };
    }
    // No sub-fields to partially recover for a bare-string entry — either
    // it's a usable string or the whole item is incomplete.
    return { type, entry: '', missingFields: ['value'] };
  }

  // A root-level Zod issue (path []) — e.g. the entry itself is a bare string
  // or array rather than an object — leaves `badKeys` empty below, so the
  // lenient parse would otherwise see `{}` and pass with no missingFields.
  // Reject that case outright instead of silently inventing an empty entry.
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return { type, reason: 'entry is not an object', snippet };
  }

  const strictSchema = ENTRY_SCHEMA_BY_TYPE[type];
  const strictResult = strictSchema.safeParse(entry);
  if (strictResult.success) {
    return { type, entry: strictResult.data, missingFields: [] };
  }

  const lenientSchema = LENIENT_ENTRY_SCHEMA_BY_TYPE[type];
  const badKeys = Array.from(
    new Set(
      strictResult.error.issues
        .map((issue) => (issue.path.length > 0 ? String(issue.path[0]) : ''))
        .filter(Boolean),
    ),
  );
  const entryObj = entry as Record<string, unknown>;
  const cleanedEntry = Object.fromEntries(
    Object.entries(entryObj).filter(([key]) => !badKeys.includes(key)),
  );
  const lenientResult = lenientSchema.safeParse(cleanedEntry);
  if (!lenientResult.success) {
    return { type, reason: `failed lenient validation: ${lenientResult.error.message}`, snippet };
  }
  // A badKey is reported to the user when either (a) it was actually present
  // in the raw entry and failed validation — a value that needs fixing,
  // regardless of whether the field itself is required or optional — or (b)
  // it's absent and the strict schema requires it. A badKey that's simply
  // absent from an optional field needs no user action (it was already
  // dropped/defaulted by `lenientSchema` above).
  const requiredKeys = REQUIRED_KEYS_BY_TYPE[type];
  const missingFields = badKeys.filter((key) => key in entryObj || requiredKeys.has(key));
  // Backstop: `badKeys` is derived from *strict-schema* issues, which can
  // miss a required field entirely absent from a shape whose Zod validation
  // short-circuits before reaching it (or any other drift between the strict
  // and lenient schemas). Guarantee the invariant callers rely on — a draft
  // with `missingFields: []` always passes `IngestEntrySchema` — by also
  // flagging any required key absent from the final lenient-parsed entry.
  const finalEntry = lenientResult.data as Record<string, unknown>;
  for (const key of requiredKeys) {
    if (!(key in finalEntry) && !missingFields.includes(key)) {
      missingFields.push(key);
    }
  }
  return { type, entry: lenientResult.data, missingFields };
}

export const IngestResultSchema = z.object({
  entries: z.array(IngestDraftEntrySchema).min(1).max(100),
  // AI-extracted entries dropped entirely — unrecognized type, or failed
  // even lenient validation (see `toIngestDraft`). Surfaced to the frontend
  // so a partially-failed paste doesn't silently look fully parsed.
  droppedEntries: z
    .array(z.object({ type: z.string(), reason: z.string(), snippet: z.string() }))
    .default([]),
});

// Body of `POST /onboarding/ingest/confirm` — the user-reviewed (possibly
// edited/pruned) set of entries from a prior parse-only ingest, persisted
// only once the user explicitly confirms them. Re-validated here (against
// the STRICT per-type schemas, not the lenient draft ones) rather than
// trusted from the earlier parse response — this is the server-side
// guarantee that an incomplete draft entry can never actually be saved to a
// profile, even if the client sends one anyway.
export const ConfirmIngestSchema = z.object({
  entries: z.array(IngestEntrySchema).min(1).max(100),
});

// ── Phase 3: Job Discovery (Swipe Feed) ─────────────────────────────────────

// Query-string params arrive as strings (or repeated strings for arrays);
// coerce accordingly rather than assuming JSON body-shaped input.
const commaSeparatedList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((val) => {
    if (val === undefined) return undefined;
    const items = Array.isArray(val) ? val : val.split(',');
    return items.map((s) => s.trim()).filter(Boolean);
  });

export const DiscoverFeedFiltersSchema = z.object({
  category_tags: commaSeparatedList,
  work_mode: commaSeparatedList,
  location: z.string().optional(),
  seniority: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(20),
});

export const UserSettingsSchema = z.object({
  match_threshold: z.number().min(0).max(100).default(50),
  preferred_locations: z.array(z.string()).default([]),
  target_roles: z.array(z.string()).default([]),
  seniority: z.string().optional(),
  resume_template: z.string().default('default'),
  ai_provider_override: z.string().optional(),
  auto_send_email: z.boolean().default(false),
  notify_on_new_jobs: z.boolean().default(true),
  // Phase 3 — /discover filter bar (decided 2026-08-30).
  category_tags: z.array(z.string()).default([]),
  work_mode: z.array(z.string()).default([]),
});

export const UpdateUserSettingsSchema = UserSettingsSchema.partial();

// ── Phase 4: Application Dashboard ──────────────────────────────────────────

// Only the 4 statuses actually ever set by real code — 'archived'/'sent' are
// mentioned in comments/roadmap but no code path sets them yet, so they're
// deliberately not filterable values here.
const ApplicationStatusSchema = z.enum([
  'gap_reported',
  'resume_drafted',
  'email_drafted',
  'ready',
]);

export const ListApplicationsFiltersSchema = z.object({
  status: ApplicationStatusSchema.optional(),
  company: z.string().optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
  match_score_min: z.coerce.number().int().min(0).max(100).optional(),
  match_score_max: z.coerce.number().int().min(0).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(20),
});

// ── Phase 2b: Interview Prep ─────────────────────────────────────────────────

export const InterviewPrepIntakeAnswersSchema = z.object({
  interview_format: z.enum(['panel', 'one_on_one', 'unknown']),
  interviewers: z.string().optional(),
  concerns: z.string().optional(),
  weak_topics_selected: z.array(z.string()),
  dynamic_question_answers: z.array(
    z.object({ question: z.string(), answer: z.string() }),
  ),
});

// Output of `generateInterviewIntakeQuestions` — 2-4 JD/company-grounded
// dynamic questions, used to `.safeParse()`-validate the LLM output before
// persisting (same defensive pattern as InterviewPrepReportSchema below).
export const InterviewIntakeQuestionsSchema = z
  .array(z.object({ question: z.string().min(1), reasoning: z.string().min(1) }))
  .min(1)
  .max(6);

// Merged shape of TechnicalInterviewPrep + BehavioralInterviewPrep — used both
// to `.safeParse()`-validate the merged synthesis output before persisting
// (same defensive pattern as UpdateResumeSelectionSchema in draftForJob) and
// as the API response type. Read-only — no corresponding Update*Schema, since
// nothing downstream consumes an edited report.
export const InterviewPrepReportSchema = z.object({
  technical_topics: z.array(
    z.object({
      topic: z.string(),
      probability: z.enum(['high', 'medium', 'low']),
      reasoning: z.string(),
    }),
  ),
  gaps_to_address: z.array(
    z.object({
      gap: z.string(),
      suggested_framing: z.string(),
    }),
  ),
  behavioral_questions: z.array(
    z.object({
      question: z.string(),
      company_signal: z.string(),
      suggested_angle: z.string(),
    }),
  ),
  talking_points: z.array(
    z.object({
      point: z.string(),
      matched_to: z.string(),
    }),
  ),
});

// ── Inferred Types ──────────────────────────────────────────────────────────

export type MasterDB = z.infer<typeof MasterDBSchema>;
export type CreateJobDto = z.infer<typeof CreateJobSchema>;
export type UpdateCareerProfileDto = z.infer<typeof UpdateCareerProfileSchema>;
export type ProfileArraySection = z.infer<typeof ProfileArraySectionSchema>;
export type ProfileEntryMutationDto = z.infer<typeof ProfileEntryMutationSchema>;
export type ExtractJobIntakeDto = z.infer<typeof ExtractJobIntakeSchema>;
export type JobIntakeResultDto = z.infer<typeof JobIntakeResultSchema>;
export type IngestBodyDto = z.infer<typeof IngestBodySchema>;
export type IngestEntryDto = z.infer<typeof IngestEntrySchema>;
export type IngestResultDto = z.infer<typeof IngestResultSchema>;
export type ConfirmIngestDto = z.infer<typeof ConfirmIngestSchema>;
export type UserSettingsDto = z.infer<typeof UserSettingsSchema>;
export type UpdateUserSettingsDto = z.infer<typeof UpdateUserSettingsSchema>;
export type UpdateResumeSelectionDto = z.infer<typeof UpdateResumeSelectionSchema>;
export type UpdateEmailDraftDto = z.infer<typeof UpdateEmailDraftSchema>;
export type UpdateGapReportDto = z.infer<typeof UpdateGapReportSchema>;
export type DiscoverFeedFiltersDto = z.infer<typeof DiscoverFeedFiltersSchema>;
export type ListApplicationsFiltersDto = z.infer<typeof ListApplicationsFiltersSchema>;
export type InterviewPrepIntakeAnswersDto = z.infer<typeof InterviewPrepIntakeAnswersSchema>;
export type InterviewIntakeQuestionsDto = z.infer<typeof InterviewIntakeQuestionsSchema>;
export type InterviewPrepReportDto = z.infer<typeof InterviewPrepReportSchema>;
export type CompatibilityResultDto = z.infer<typeof CompatibilityResultSchema>;
export type JobDNADto = z.infer<typeof JobDNASchema>;
