import { z } from 'zod';

// Copy of the career-profile (MasterDB) schema from the main resume app, duplicated on purpose so this
// folder can be published on its own. Keep the shape identical: data_inventory.json must validate.
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
  // Personal projects often have no dates; the resume then shows none.
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
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

export type MasterDB = z.infer<typeof MasterDBSchema>;
