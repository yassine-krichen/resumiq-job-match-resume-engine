import type { MasterDB } from '../resume/master-db';
import { OutreachTailoringSchema } from '../schemas/outreach';
import type { OutreachTailoring } from '../schemas/outreach';

import { guardTailoring } from './bullet-guard';
import { containsWord, extractNumbers } from './text-utils';

// Fallback "track" resumes (ai / swe / fullstack) are built without an LLM:
// entries, bullets and skills are chosen by keyword hits in the candidate's
// own data_inventory, and bullets are the inventory's achievements verbatim.
// Same input, same output.

export interface TrackSelectionRules {
  summary: string;
  keywords: readonly string[];
  max_experiences: number;
  max_projects: number;
  bullets_per_entry: number;
  skills_per_category: number;
}

type ExperienceEntry = MasterDB['experience'][number];
type ProjectEntry = MasterDB['projects'][number];
type Entry = ExperienceEntry | ProjectEntry;

const MIN_BULLET_LENGTH = 10;
const MAX_BULLET_LENGTH = 300;

function nameOf(entry: Entry): string {
  return 'company' in entry ? entry.company : entry.name;
}

function keywordHits(keywords: readonly string[], text: string): number {
  return keywords.filter((keyword) => containsWord(text, keyword)).length;
}

/** Technology hits count double: they are the strongest signal of what an entry is about. */
function entryScore(entry: Entry, keywords: readonly string[]): number {
  const technologies = keywordHits(keywords, entry.technologies_used.join('\n'));
  const prose = keywordHits(
    keywords,
    [nameOf(entry), 'role' in entry ? entry.role : '', 'context' in entry ? entry.context : '', ...entry.raw_achievements].join('\n'),
  );
  return technologies * 2 + prose;
}

/** Highest score first; inventory order breaks ties (the inventory lists the most recent first). */
function rank<T extends Entry>(entries: readonly T[], keywords: readonly string[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: entryScore(entry, keywords) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Projects of the inventory, best match for the track first. Used to pick the generic email's proof project. */
export function rankProjects(db: MasterDB, keywords: readonly string[]): ProjectEntry[] {
  return rank(db.projects, keywords);
}

function bulletsPassGuard(entry: Entry, bullet: string, db: MasterDB): boolean {
  const kind = 'company' in entry ? 'experience' : 'project';
  const name = nameOf(entry);
  const single: OutreachTailoring = {
    summary: 'x'.repeat(20),
    entries: [{ kind, name, bullets: [{ text: bullet, source_entry: name }] }],
    skills: { programming_languages: [], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [] },
  };
  return guardTailoring(single, db).pass;
}

function chooseBullets(entry: Entry, rules: TrackSelectionRules, db: MasterDB): string[] {
  const candidates = entry.raw_achievements
    .map((text, index) => ({ text: text.trim(), index }))
    .filter(({ text }) => text.length >= MIN_BULLET_LENGTH && text.length <= MAX_BULLET_LENGTH)
    .filter(({ text }) => bulletsPassGuard(entry, text, db))
    .map((candidate) => ({
      ...candidate,
      score: keywordHits(rules.keywords, candidate.text) * 2 + (extractNumbers(candidate.text).length > 0 ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, rules.bullets_per_entry);
  return candidates.sort((a, b) => a.index - b.index).map(({ text }) => text);
}

function orderSkills(all: readonly string[], keywords: readonly string[], used: ReadonlySet<string>, limit: number): string[] {
  const priority = (skill: string): number =>
    keywordHits(keywords, skill) > 0 ? 0 : used.has(skill.toLowerCase()) ? 1 : 2;
  return all
    .map((skill, index) => ({ skill, index }))
    .sort((a, b) => priority(a.skill) - priority(b.skill) || a.index - b.index)
    .slice(0, limit)
    .map(({ skill }) => skill);
}

/**
 * Builds the tailoring of one track. Throws when the inventory cannot fill a
 * valid tailoring (fewer than two usable entries) or when the configured
 * summary names something the profile does not have.
 */
export function buildTrackTailoring(db: MasterDB, rules: TrackSelectionRules): OutreachTailoring {
  const picked: Array<{ kind: 'experience' | 'project'; entry: Entry }> = [
    ...rank(db.experience, rules.keywords).map((entry) => ({ kind: 'experience' as const, entry })),
    ...rank(db.projects, rules.keywords).map((entry) => ({ kind: 'project' as const, entry })),
  ];

  const entries: OutreachTailoring['entries'] = [];
  const counts = { experience: 0, project: 0 };
  const limits = { experience: rules.max_experiences, project: rules.max_projects };
  for (const { kind, entry } of picked) {
    if (counts[kind] >= limits[kind]) continue;
    const bullets = chooseBullets(entry, rules, db);
    if (bullets.length === 0) continue;
    const name = nameOf(entry);
    entries.push({ kind, name, bullets: bullets.map((text) => ({ text, source_entry: name })) });
    counts[kind] += 1;
  }

  const selected = entries.map((chosen) => (chosen.kind === 'experience'
    ? db.experience.find((entry) => entry.company === chosen.name)
    : db.projects.find((entry) => entry.name === chosen.name)) as Entry);
  const used = new Set(selected.flatMap((entry) => entry.technologies_used.map((tech) => tech.toLowerCase())));
  const limit = rules.skills_per_category;

  const tailoring = OutreachTailoringSchema.parse({
    summary: rules.summary,
    entries,
    skills: {
      programming_languages: orderSkills(db.skills.programming_languages, rules.keywords, used, limit),
      frameworks_and_libraries: orderSkills(db.skills.frameworks_and_libraries, rules.keywords, used, limit),
      infrastructure_and_tools: orderSkills(db.skills.infrastructure_and_tools, rules.keywords, used, limit),
      databases: orderSkills(db.skills.databases, rules.keywords, used, limit),
    },
  });

  const guard = guardTailoring(tailoring, db);
  if (!guard.pass) {
    const lines = guard.violations.map((violation) => `${violation.where}: ${violation.detail}`);
    throw new Error(`Track resume fails the bullet guard (fix the track summary in the config):\n  ${lines.join('\n  ')}`);
  }
  return tailoring;
}
