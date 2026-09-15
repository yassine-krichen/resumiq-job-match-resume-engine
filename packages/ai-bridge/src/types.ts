// `MasterDB` and its entry types are the Zod-inferred source of truth from
// `@resumiq/schemas` (validated by onboarding-parse and profile import/export)
// — re-exported here (rather than hand-declared) so this package's types
// cannot drift out of sync with the schema the way they previously did.
export type { MasterDB } from '@resumiq/schemas';
import type { MasterDB } from '@resumiq/schemas';

export type PersonalInfo = MasterDB['personal_info'];
export type ExperienceEntry = MasterDB['experience'][number];
export type ProjectEntry = MasterDB['projects'][number];
export type EducationEntry = MasterDB['education'][number];
export type Skills = MasterDB['skills'];
export type Certification = MasterDB['certifications'][number];
export type Award = MasterDB['awards_and_honors'][number];
export type Publication = MasterDB['publications_and_speaking'][number];
export type VolunteeringEntry = MasterDB['volunteering_and_leadership'][number];

/** Output of `parseJobIntake` — best-effort metadata extraction from a raw
 * paste, used to pre-fill the manual job-intake review form. Distinct from
 * `JobDNA`: this just captures form-fillable fields (and a qualitative
 * company-signal summary) from the paste, not the skill/ATS analysis
 * `analyzeJob` performs downstream. Every field is nullable — the LLM is
 * instructed to return null rather than guess when a field isn't explicitly
 * stated in the text. */
export interface JobIntake {
  title: string | null;
  company_name: string | null;
  location: string | null;
  remote: boolean | null;
  salary_range: string | null;
  company_info_summary: string | null;
}

export interface JobDNA {
  job_title: string;
  seniority: string;
  mandatory_technical_skills: string[];
  mandatory_soft_skills: string[];
  nice_to_have_skills: string[];
  ats_keywords: string[];
  company_culture_and_values: string[];
  primary_responsibilities_summary: string;
  tone_recommendation: string;
}

export type SectionType =
  | 'education'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'certifications'
  | 'awards'
  | 'summary'
  | 'spoken_languages'
  | 'volunteering'
  | 'publications'
  | 'interests';

export interface AISelection {
  reasoning: string;
  match_score?: number;
  match_reasoning?: string;
  section_order: SectionType[];
  summary?: string;
  experience: Array<{
    company: string;
    role: string;
    bullets: string[];
  }>;
  projects: Array<{
    name: string;
    bullets: string[];
  }>;
  skills: {
    languages: string[];
    frameworks_and_libraries: string[];
    infrastructure_and_tools: string[];
    databases: string[];
  };
  certifications: string[];
  awards: string[];
  volunteering?: string[];
  publications?: string[];
}

export interface CompatibilityResult {
  compatible: boolean;
  score: number;
  blockers: string[];
  warnings: string[];
  suggestions: string[];
  /** Explainability: matched skills, gaps, seniority fit — shown as "why this score". */
  reasons: string[];
  /** Gap-report-shaped fields, seeded by the same call — used when score is below threshold. */
  missing_skills: Array<{
    skill: string;
    priority: 'mandatory' | 'nice-to-have';
    suggested_resources: string[];
  }>;
  strengths: string[];
  recommendations: string[];
}

export interface GapReport {
  match_score: number;
  missing_skills: Array<{
    skill: string;
    priority: 'mandatory' | 'nice-to-have';
    suggested_resources: string[];
  }>;
  strengths: string[];
  recommendations: string[];
}

export interface EmailDraft {
  subject: string;
  body: string;
}

// ── Phase 2b: Interview Prep ────────────────────────────────────────────────

/** Answers collected via the structured intake form — mirrors
 * `InterviewPrepIntakeAnswersSchema` in @resumiq/schemas (kept as a plain
 * interface here, same MasterDB/MasterDBSchema duplication convention used
 * elsewhere in this package). */
export interface InterviewPrepIntakeAnswers {
  interview_format: 'panel' | 'one_on_one' | 'unknown';
  interviewers?: string;
  concerns?: string;
  weak_topics_selected: string[];
  dynamic_question_answers: Array<{ question: string; answer: string }>;
}

/** Output of `generateInterviewIntakeQuestions` — 2-4 JD/company-grounded
 * dynamic questions shown to the user before the synthesis pass. */
export type InterviewIntakeQuestions = Array<{
  question: string;
  reasoning: string;
}>;

export interface TechnicalInterviewPrep {
  technical_topics: Array<{
    topic: string;
    probability: 'high' | 'medium' | 'low';
    reasoning: string;
  }>;
  gaps_to_address: Array<{
    gap: string;
    suggested_framing: string;
  }>;
}

export interface BehavioralInterviewPrep {
  behavioral_questions: Array<{
    question: string;
    company_signal: string;
    suggested_angle: string;
  }>;
  talking_points: Array<{
    point: string;
    matched_to: string;
  }>;
}
