import type { AISelection, MasterDB } from '@resumiq/ai-bridge';
import { MasterDBSchema } from '@resumiq/schemas';

import { extractClaims } from './extract-claims';
import { groundClaim } from './ground';
import type { ClaimGrounding } from './ground';
import { buildIndex } from './inventory-index';

const DB: MasterDB = MasterDBSchema.parse({
  personal_info: {
    name: 'Alex Rivera',
    location: 'Remote',
    phone: '',
    email: 'alex@example.com',
    work_authorization: [],
    clearances: [],
    links: [],
  },
  summaries: [{ target_role: 'General', content: 'Backend engineer.' }],
  experience: [
    {
      company: 'Acme Corp',
      company_industry: 'Software',
      role: 'Software Engineer',
      location: 'Remote',
      location_type: 'remote',
      startDate: '2022-01',
      endDate: '',
      isCurrent: true,
      core_competencies: ['Backend development'],
      technologies_used: ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis'],
      raw_achievements: ['Built the billing API used by 10,000 users', 'Led migration to PostgreSQL'],
      quantifiable_metrics: ['Cut p95 API latency by 30%', 'Reduced token usage from 612 to 244 (-60.1%)'],
    },
    {
      company: 'Beta Labs',
      company_industry: 'Data',
      role: 'Junior Developer',
      location: 'Remote',
      location_type: 'remote',
      startDate: '2020-06',
      endDate: '2021-12',
      isCurrent: false,
      core_competencies: ['Frontend'],
      technologies_used: ['React', 'Docker'],
      raw_achievements: ['Built an internal dashboard in React'],
      quantifiable_metrics: ['Onboarded 5 teams'],
    },
  ],
  education: [],
  projects: [
    {
      name: 'Job Tracker',
      context: 'Application tracker',
      startDate: '2023-01',
      endDate: '2023-06',
      technologies_used: ['Next.js 16', 'Prisma'],
      raw_achievements: ['Shipped to production with CI/CD'],
    },
  ],
  skills: {
    programming_languages: ['TypeScript', 'Python'],
    frameworks_and_libraries: ['React', 'Next.js'],
    infrastructure_and_tools: ['Docker'],
    databases: ['PostgreSQL', 'Redis'],
    spoken_languages: [{ language: 'English', fluency: 'Professional' }],
    soft_skills: [],
  },
  certifications: [{ name: 'AWS Cloud Practitioner' }],
  awards_and_honors: [{ title: 'Hackathon Winner' }],
  publications_and_speaking: [],
  volunteering_and_leadership: [],
  interests: [],
});

const index = buildIndex(DB, ['Kafka', 'Data Analysis']);

function select(partial: Partial<AISelection>): AISelection {
  return {
    reasoning: '',
    section_order: [],
    experience: [],
    projects: [],
    skills: { languages: [], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [] },
    certifications: [],
    awards: [],
    ...partial,
  };
}

function groundAll(sel: AISelection): Map<string, ClaimGrounding> {
  return new Map(extractClaims(sel, index).map((c) => [c.id, groundClaim(c, index)]));
}

const acme = (...bullets: string[]): AISelection =>
  select({ experience: [{ company: 'Acme Corp', role: 'Software Engineer', bullets }] });

describe('groundClaim: numbers', () => {
  it('accepts figures that appear in the same entry, including 10k vs 10,000', () => {
    const g = groundAll(acme('Built the billing API for 10k users', 'Cut p95 latency by 30%'));
    expect(g.get('exp0.b0')?.strictFabricated).toBe(false);
    expect(g.get('exp0.b1')?.strictFabricated).toBe(false);
  });

  it('flags an invented figure under both strict and loose checks', () => {
    const g = groundAll(acme('Cut latency by 87.3%')).get('exp0.b0');
    expect(g?.strictFabricated).toBe(true);
    expect(g?.looseFabricated).toBe(true);
    expect(g?.flags[0].type).toBe('number');
  });

  it('flags a figure from another entry as strict-only', () => {
    const g = groundAll(acme('Onboarded 5 teams')).get('exp0.b0');
    expect(g?.strictFabricated).toBe(true);
    expect(g?.looseFabricated).toBe(false);
  });

  it('routes a coarser rounding to the judge instead of failing it', () => {
    const g = groundAll(acme('Reduced token usage by 60%')).get('exp0.b0');
    expect(g?.strictFabricated).toBe(false);
    expect(g?.derivedNumbers).toEqual(['60%']);
  });

  it('ignores version numbers that follow a technology name', () => {
    const sel = select({ projects: [{ name: 'Job Tracker', bullets: ['Built with Next.js 16 and Prisma'] }] });
    expect(groundAll(sel).get('prj0.b0')?.strictFabricated).toBe(false);
  });

  it('does not flag a claim with no numbers', () => {
    expect(groundAll(acme('Led migration to PostgreSQL')).get('exp0.b0')?.strictFabricated).toBe(false);
  });
});

