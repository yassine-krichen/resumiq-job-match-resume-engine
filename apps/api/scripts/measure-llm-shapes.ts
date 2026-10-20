// Measures how often real LLM output matches the shape each consumer reads,
// BEFORE validation/repair (first raw response) vs AFTER (what the agent
// function now returns after generateJSON's one repair retry).
//
// Paired design: every trial's first raw provider response is captured by
// wrapping global.fetch (attributed per trial via AsyncLocalStorage), so one
// real run yields both numbers on identical inputs.
//
// Usage (from apps/api):
//   npx ts-node --transpile-only scripts/measure-llm-shapes.ts [N] [site,site]
// Needs FREELLMAPI_API_KEY (loaded from apps/api/.env). Makes real LLM calls.
import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  analyzeJob,
  checkCompatibility,
  extractJSON,
  generateEmail,
  LlmValidationError,
  parseJobIntake,
  selectAndDraft,
} from '@resumiq/ai-bridge';
import type { AISelection, JobDNA, MasterDB } from '@resumiq/ai-bridge';
import {
  CompatibilityResultSchema,
  JobDNASchema,
  JobIntakeResultSchema,
  MasterDBSchema,
  UpdateEmailDraftSchema,
  UpdateResumeSelectionSchema,
} from '@resumiq/schemas';

interface TrialRecord {
  responses: string[]; // provider message contents, in call order
}

const trialStore = new AsyncLocalStorage<TrialRecord>();
const realFetch = global.fetch;
global.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const res = await realFetch(input, init);
  const record = trialStore.getStore();
  if (record && res.ok) {
    const body = (await res.clone().json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    record.responses.push(body.choices?.[0]?.message?.content ?? '');
  }
  return res;
}) as typeof fetch;

// ── Fixtures ────────────────────────────────────────────────────────────────

const PROFILE: MasterDB = MasterDBSchema.parse({
  personal_info: {
    name: 'Alex Rivera',
    location: 'Remote',
    phone: '',
    email: 'alex@example.com',
    work_authorization: [],
    clearances: [],
    links: [],
  },
  summaries: [],
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
      core_competencies: ['Backend development', 'API design'],
      technologies_used: ['TypeScript', 'Node.js', 'NestJS', 'PostgreSQL', 'Redis'],
      raw_achievements: ['Built the billing API used by 10k users', 'Led migration to PostgreSQL'],
      quantifiable_metrics: ['Cut p95 API latency by 30%'],
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
      technologies_used: ['React', 'JavaScript', 'Python'],
      raw_achievements: ['Built an internal dashboard in React'],
      quantifiable_metrics: [],
    },
  ],
  education: [],
  projects: [
    {
      name: 'Job tracker',
      context: 'Full-stack job application tracker',
      startDate: '2023-01',
      endDate: '2023-06',
      technologies_used: ['Next.js', 'Prisma', 'Docker'],
      raw_achievements: ['Shipped to production with CI/CD'],
    },
  ],
  skills: {
    programming_languages: ['TypeScript', 'JavaScript', 'Python'],
    frameworks_and_libraries: ['NestJS', 'React', 'Next.js'],
    infrastructure_and_tools: ['Docker', 'GitHub Actions'],
    databases: ['PostgreSQL', 'Redis'],
    spoken_languages: [],
    soft_skills: ['Communication'],
  },
  certifications: [],
  awards_and_honors: [],
  publications_and_speaking: [],
  volunteering_and_leadership: [],
  interests: [],
});

