import { Injectable } from '@nestjs/common';
import { generateJSON } from '@resumiq/ai-bridge';
import type { MasterDB } from '@resumiq/ai-bridge';

type SupportedSection = 'experience' | 'project' | 'education' | 'certification' | 'award' | 'skills';

interface IngestResult {
  type: SupportedSection;
  entry: unknown;
}

const INGEST_SYSTEM = `\
You are a career data extraction expert. Parse the raw career text and extract structured data.

Rules:
- Extract exactly what is stated. Do NOT infer, embellish, or invent metrics.
- For experience/project entries, copy raw_achievements verbatim from the text.
- For skills, deduplicate and normalize technology names (e.g. "React.js" → "React").
- Return the most specific type that matches the content.

Return ONLY valid JSON. No markdown. No explanation.`;

function buildIngestPrompt(rawText: string, existingDb: Partial<MasterDB> | null): string {
  return `\
Parse this career text and return a structured entry.

<raw_text>
${rawText}
</raw_text>

${existingDb ? `<existing_profile_context>\nCurrent tech stack: ${JSON.stringify((existingDb.skills?.programming_languages ?? []).concat(existingDb.skills?.frameworks_and_libraries ?? []).slice(0, 20))}\n</existing_profile_context>` : ''}

Return JSON matching this exact schema:
{
  "type": "experience" | "project" | "education" | "certification" | "award" | "skills",
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
  }
}`;
}

@Injectable()
export class OnboardingService {
  async parseCareerText(
    rawText: string,
    existingDb: Partial<MasterDB> | null,
    onProgress?: (step: string) => void,
  ): Promise<IngestResult> {
    onProgress?.('Analyzing text...');
    const result = await generateJSON<IngestResult>(
      INGEST_SYSTEM,
      buildIngestPrompt(rawText, existingDb),
    );
    onProgress?.('Parsed successfully');
    return result;
  }
}
