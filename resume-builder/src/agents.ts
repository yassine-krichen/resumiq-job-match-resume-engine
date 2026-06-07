import { generateJSON } from './llm';
import type { AISelection, JobDNA, MasterDB } from './types';

// ── Agent 1: Job Analyzer ───────────────────────────────────────────────────

const AGENT1_SYSTEM = `\
You are a senior technical recruiter and ATS configuration expert.
Analyze the provided job description and extract its core requirements into a structured JSON object.

Rules:
- Read between the lines — infer implicit requirements from context and language tone.
- Separate mandatory requirements from nice-to-haves with precision.
- ATS keywords must be exact phrases a scanner would match: specific technologies, frameworks, role nouns, action verbs.
- Infer company culture from the language, not just explicit "values" statements.

Return ONLY valid JSON. No markdown wrapping. No explanation outside the JSON.`;

function agent1User(jd: string, companyInfo: string): string {
  return `\
Analyze this job posting and return the Job DNA as JSON.

<job_description>
${jd}
</job_description>

<company_info>
${companyInfo || 'Not provided'}
</company_info>

Return JSON matching this exact schema (no extra fields):
{
  "job_title": "string",
  "seniority": "Junior | Mid | Senior | Lead",
  "mandatory_technical_skills": ["string"],
  "mandatory_soft_skills": ["string"],
  "nice_to_have_skills": ["string"],
  "ats_keywords": ["string — 5 to 10 exact ATS-scannable phrases"],
  "company_culture_and_values": ["string"],
  "primary_responsibilities_summary": "string — 2 sentences max",
  "tone_recommendation": "string — e.g. impact-driven and metric-focused"
}`;
}

// ── Agent 2: Selector + Drafter ─────────────────────────────────────────────

const AGENT2_SYSTEM = `\
You are an elite resume strategist. Given a candidate's complete career database and a target job's requirements,
select the most relevant content and write polished, targeted bullet points.

HARD RULES — each violation invalidates the output:
1. NEVER invent numbers, percentages, or metrics. Only use figures that appear verbatim
   in the candidate's raw_achievements or quantifiable_metrics fields.
2. Every technology named in bullets MUST appear in technologies_used for that specific role or project.
3. Skills in the output MUST exist in the candidate's skills section. Do not inject technologies from the job description.
4. Max 4 bullets per experience entry. Max 3 bullets per project.
5. Bullet formula: Strong Action Verb + Context/Task + Result/Scope [+ Key Technology if natural].
   No filler phrases ("was responsible for", "helped with", "participated in").
6. Show soft skills through behavior — never state them directly.
   Write "Spearheaded alignment between engineering and product to ship X" not "demonstrated communication skills".
7. Omit irrelevant experiences entirely — a gap is better than a weak, unrelated entry.

Return ONLY valid JSON. No markdown. No explanation.`;

function agent2User(jobDNA: JobDNA, db: MasterDB): string {
  return `\
Select and draft resume content for this candidate targeting this specific role.

<job_dna>
${JSON.stringify(jobDNA, null, 2)}
</job_dna>

<candidate_database>
${JSON.stringify(db, null, 2)}
</candidate_database>

Return JSON matching this exact schema:
{
  "reasoning": "string — brief explanation of your selection and ordering strategy",
  "section_order": ["array of: education | experience | projects | skills | certifications | awards — ordered by relevance to this role"],
  "summary": "string or null — include only if a targeted summary adds real value for this specific role",
  "experience": [
    {
      "company": "string — must match exactly a company name in the candidate database",
      "role": "string — must match exactly the role listed for that company",
      "bullets": ["string — max 4 rewritten bullet points using only facts from the database"]
    }
  ],
  "projects": [
    {
      "name": "string — must match exactly a project name in the candidate database",
      "bullets": ["string — max 3 rewritten bullet points"]
    }
  ],
  "skills": {
    "languages": ["string — from candidate database programming_languages only"],
    "frameworks_and_libraries": ["string — from candidate database, prioritized for this role"],
    "infrastructure_and_tools": ["string — from candidate database only"],
    "databases": ["string — from candidate database only"]
  },
  "certifications": ["string — cert names from database, include only if relevant to this role"],
  "awards": ["string — award titles from database, include only if they strengthen this specific application"]
}`;
}

// ── Critique Pass ───────────────────────────────────────────────────────────

const CRITIQUE_SYSTEM = `\
You are a ruthless resume editor. Audit the draft resume selection and return a strictly improved version.

For every bullet, verify all of the following — fail any that don't pass:
1. "So what?" test: there is a clear scope, outcome, or impact beyond just describing what the person did.
2. Every number or metric exists verbatim in the candidate's raw_achievements or quantifiable_metrics fields.
   If a number cannot be traced to the database, rewrite the bullet without it.
3. Opens with a strong, specific action verb. Reject: "Worked on", "Helped", "Assisted", "Was responsible for",
   "Participated in", "Contributed to" used as openers without specifics.
4. Every technology mentioned is in technologies_used for that specific role or project in the database.
5. Fits within 2 rendered lines when compiled at 11pt — cut ruthlessly.

Also check:
- All skills listed exist in the candidate's database skills section.
- Section order is strategically correct for this specific role.
- Summary (if present) is targeted — not a generic elevator pitch.

Return the complete revised AISelection JSON. Keep reasoning updated with what you changed and why.
Return ONLY valid JSON. No markdown. No explanation outside the JSON.`;

function critiqueUser(draft: AISelection, jobDNA: JobDNA, db: MasterDB): string {
  return `\
Audit and improve this resume draft.

<job_dna>
${JSON.stringify(jobDNA, null, 2)}
</job_dna>

<candidate_database>
${JSON.stringify(db, null, 2)}
</candidate_database>

<draft_selection>
${JSON.stringify(draft, null, 2)}
</draft_selection>

Return the complete improved AISelection JSON with the same schema.`;
}

// ── Exported Functions ──────────────────────────────────────────────────────

export async function analyzeJob(jd: string, companyInfo: string): Promise<JobDNA> {
  return generateJSON<JobDNA>(AGENT1_SYSTEM, agent1User(jd, companyInfo));
}

export async function selectAndDraft(jobDNA: JobDNA, db: MasterDB): Promise<AISelection> {
  return generateJSON<AISelection>(AGENT2_SYSTEM, agent2User(jobDNA, db));
}

export async function critiqueAndRevise(
  draft: AISelection,
  jobDNA: JobDNA,
  db: MasterDB,
): Promise<AISelection> {
  return generateJSON<AISelection>(CRITIQUE_SYSTEM, critiqueUser(draft, jobDNA, db));
}