const JDS: Array<{ jd: string; company: string; dna: JobDNA }> = [
  {
    company: 'Northwind Payments',
    jd: 'Senior Backend Engineer at Northwind Payments (remote, EU/US timezones). You will own payment-processing services in Node.js/TypeScript on AWS, design REST and event-driven APIs, and mentor two juniors. Required: 5+ years backend experience, PostgreSQL, Kubernetes, strong testing habits. Nice to have: Kafka, Terraform. Salary 120-150k USD. We value ownership, written communication and low-ego collaboration.',
    dna: {
      job_title: 'Senior Backend Engineer',
      seniority: 'senior',
      mandatory_technical_skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'Kubernetes', 'AWS'],
      mandatory_soft_skills: ['Mentoring', 'Written communication'],
      nice_to_have_skills: ['Kafka', 'Terraform'],
      ats_keywords: ['REST', 'event-driven', 'payments', 'microservices'],
      company_culture_and_values: ['Ownership', 'Low-ego collaboration'],
      primary_responsibilities_summary: 'Own payment-processing services and mentor juniors.',
      tone_recommendation: 'Professional, direct',
    },
  },
  {
    company: 'Lumen Health',
    jd: 'Full-Stack Developer, Lumen Health (Berlin or remote). React + NestJS stack, PostgreSQL, GitHub Actions CI. You ship features end to end with a small product team, write tests, and talk to clinicians. 2-4 years experience. Bonus: Next.js, accessibility knowledge. We care about patient safety, curiosity and clear documentation.',
    dna: {
      job_title: 'Full-Stack Developer',
      seniority: 'mid',
      mandatory_technical_skills: ['React', 'NestJS', 'PostgreSQL', 'GitHub Actions'],
      mandatory_soft_skills: ['Collaboration'],
      nice_to_have_skills: ['Next.js', 'Accessibility'],
      ats_keywords: ['full-stack', 'testing', 'CI'],
      company_culture_and_values: ['Patient safety', 'Curiosity'],
      primary_responsibilities_summary: 'Ship features end to end with a small product team.',
      tone_recommendation: 'Warm, precise',
    },
  },
  {
    company: 'Orbital Data',
    jd: 'Data Platform Engineer at Orbital Data. Build batch and streaming pipelines in Python and Scala on Spark and Airflow, own data quality tooling, run on GCP with Terraform. 4+ years. Must know SQL deeply and have shipped pipelines handling TB-scale data. Nice: dbt, Rust. Culture: rigor, humility, blameless postmortems.',
    dna: {
      job_title: 'Data Platform Engineer',
      seniority: 'mid-senior',
      mandatory_technical_skills: ['Python', 'Spark', 'Airflow', 'SQL', 'GCP', 'Terraform'],
      mandatory_soft_skills: ['Rigor'],
      nice_to_have_skills: ['dbt', 'Rust', 'Scala'],
      ats_keywords: ['pipelines', 'streaming', 'data quality'],
      company_culture_and_values: ['Rigor', 'Humility', 'Blameless postmortems'],
      primary_responsibilities_summary: 'Build and operate TB-scale data pipelines.',
      tone_recommendation: 'Technical, humble',
    },
  },
  {
    company: 'Pixel Forge',
    jd: 'Frontend Engineer, Pixel Forge (remote). TypeScript, React, Next.js, design-system ownership, Storybook, Playwright tests. 3+ years. You will partner with designers and push performance (Core Web Vitals). Nice: WebGL, GraphQL. We are a craft-driven studio: taste, speed and kindness.',
    dna: {
      job_title: 'Frontend Engineer',
      seniority: 'mid',
      mandatory_technical_skills: ['TypeScript', 'React', 'Next.js', 'Playwright'],
      mandatory_soft_skills: ['Design collaboration'],
      nice_to_have_skills: ['WebGL', 'GraphQL'],
      ats_keywords: ['design system', 'Storybook', 'Core Web Vitals'],
      company_culture_and_values: ['Craft', 'Speed', 'Kindness'],
      primary_responsibilities_summary: 'Own the design system and frontend performance.',
      tone_recommendation: 'Creative, concise',
    },
  },
  {
    company: 'Quarry Security',
    jd: 'Platform / DevOps Engineer at Quarry Security. Own CI/CD, Docker and Kubernetes clusters, observability with Prometheus and Grafana, and cloud cost. Go or Python scripting. 3+ years on-call experience. SOC 2 exposure a plus. We value security-first thinking and honest postmortems. Hybrid, Lisbon.',
    dna: {
      job_title: 'Platform / DevOps Engineer',
      seniority: 'mid',
      mandatory_technical_skills: ['Docker', 'Kubernetes', 'CI/CD', 'Prometheus', 'Grafana'],
      mandatory_soft_skills: ['On-call ownership'],
      nice_to_have_skills: ['SOC 2', 'Go'],
      ats_keywords: ['observability', 'cloud cost', 'infrastructure'],
      company_culture_and_values: ['Security-first', 'Honest postmortems'],
      primary_responsibilities_summary: 'Own CI/CD, clusters and observability.',
      tone_recommendation: 'Calm, factual',
    },
  },
];

const SELECTION: AISelection = {
  reasoning: 'Lead with backend experience.',
  match_score: 70,
  section_order: ['summary', 'experience', 'projects', 'skills'],
  summary: 'Backend-leaning TypeScript engineer.',
  experience: [
    {
      company: 'Acme Corp',
      role: 'Software Engineer',
      bullets: ['Built the billing API used by 10k users'],
    },
  ],
  projects: [{ name: 'Job tracker', bullets: ['Shipped to production with CI/CD'] }],
  skills: {
    languages: ['TypeScript'],
    frameworks_and_libraries: ['NestJS'],
    infrastructure_and_tools: ['Docker'],
    databases: ['PostgreSQL'],
  },
  certifications: [],
  awards: [],
};

// ── Sites ───────────────────────────────────────────────────────────────────

interface Site {
  name: string;
  schema: { safeParse(v: unknown): { success: boolean; error?: { message: string } } };
  run: (i: number) => Promise<unknown>;
}

const pick = (i: number) => JDS[i % JDS.length];

