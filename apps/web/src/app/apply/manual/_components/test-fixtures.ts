// Shared fixture builders for the /apply/manual flow's test suite.
// Not a test file itself — colocated here since every test in this folder
// needs realistic, schema-shaped `ApplicationRecord` data.
import type {
  ApplicationRecord,
  EmailDraft,
  GapReport,
  ResumeSelection,
} from './types';

export function buildResumeSelection(
  overrides: Partial<ResumeSelection> = {},
): ResumeSelection {
  return {
    reasoning: 'Strong overlap in backend skills.',
    section_order: ['summary', 'experience', 'skills'],
    summary: 'Backend engineer with 5 years of experience shipping distributed systems.',
    experience: [
      {
        company: 'Acme Corp',
        role: 'Backend Engineer',
        bullets: ['Built the thing.', 'Scaled the other thing.'],
      },
    ],
    projects: [],
    skills: {
      languages: ['TypeScript'],
      frameworks_and_libraries: ['NestJS'],
      infrastructure_and_tools: ['Docker'],
      databases: ['PostgreSQL'],
    },
    certifications: [],
    awards: [],
    ...overrides,
  };
}

export function buildGapReport(overrides: Partial<GapReport> = {}): GapReport {
  return {
    match_score: 62,
    missing_skills: [
      {
        skill: 'Kubernetes',
        priority: 'mandatory',
        suggested_resources: ['Kubernetes docs'],
        completed: false,
      },
    ],
    strengths: ['Strong TypeScript background'],
    recommendations: ['Add a Kubernetes project to your portfolio'],
    ...overrides,
  };
}

export function buildEmailDraft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    subject: 'Application for Backend Engineer',
    body: 'Hi there, I would love to be considered for this role.',
    ...overrides,
  };
}

export function buildApplication(
  overrides: Partial<ApplicationRecord> = {},
): ApplicationRecord {
  return {
    id: 'app-1',
    matchScore: 72,
    matchReasons: ['Strong TypeScript match'],
    status: 'analyzed',
    gapReport: null,
    resumeSelection: null,
    resumePdfPath: null,
    emailDraft: null,
    job: { id: 'job-1', title: 'Backend Engineer', companyName: 'Acme Corp' },
    ...overrides,
  };
}
