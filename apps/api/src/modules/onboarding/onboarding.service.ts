import { Injectable, Logger } from '@nestjs/common';
import { generateJSON } from '@resumiq/ai-bridge';
import type { MasterDB } from '@resumiq/ai-bridge';
import { IngestEntrySchema, type IngestEntryDto, type IngestResultDto } from '@resumiq/schemas';

/** Generic, client-facing message — never leak internal zod schema details to the browser. */
const PARSE_FAILURE_MESSAGE =
  "Couldn't parse that text into your profile — try rephrasing or breaking it into shorter pieces.";

const INGEST_SYSTEM = `\
You are a career data extraction expert. Parse the raw career text and extract structured data.

The raw text may describe MULTIPLE distinct career facts — jobs, projects, certifications,
courses, education, awards, skills, professional summaries, publications/talks, volunteering,
and personal interests. Extract EVERY distinct item as its own separate entry in the "entries"
array. Never merge unrelated items into one entry. Never omit an item because it doesn't fit
the most prominent type. A short course/certification mention (e.g. "completed X course")
becomes its own certification entry (issuer = course provider) — do not fold it into an
experience or project entry.

Rules:
- If the input does not contain any genuine career fact (e.g. it's gibberish, markup/code,
  spam, or unrelated prose with nothing resembling a job, project, certification, education
  entry, award, or skill), return {"entries": []} rather than inventing an entry or echoing the
  raw input back as a field value.
- Extract exactly what is stated. Do NOT infer, embellish, or invent metrics, technologies,
  dates, or outcomes not stated or clearly implied by the source text.
- For experience/project entries, REWRITE raw_achievements as 2-5 concise, professional
  resume-style bullets: action verb + what was built/done + technology used + outcome if
  stated. Do not paste raw keyword fragments verbatim — polish them into real bullets, but
  never invent details the source text doesn't support.
- For skills, deduplicate and normalize technology names (e.g. "React.js" → "React").
- Return the most specific type that matches each item.

Return ONLY valid JSON. No markdown. No explanation.`;

function buildIngestPrompt(rawText: string, existingDb: Partial<MasterDB> | null): string {
  return `\
Parse this career text and return every distinct career fact it contains as a separate entry.

<raw_text>
${rawText}
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
        // { name, context, links[], startDate, endDate, technologies_used[], raw_achievements[], quantifiable_metrics[] }
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
    const raw = await generateJSON<unknown>(
      INGEST_SYSTEM,
      buildIngestPrompt(rawText, existingDb),
    );

    // Top-level shape check only — each entry is validated individually below
    // so that one malformed entry doesn't discard every other valid entry the
    // LLM extracted in the same response.
    const rawEntries =
      typeof raw === 'object' && raw !== null && Array.isArray((raw as { entries?: unknown }).entries)
        ? (raw as { entries: unknown[] }).entries
        : null;

    if (rawEntries === null) {
      this.logger.warn(
        `AI returned an invalid career data shape (missing/malformed "entries" array): ${JSON.stringify(raw)}`,
      );
      throw new Error(PARSE_FAILURE_MESSAGE);
    }

    const entries: IngestEntryDto[] = [];
    let droppedCount = 0;
    for (const rawEntry of rawEntries) {
      const parsed = IngestEntrySchema.safeParse(rawEntry);
      if (parsed.success) {
        entries.push(parsed.data);
      } else {
        droppedCount += 1;
        this.logger.warn(
          `Dropping one AI-extracted entry that failed validation: ${parsed.error.message}`,
        );
      }
    }

    if (entries.length === 0) {
      this.logger.warn('AI response yielded zero valid entries after per-entry validation.');
      throw new Error(PARSE_FAILURE_MESSAGE);
    }

    onProgress?.('Parsed successfully');
    return { entries, droppedCount };
  }
}
