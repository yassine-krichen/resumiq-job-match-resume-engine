import { config } from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline/promises';
import { join } from 'path';
import { generateJSON } from './llm';
import type { MasterDB } from './types';

config({ path: join(__dirname, '..', '.env') });

const DB_PATH = join(__dirname, '..', '..', 'data_inventory.json');

const INGEST_SYSTEM = `\
You are a career data parser. Convert raw career text into a structured JSON entry for a resume database.

Rules:
- Extract only what is explicitly stated. Never invent metrics not mentioned in the text.
- Keep raw_achievements as verbatim statements from the input, lightly cleaned.
- Put specific numbers or percentages in quantifiable_metrics as well.
- Dates: use "Mon YYYY" format (e.g., "Jan 2024").
- Determine the entry type from the content:
  - experience: a job, internship, or role at a company
  - project: a personal or side project
  - education: a degree, course, or certificate from an institution
  - certification: a professional certification with an issuer
  - award: a prize, honor, or recognition
  - skills: a list of technologies or tools to add to the skills section

Return ONLY valid JSON. No markdown. No explanation outside the JSON.`;

function ingestUserPrompt(rawText: string, db: MasterDB): string {
  const techProfile = {
    existing_skills: db.skills,
    existing_companies: db.experience.map((e) => e.company),
    existing_projects: db.projects.map((p) => p.name),
  };

  return `\
Parse this career text into a structured database entry.

<raw_text>
${rawText}
</raw_text>

<existing_db_context>
${JSON.stringify(techProfile, null, 2)}
</existing_db_context>

Return JSON with this shape (pick the matching type):

For experience:
{
  "type": "experience",
  "entry": {
    "company": "string", "company_industry": "string", "role": "string",
    "location": "string", "location_type": "Remote|On-site|Hybrid",
    "startDate": "Mon YYYY", "endDate": "Mon YYYY or Present",
    "isCurrent": boolean,
    "core_competencies": ["string"],
    "technologies_used": ["string"],
    "raw_achievements": ["string — verbatim from text"],
    "quantifiable_metrics": ["string — numbers/percentages only"]
  }
}

For project:
{
  "type": "project",
  "entry": {
    "name": "string", "context": "string",
    "links": [{ "type": "GitHub|Live|Demo", "url": "string" }],
    "startDate": "Mon YYYY", "endDate": "Mon YYYY or Present",
    "technologies_used": ["string"],
    "raw_achievements": ["string"],
    "quantifiable_metrics": ["string"]
  }
}

For skills:
{
  "type": "skills",
  "entry": {
    "programming_languages": ["string"],
    "frameworks_and_libraries": ["string"],
    "infrastructure_and_tools": ["string"],
    "databases": ["string"]
  }
}

For education/certification/award — use the appropriate fields (institution, degree_type, major, gpa for education; name, issuer, date for certification/award).`;
}

async function readStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('DB Ingest — paste raw career text, then press Enter twice to submit:');
  console.log('(Ctrl+C to cancel)\n');

  const lines: string[] = [];
  let emptyCount = 0;

  for await (const line of rl) {
    if (line === '') {
      emptyCount++;
      if (emptyCount >= 2) break;
    } else {
      emptyCount = 0;
      lines.push(line);
    }
  }
  rl.close();
  return lines.join('\n').trim();
}

async function main(): Promise<void> {
  if (!existsSync(DB_PATH)) {
    throw new Error(`data_inventory.json not found at ${DB_PATH}`);
  }

  const db: MasterDB = JSON.parse(readFileSync(DB_PATH, 'utf-8'));

  const rawText = await readStdin();
  if (!rawText) {
    console.log('No input. Cancelled.');
    process.exit(0);
  }

  console.log('\nParsing...');
  const result = await generateJSON<{ type: string; entry: Record<string, unknown> }>(
    INGEST_SYSTEM,
    ingestUserPrompt(rawText, db),
  );

  console.log('\nParsed entry:');
  console.log(JSON.stringify(result, null, 2));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await rl.question('\nMerge into data_inventory.json? [y/N] ');
  rl.close();

  if (confirm.trim().toLowerCase() !== 'y') {
    console.log('Cancelled. No changes made.');
    process.exit(0);
  }

  const entry = result.entry;

  switch (result.type) {
    case 'experience':
      db.experience.push(entry as unknown as (typeof db.experience)[0]);
      break;
    case 'project':
      db.projects.push(entry as unknown as (typeof db.projects)[0]);
      break;
    case 'education':
      db.education.push(entry as unknown as (typeof db.education)[0]);
      break;
    case 'certification':
      db.certifications.push(entry as unknown as (typeof db.certifications)[0]);
      break;
    case 'award':
      db.awards_and_honors.push(entry as unknown as (typeof db.awards_and_honors)[0]);
      break;
    case 'skills': {
      const s = entry as Partial<typeof db.skills>;
      const merge = (a: string[], b: string[] = []): string[] => [...new Set([...a, ...b])];
      db.skills.programming_languages = merge(db.skills.programming_languages, s.programming_languages);
      db.skills.frameworks_and_libraries = merge(db.skills.frameworks_and_libraries, s.frameworks_and_libraries);
      db.skills.infrastructure_and_tools = merge(db.skills.infrastructure_and_tools, s.infrastructure_and_tools);
      db.skills.databases = merge(db.skills.databases, s.databases);
      break;
    }
    default:
      console.log(`Unknown type "${result.type}". No changes made.`);
      process.exit(1);
  }

  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  console.log(`\n✓ Merged "${result.type}" entry into data_inventory.json`);
  console.log('  Run npm run validate-db to verify.');
}

main().catch((err: Error) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
