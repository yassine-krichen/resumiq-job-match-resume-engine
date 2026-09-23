import { Injectable, Logger } from '@nestjs/common';
import { generateJSON } from '@resumiq/ai-bridge';
import type { MasterDB } from '@resumiq/ai-bridge';
import { toIngestDraft, type IngestDraftEntryDto, type IngestResultDto } from '@resumiq/schemas';

/**
 * Thrown only for failures that are safe to show the user verbatim (generic,
 * no internal details). `ingestStream` forwards `.message` from this type
 * only — anything else gets logged server-side and replaced with a generic
 * message before it reaches the client.
 */
export class IngestUserFacingError extends Error {}

const PARSE_FAILURE_MESSAGE =
  "Couldn't parse that text into your profile — try rephrasing or breaking it into shorter pieces.";

const PARSE_TIMEOUT_MESSAGE =
  'Taking longer than expected — try shortening the input or try again.';

/**
 * How often to emit a heartbeat `progress` event while `generateJSON()` is
 * in flight. The frontend's SSE client resets an idle timer only when bytes
 * arrive, and a single LLM call can legitimately run tens of seconds with no
 * intermediate output — this keeps bytes flowing so it isn't mistaken for a
 * hung connection.
 */
const HEARTBEAT_INTERVAL_MS = 12_000;

/**
 * Server-side gives up and reports a clean error rather than leaving
 * `callFreellmapi`'s hard upstream abort (see `packages/ai-bridge/src/llm.ts`)
 * as the only signal. Measured directly against the real freellmapi "auto"
 * pool with the actual ingest prompt: 8 live single-call runs ranged 32–114s,
 * and a separate pass of 5 end-to-end runs saw 1/5 exceed 120s — the 120s cap
 * was still cutting off real, eventually-successful calls. 170s covers that
 * observed tail with headroom before `callFreellmapi`'s upstream abort (180s,
 * see llm.ts) would cut the request off mid-flight, so this clean timeout
 * message wins instead of the raw abort. The frontend's SSE idle timeout
 * (60s, `apps/web/src/lib/api.ts`) resets on every heartbeat byte
 * (`HEARTBEAT_INTERVAL_MS` below), not on total duration, so it stays
 * satisfied regardless of how long this runs.
 */
const PARSE_TIMEOUT_MS = 170_000;

const INGEST_SYSTEM = `\
You are a career data extraction expert. Parse the raw career text and extract structured data.

The raw text may describe MULTIPLE distinct career facts — jobs, projects, certifications,
courses, education, awards, skills, professional summaries, publications/talks, volunteering,
and personal interests. Extract EVERY distinct item as its own separate entry in the "entries"
array — one entry per role/degree/project/cert/etc, even if a paste mixes several types. Never
merge unrelated items into one entry. Never omit an item because it doesn't fit the most
prominent type. A short course/certification mention (e.g. "completed X course") becomes its
own certification entry (issuer = course provider) — do not fold it into an experience or
project entry.

Output shape rules (STRICT — the parser is exact-match, do not deviate):
- Use EXACTLY one of these type literals, lowercase: "experience", "project", "education",
  "certification", "award", "skills", "summary", "publication", "volunteering", "interest".
- Every array field (e.g. technologies_used, raw_achievements, core_competencies, honors) MUST
  be a JSON array of strings — never a comma/newline-joined string.
- "isCurrent" MUST be a JSON boolean (true/false), never a string.
- For a currently-held experience/volunteering entry, set "endDate" to "" (empty string, never
  the word "Present"/"Current"/etc.) and "isCurrent" to true.
- "gpa" MUST be a JSON string (e.g. "3.8"), not a number.
- Each entry's fields go directly under its own "entry" key — never nested further, never
  flattened onto the outer object.
- Omit a field you have no information for rather than guessing or inventing a value.

Content rules:
- If the input does not contain any genuine career fact (e.g. it's gibberish, markup/code,
  spam, or unrelated prose with nothing resembling a job, project, certification, education
  entry, award, or skill), return {"entries": []} rather than inventing an entry or echoing the
  raw input back as a field value.
- Extract exactly what is stated. Do NOT infer, embellish, or invent metrics, technologies,
  dates, companies, or outcomes not stated or clearly implied by the source text.
- PROFESSIONAL REWRITE for experience/project raw_achievements: rewrite as 2-5 concise,
  resume-style bullets — strong action verb + what was built/done + technology used + outcome
  if stated. Past tense for past roles, present tense for current ones. Fix grammar/spelling.
  Do not paste raw keyword fragments verbatim — polish them into real bullets, but never invent
  a detail (company, date, metric, technology, outcome) the source text doesn't support. Keep
  every fact from the source; only the wording changes.
- For skills, deduplicate and normalize technology names (e.g. "React.js" → "React").
- Normalize dates to "MMM YYYY" or "YYYY" (whichever the source supports) — don't invent a
  specific month the source doesn't state.
- Return the most specific type that matches each item.

Return ONLY valid JSON. No markdown. No explanation.`;

