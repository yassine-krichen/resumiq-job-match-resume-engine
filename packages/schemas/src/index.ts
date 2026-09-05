import { z } from 'zod';

// ── Career Profile Schemas ──────────────────────────────────────────────────

export const PersonalInfoSchema = z.object({
  name: z.string().min(1),
  location: z.string(),
  phone: z.string(),
  email: z.string().email(),
  work_authorization: z.array(z.string()),
  clearances: z.array(z.string()),
  links: z.array(z.object({ platform: z.string(), url: z.string().url() })),
});

export const ExperienceEntrySchema = z.object({
  company: z.string().min(1),
  company_industry: z.string(),
  role: z.string().min(1),
  location: z.string(),
  location_type: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  isCurrent: z.boolean(),
  core_competencies: z.array(z.string()),
  technologies_used: z.array(z.string()),
  raw_achievements: z.array(z.string()),
  quantifiable_metrics: z.array(z.string()),
});

export const ProjectEntrySchema = z.object({
  name: z.string().min(1),
  context: z.string(),
  // LLM extraction rarely has a well-formed URL for every link it mentions
  // (e.g. "hosted on a private repo") — relax to a plain string rather than
  // failing validation on an otherwise-good entry.
  links: z.array(z.object({ type: z.string(), url: z.string() })),
  startDate: z.string(),
  endDate: z.string(),
  technologies_used: z.array(z.string()),
  raw_achievements: z.array(z.string()),
  quantifiable_metrics: z.array(z.string()),
});

export const EducationEntrySchema = z.object({
  institution: z.string().min(1),
  degree_type: z.string().min(1),
  major: z.string().min(1),
  minor: z.string(),
  location: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  gpa: z.string(),
  honors: z.array(z.string()),
  relevant_coursework: z.array(z.string()),
  thesis_or_capstone: z.string(),
  extracurriculars: z.array(z.string()),
  description: z.string(),
});

export const SkillsSchema = z.object({
  programming_languages: z.array(z.string()),
  frameworks_and_libraries: z.array(z.string()),
  infrastructure_and_tools: z.array(z.string()),
  databases: z.array(z.string()),
  spoken_languages: z.array(
    z.object({ language: z.string(), fluency: z.string(), note: z.string().optional() }),
  ),
  soft_skills: z.array(z.string()),
});

export const CertificationSchema = z.object({
  name: z.string(),
  issuer: z.string(),
  date: z.string(),
  // These are frequently absent from casual raw-text extraction (the user
  // rarely states an expiration date, credential ID, or verification link)
  // — default to '' rather than require the LLM to fabricate or omit them,
  // which would otherwise fail validation and silently drop the whole entry.
  expiration_date: z.string().default(''),
  credential_id: z.string().default(''),
  link: z.string().default(''),
  description: z.string().default(''),
});

export const AwardSchema = z.object({
  title: z.string(),
  issuer: z.string(),
  date: z.string(),
  description: z.string().default(''),
  related_skills: z.array(z.string()).optional(),
});

export const MasterDBSchema = z.object({
  personal_info: PersonalInfoSchema,
  summaries: z.array(z.object({ target_role: z.string(), content: z.string() })),
  experience: z.array(ExperienceEntrySchema),
  education: z.array(EducationEntrySchema),
  projects: z.array(ProjectEntrySchema),
  skills: SkillsSchema,
  certifications: z.array(CertificationSchema),
  awards_and_honors: z.array(AwardSchema),
  publications_and_speaking: z.array(
    z.object({
      title: z.string(),
      venue: z.string().optional(),
      date: z.string(),
      url: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
  volunteering_and_leadership: z.array(
    z.object({
      organization: z.string(),
      role: z.string(),
      location: z.string().optional(),
      startDate: z.string(),
      endDate: z.string().optional(),
      isCurrent: z.boolean().optional(),
      description: z.string().optional(),
    }),
  ),
  interests: z.array(z.string()),
});

// ── API Request/Response Schemas ────────────────────────────────────────────

export const CreateJobSchema = z.object({
  raw_jd: z.string().min(50, 'Job description too short'),
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

export const IngestBodySchema = z.object({ raw_text: z.string().min(1) });

// Onboarding "paste raw text" ingestion may surface multiple distinct career
// facts (a job, a cert, a project) in one paste — the LLM returns an array of
// typed entries rather than a single best-guess type.
export const IngestEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('experience'), entry: ExperienceEntrySchema }),
  z.object({ type: z.literal('project'), entry: ProjectEntrySchema }),
  z.object({ type: z.literal('education'), entry: EducationEntrySchema }),
  z.object({ type: z.literal('certification'), entry: CertificationSchema }),
  z.object({ type: z.literal('award'), entry: AwardSchema }),
  z.object({ type: z.literal('skills'), entry: SkillsSchema.partial() }),
]);

export const IngestResultSchema = z.object({
  entries: z.array(IngestEntrySchema).min(1),
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
export type IngestBodyDto = z.infer<typeof IngestBodySchema>;
export type IngestEntryDto = z.infer<typeof IngestEntrySchema>;
export type IngestResultDto = z.infer<typeof IngestResultSchema>;
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