const SITES: Site[] = [
  {
    name: 'analyzeJob',
    schema: JobDNASchema,
    run: (i) => analyzeJob(pick(i).jd, `${pick(i).company} is hiring.`),
  },
  {
    name: 'checkCompatibility',
    schema: CompatibilityResultSchema,
    run: (i) => checkCompatibility(pick(i).dna, PROFILE),
  },
  {
    name: 'selectAndDraft',
    schema: UpdateResumeSelectionSchema,
    run: (i) => selectAndDraft(pick(i).dna, PROFILE, 1),
  },
  {
    name: 'generateEmail',
    schema: UpdateEmailDraftSchema,
    run: (i) =>
      generateEmail(
        pick(i).dna,
        `${pick(i).company}: values ${pick(i).dna.company_culture_and_values.join(', ')}.`,
        SELECTION,
      ),
  },
  {
    name: 'parseJobIntake',
    schema: JobIntakeResultSchema,
    run: (i) => parseJobIntake(pick(i).jd),
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────

type Outcome = 'valid_first_try' | 'repaired' | 'failed_handled' | 'infra_error';

interface Trial {
  site: string;
  i: number;
  beforeValid: boolean;
  beforeProblem: string;
  outcome: Outcome;
  detail: string;
}

async function runTrial(site: Site, i: number): Promise<Trial> {
  const record: TrialRecord = { responses: [] };
  let outcome: Outcome = 'valid_first_try';
  let detail = '';
  await trialStore.run(record, async () => {
    try {
      await site.run(i);
    } catch (err) {
      if (err instanceof LlmValidationError) {
        outcome = 'failed_handled';
        detail = err.validationMessage.slice(0, 300);
      } else {
        outcome = 'infra_error';
        detail = (err as Error).message.slice(0, 300);
      }
    }
  });

  let beforeValid = false;
  let beforeProblem = 'no response captured';
  if (record.responses.length > 0) {
    try {
      const check = site.schema.safeParse(extractJSON<unknown>(record.responses[0]));
      beforeValid = check.success;
      beforeProblem = check.success ? '' : (check.error?.message ?? '').slice(0, 300);
    } catch (err) {
      beforeProblem = `unparseable JSON: ${(err as Error).message.slice(0, 120)}`;
    }
  }
  if (outcome === 'valid_first_try' && !beforeValid) outcome = 'repaired';
  return { site: site.name, i, beforeValid, beforeProblem, outcome, detail };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const idx = next++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? 20);
  const only = process.argv[3]?.split(',');
  const sites = SITES.filter((s) => !only || only.includes(s.name));
  if (!process.env.FREELLMAPI_API_KEY) throw new Error('FREELLMAPI_API_KEY is not set');

  const jobs = sites.flatMap((s) => Array.from({ length: n }, (_, i) => ({ s, i })));
  const concurrency = Number(process.env.MEASURE_CONCURRENCY ?? 4);
  const trials = await mapLimit(jobs, concurrency, async ({ s, i }) => {
    const t = await runTrial(s, i);
    console.error(`${t.site}#${t.i} before=${t.beforeValid ? 'ok' : 'BAD'} outcome=${t.outcome}`);
    return t;
  });

  const pct = (a: number, b: number): string =>
    b === 0 ? 'n/a' : `${((100 * a) / b).toFixed(0)}%`;
  const rows = sites.map((s) => {
    const ts = trials.filter((t) => t.site === s.name && t.outcome !== 'infra_error');
    const infra = trials.filter((t) => t.site === s.name && t.outcome === 'infra_error').length;
    const beforeBad = ts.filter((t) => !t.beforeValid).length;
    const afterValid = ts.filter((t) => t.outcome !== 'failed_handled').length;
    return { site: s.name, n: ts.length, infra, beforeBad, afterValid, failed: ts.length - afterValid };
  });
  const tot = rows.reduce(
    (a, r) => ({ n: a.n + r.n, b: a.b + r.beforeBad, v: a.v + r.afterValid }),
    { n: 0, b: 0, v: 0 },
  );

  console.log('| site | N (completed) | infra errors | malformed BEFORE | valid AFTER | still failing (handled) |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| ${r.site} | ${r.n} | ${r.infra} | ${r.beforeBad} (${pct(r.beforeBad, r.n)}) | ${r.afterValid} (${pct(r.afterValid, r.n)}) | ${r.failed} (${pct(r.failed, r.n)}) |`,
    );
  }
  console.log(
    `| TOTAL | ${tot.n} | | ${tot.b} (${pct(tot.b, tot.n)}) | ${tot.v} (${pct(tot.v, tot.n)}) | ${tot.n - tot.v} (${pct(tot.n - tot.v, tot.n)}) |`,
  );
  console.log('\nSample failure reasons (before):');
  for (const t of trials.filter((x) => !x.beforeValid && x.outcome !== 'infra_error').slice(0, 8)) {
    console.log(`- ${t.site}#${t.i} [${t.outcome}]: ${t.beforeProblem.replace(/\s+/g, ' ')}`);
  }
  for (const t of trials.filter((x) => x.outcome === 'infra_error').slice(0, 3)) {
    console.log(`infra: ${t.site}#${t.i}: ${t.detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
