// Shared fixture builders for the /apply/manual flow's test suite.
// Not a test file itself — colocated here since every test in this folder
// needs realistic, schema-shaped `ApplicationRecord` data. Also reused by
// applications/[id]'s own test suites (page.test.tsx, the interview-prep
// component tests) since ApplicationRecord — including InterviewPrepState —
// is defined here.
import type { InterviewPrepIntakeAnswersDto, InterviewPrepReportDto } from '@resumiq/schemas';
import type {
  ApplicationRecord,
  EmailDraft,
  GapReport,
  InterviewPrepIntakeState,
  InterviewPrepState,
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

export function buildInterviewPrepIntakeAnswers(
  overrides: Partial<InterviewPrepIntakeAnswersDto> = {},
): InterviewPrepIntakeAnswersDto {
  return {
    interview_format: 'one_on_one',
    interviewers: 'Engineering manager',
    concerns: 'Depth of system design questions',
    weak_topics_selected: ['Kubernetes'],
    dynamic_question_answers: [
      { question: 'Why this company?', answer: 'Their mission aligns with my values.' },
    ],
    ...overrides,
  };
}

export function buildInterviewPrepIntakeState(
  overrides: Partial<InterviewPrepIntakeState> = {},
): InterviewPrepIntakeState {
  return {
    weak_topics: ['Kubernetes', 'System design'],
    questions: [{ question: 'Why this company?', reasoning: 'Tests culture fit.' }],
    ...overrides,
  };
}

export function buildInterviewPrepReport(
  overrides: Partial<InterviewPrepReportDto> = {},
): InterviewPrepReportDto {
  return {
    technical_topics: [
      { topic: 'Kubernetes', probability: 'high', reasoning: 'Listed as a required skill.' },
    ],
    gaps_to_address: [
      {
        gap: 'No production Kubernetes experience',
        suggested_framing: 'Frame via container orchestration exposure on Docker projects.',
      },
    ],
    behavioral_questions: [
      {
        question: 'Tell me about a conflict with a teammate.',
        company_signal: 'Values collaborative problem-solving.',
        suggested_angle: 'Use the Acme Corp scaling story.',
      },
    ],
    talking_points: [
      {
        point: 'Scaled a distributed system to handle 10x traffic.',
        matched_to: 'Backend Engineer scalability requirement.',
      },
    ],
    ...overrides,
  };
}

export function buildInterviewPrepState(
  overrides: Partial<InterviewPrepState> = {},
): InterviewPrepState {
  return {
    intake: buildInterviewPrepIntakeState(),
    report: null,
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
    resumeSource: null,
    renderedWith: null,
    resumePdfPath: null,
    emailDraft: null,
    interviewPrep: null,
    job: { id: 'job-1', title: 'Backend Engineer', companyName: 'Acme Corp' },
    ...overrides,
  };
}