describe('groundClaim: technologies', () => {
  it('flags a technology injected from the job description', () => {
    const g = groundAll(acme('Streamed events with Kafka')).get('exp0.b0');
    expect(g?.strictFabricated).toBe(true);
    expect(g?.looseFabricated).toBe(true);
    expect(g?.flags[0].type).toBe('tech');
  });

  it('flags a technology that belongs to a different entry as strict-only', () => {
    const g = groundAll(acme('Containerized services with Docker')).get('exp0.b0');
    expect(g?.strictFabricated).toBe(true);
    expect(g?.looseFabricated).toBe(false);
  });

  it('accepts spelling variants of an in-entry technology', () => {
    const g = groundAll(acme('Tuned Postgres queries in Node and TypeScript')).get('exp0.b0');
    expect(g?.strictFabricated).toBe(false);
  });

  it('does not treat generic job-description phrases as technologies', () => {
    const g = groundAll(acme('Led data analysis for billing')).get('exp0.b0');
    expect(g?.strictFabricated).toBe(false);
  });
});

describe('groundClaim: structure', () => {
  it('flags an employer that is not in the inventory, and its bullets', () => {
    const sel = select({ experience: [{ company: 'Globex Corporation', role: 'Staff Engineer', bullets: ['Led the platform team'] }] });
    const g = groundAll(sel);
    expect(g.get('exp0.h')?.flags[0].type).toBe('entry');
    expect(g.get('exp0.b0')?.flags[0].type).toBe('entry');
  });

  it('tolerates case and whitespace differences in company and role', () => {
    const sel = select({ experience: [{ company: ' acme  corp ', role: 'software engineer', bullets: [] }] });
    expect(groundAll(sel).get('exp0.h')?.strictFabricated).toBe(false);
  });

  it('flags a role that differs from the inventory role', () => {
    const sel = select({ experience: [{ company: 'Acme Corp', role: 'VP of Engineering', bullets: [] }] });
    expect(groundAll(sel).get('exp0.h')?.flags[0].type).toBe('title');
  });

  it('resolves a project name that is only a deliverable inside an experience entry', () => {
    const sel = select({ projects: [{ name: 'Billing API', bullets: ['Built the billing API for 10k users'] }] });
    const g = groundAll(sel);
    expect(g.get('prj0.h')?.strictFabricated).toBe(false);
    expect(g.get('prj0.b0')?.strictFabricated).toBe(false);
  });

  it('flags skills, certifications and awards that are not in the inventory', () => {
    const sel = select({
      skills: { languages: ['Python', 'Rust'], frameworks_and_libraries: [], infrastructure_and_tools: ['Postman'], databases: [] },
      certifications: ['AWS Cloud Practitioner', 'CKA'],
      awards: ['Hackathon Winner', 'Nobel Prize'],
    });
    const g = groundAll(sel);
    expect(g.get('skill.languages.0')?.strictFabricated).toBe(false);
    expect(g.get('skill.languages.1')?.strictFabricated).toBe(true);
    expect(g.get('skill.tools.0')?.strictFabricated).toBe(true);
    expect(g.get('cert.0')?.strictFabricated).toBe(false);
    expect(g.get('cert.1')?.strictFabricated).toBe(true);
    expect(g.get('award.0')?.strictFabricated).toBe(false);
    expect(g.get('award.1')?.strictFabricated).toBe(true);
  });

  it('accepts a spoken language listed with its fluency', () => {
    const sel = select({ skills: { languages: ['English (Professional)'], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [] } });
    expect(groundAll(sel).get('skill.languages.0')?.strictFabricated).toBe(false);
  });

  it('produces no claims for an empty selection', () => {
    expect(extractClaims(select({}), index)).toEqual([]);
  });
});

describe('groundClaim: summary', () => {
  it('checks summary figures and technologies against the whole inventory', () => {
    const ok = groundAll(select({ summary: 'Engineer shipping TypeScript services for 10k users.' })).get('sum');
    const bad = groundAll(select({ summary: 'Engineer with 12 years of Kafka experience.' })).get('sum');
    expect(ok?.strictFabricated).toBe(false);
    expect(bad?.strictFabricated).toBe(true);
  });
});
