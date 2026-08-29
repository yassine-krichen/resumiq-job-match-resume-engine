import { generateJSON } from './llm';
import type { AISelection, CompatibilityResult, JobDNA, MasterDB } from './types';

// ── Compatibility Check ─────────────────────────────────────────────────────

const COMPAT_SYSTEM = `\
You are a technical career advisor assessing candidate-job fit before resume generation.

Rules:
- Mark compatible:false ONLY when a mandatory_technical_skill has zero coverage across the candidate's
  entire history (no match in any technologies_used across experience or projects, no match in skills).
  Account for common synonyms: React = React.js, Node = Node.js, Postgres = PostgreSQL, K8s = Kubernetes.
- Missing quantifiable metrics: warning only, never a blocker.
- Missing soft skills: warning only, never a blocker.
- Missing nice_to_have_skills: warning only.
- score (0-100): percentage of mandatory_technical_skills covered, weighted by depth of coverage.
- suggestions must be specific: "Add a project using X to projects section" not "improve your DB".

Return ONLY valid JSON. No markdown. No explanation outside the JSON.`;

function compatUser(jobDNA: JobDNA, db: MasterDB): string {
  const techProfile = {
    skills: db.skills,
    experience_tech: db.experience.map((e) => ({ company: e.company, technologies: e.technologies_used })),
    project_tech: db.projects.map((p) => ({ name: p.name, technologies: p.technologies_used })),
  };

  return `\
Assess whether this candidate should apply for this job.

<job_dna>
${JSON.stringify(jobDNA, null, 2)}
</job_dna>

<candidate_tech_profile>
${JSON.stringify(techProfile, null, 2)}
</candidate_tech_profile>

Return JSON matching this exact schema:
{
  "compatible": boolean,
  "score": number (0-100),
  "blockers": ["mandatory tech with zero DB coverage — one per string"],
  "warnings": ["string — weak coverage, missing metrics, or missing nice-to-haves"],
  "suggestions": ["string — specific actionable DB improvements"]
}`;
}

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

function agent2User(jobDNA: JobDNA, db: MasterDB, pages: 1 | 2 = 2): string {
  const pageConstraint =
    pages === 1
      ? '\nPAGE CONSTRAINT (1-PAGE): Must fit one page. Max 2 experience entries, max 2 projects, max 2 bullets each. Skip volunteering/publications/interests. Keep skills concise (≤5 items per category).'
      : '\nPAGE CONSTRAINT (2-PAGE): Use both pages well. Include all relevant sections. Up to 4 bullets per experience, 3 per project.';

  return `\
Select and draft resume content for this candidate targeting this specific role.${pageConstraint}

<job_dna>
${JSON.stringify(jobDNA, null, 2)}
</job_dna>

<candidate_database>
${JSON.stringify(db, null, 2)}
</candidate_database>

Return JSON matching this exact schema:
{
  "reasoning": "string — brief explanation of your selection and ordering strategy",
  "section_order": ["ordered array of section names to include. Available: education | experience | projects | skills | certifications | awards | summary | spoken_languages | volunteering | publications | interests"],
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
  "awards": ["string — award titles from database, include only if they strengthen this specific application"],
  "volunteering": ["string — organization names from volunteering_and_leadership, include if relevant to this role or shows soft skills"],
  "publications": ["string — publication titles from publications_and_speaking, include if relevant"]
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

After revising, add:
- match_score (0-100): how strongly the final resume targets this specific role, based on ATS keyword coverage, bullet quality, and section relevance.
- match_reasoning: one sentence explaining the score.

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

export async function checkCompatibility(jobDNA: JobDNA, db: MasterDB): Promise<CompatibilityResult> {
  return generateJSON<CompatibilityResult>(COMPAT_SYSTEM, compatUser(jobDNA, db));
}

export async function analyzeJob(jd: string, companyInfo: string): Promise<JobDNA> {
  return generateJSON<JobDNA>(AGENT1_SYSTEM, agent1User(jd, companyInfo));
}

export async function selectAndDraft(
  jobDNA: JobDNA,
  db: MasterDB,
  pages: 1 | 2 = 2,
): Promise<AISelection> {
  return generateJSON<AISelection>(AGENT2_SYSTEM, agent2User(jobDNA, db, pages));
}

export async function critiqueAndRevise(
  draft: AISelection,
  jobDNA: JobDNA,
  db: MasterDB,
): Promise<AISelection> {
  return generateJSON<AISelection>(CRITIQUE_SYSTEM, critiqueUser(draft, jobDNA, db));
}