/**
 * Neutralizes literal `<raw_text>`/`</raw_text>` occurrences (case-insensitive)
 * in user-pasted text before it's embedded in the prompt, so a paste
 * containing those exact tags can't break out of the delimiter and inject
 * additional prompt instructions.
 */
function escapeRawTextDelimiters(text: string): string {
  return text.replace(/<(\/?raw_text)>/gi, '&lt;$1&gt;');
}

function buildIngestPrompt(rawText: string, existingDb: Partial<MasterDB> | null): string {
  return `\
Parse this career text and return every distinct career fact it contains as a separate entry.

<raw_text>
${escapeRawTextDelimiters(rawText)}
</raw_text>

${existingDb ? `<existing_profile_context>\nCurrent tech stack: ${JSON.stringify((existingDb.skills?.programming_languages ?? []).concat(existingDb.skills?.frameworks_and_libraries ?? []).slice(0, 20))}\n</existing_profile_context>` : ''}

Return JSON matching this exact schema:
{
  "entries": [
    {
      "type": "experience" | "project" | "education" | "certification" | "award" | "skills" | "summary" | "publication" | "volunteering" | "interest",
      "entry": {
        // For type "experience":
        // { company, company_industry, role, location, location_type, startDate, endDate, isCurrent, core_competencies[], technologies_used[], raw_achievements[], quantifiable_metrics[] }
        //
        // For type "project":
        // { name, context, links[] (each { type, url }), startDate, endDate, technologies_used[], raw_achievements[], quantifiable_metrics[] }
        //
        // For type "education":
        // { institution, degree_type, major, minor, location, startDate, endDate, gpa, honors[], relevant_coursework[], thesis_or_capstone, extracurriculars[], description }
        //
        // For type "certification":
        // { name, issuer, date, expiration_date, credential_id, link, description }
        //
        // For type "award":
        // { title, issuer, date, description }
        //
        // For type "skills":
        // { programming_languages[], frameworks_and_libraries[], infrastructure_and_tools[], databases[], soft_skills[] }
        //
        // For type "summary" — a professional summary/elevator pitch, usually written for a
        // specific target role (e.g. "Full-stack engineer summary for backend roles: ..."):
        // { target_role, content }
        //
        // For type "publication" — a published article, paper, conference talk, or podcast
        // appearance (e.g. "Spoke at ReactConf 2024 about...", "Published a paper in..."):
        // { title, venue, date, url, description }
        //
        // For type "volunteering" — unpaid work, community leadership, or non-profit board
        // roles (e.g. "Volunteered as a mentor at Code.org", "Led the local dev meetup"):
        // { organization, role, location, startDate, endDate, isCurrent, description }
        //
        // For type "interest" — a single personal/hobby interest mentioned outside a
        // professional context (e.g. "enjoys chess", "runs marathons"). One interest per
        // entry — a plain string, not an object:
        // "Competitive Programming"
      }
    }
    // ...one object per distinct career fact found in the text
  ]
}

Worked example — a paste mixing experience, a project, and education:

Input:
"""
Worked as a Backend Engineer at Acme Corp from Jan 2023 to present, remote. Built a real-time
notification system using NestJS and Redis handling 50k events/day, and cut API latency by 40%
via query optimization. Also built a side project, a CLI tool called "gitstat" (2022) in Go that
parses commit history — used by ~200 devs, hosted at github.com/example/gitstat. BS in Computer
Science from State University, 2018-2022, GPA 3.7, minored in Math.
"""

Output:
{
  "entries": [
    {
      "type": "experience",
      "entry": {
        "company": "Acme Corp",
        "role": "Backend Engineer",
        "location_type": "Remote",
        "startDate": "Jan 2023",
        "endDate": "",
        "isCurrent": true,
        "technologies_used": ["NestJS", "Redis"],
        "raw_achievements": [
          "Built a real-time notification system using NestJS and Redis handling 50k events/day",
          "Reduced API latency by 40% through query optimization"
        ],
        "quantifiable_metrics": ["50k events/day", "40% latency reduction"]
      }
    },
    {
      "type": "project",
      "entry": {
        "name": "gitstat",
        "context": "CLI tool that parses commit history",
        "links": [{ "type": "repo", "url": "github.com/example/gitstat" }],
        "startDate": "2022",
        "endDate": "2022",
        "technologies_used": ["Go"],
        "raw_achievements": ["Built a commit-history-parsing CLI tool used by ~200 developers"],
        "quantifiable_metrics": ["~200 users"]
      }
    },
    {
      "type": "education",
      "entry": {
        "institution": "State University",
        "degree_type": "BS",
        "major": "Computer Science",
        "minor": "Math",
        "startDate": "2018",
        "endDate": "2022",
        "gpa": "3.7"
      }
    }
  ]
}`;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  async parseCareerText(
    rawText: string,
    existingDb: Partial<MasterDB> | null,
    onProgress?: (step: string) => void,
  ): Promise<IngestResultDto> {
    onProgress?.('Analyzing text...');

    const heartbeat = setInterval(() => {
      onProgress?.('Still analyzing...');
    }, HEARTBEAT_INTERVAL_MS);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let raw: unknown;
    try {
      raw = await Promise.race([
        generateJSON<unknown>(INGEST_SYSTEM, buildIngestPrompt(rawText, existingDb)),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new IngestUserFacingError(PARSE_TIMEOUT_MESSAGE)),
            PARSE_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeoutId);
    }

    // Top-level shape check only — each entry is turned into a draft
    // individually below so that one malformed entry doesn't discard every
    // other valid entry the LLM extracted in the same response.
    const rawEntries =
      typeof raw === 'object' && raw !== null && Array.isArray((raw as { entries?: unknown }).entries)
        ? (raw as { entries: unknown[] }).entries
        : null;

    if (rawEntries === null) {
      this.logger.warn(
        `AI returned an invalid career data shape (missing/malformed "entries" array): ${JSON.stringify(raw)}`,
      );
      throw new IngestUserFacingError(PARSE_FAILURE_MESSAGE);
    }

    const entries: IngestDraftEntryDto[] = [];
    const droppedEntries: IngestResultDto['droppedEntries'] = [];
    let incompleteCount = 0;

    for (const rawEntry of rawEntries) {
      const draft = toIngestDraft(rawEntry);
      if ('reason' in draft) {
        droppedEntries.push(draft);
        this.logger.warn(`Dropping AI-extracted entry (type="${draft.type}"): ${draft.reason}`);
        continue;
      }
      entries.push(draft);
      if (draft.missingFields.length > 0) {
        incompleteCount += 1;
        this.logger.log(
          `AI-extracted "${draft.type}" entry is incomplete — missing/invalid fields: ${draft.missingFields.join(', ')}`,
        );
      }
    }

    // Incomplete drafts still count as survivors here — they're only barred
    // from being *saved* (ConfirmIngestSchema re-validates strictly). Only
    // bail out to the user-facing failure when literally nothing survived.
    if (entries.length === 0) {
      this.logger.warn('AI response yielded zero survivable entries (all dropped).');
      throw new IngestUserFacingError(PARSE_FAILURE_MESSAGE);
    }

    onProgress?.('Parsed successfully');
    return { entries, droppedEntries };
  }
}
