import type { MasterDB } from '@resumiq/ai-bridge';

import { techKey, normalizeText, phraseMatches } from './normalize';
import { numberSet } from './numbers';
import { buildVocabulary, COMMON_TECH, detectTech, looksLikeTechTerm } from './tech-vocabulary';
import type { VocabEntry } from './tech-vocabulary';

export interface EntrySlice {
  type: 'experience' | 'project';
  index: number;
  label: string;
  text: string;
  techKeys: Set<string>;
  numbers: Set<string>;
  json: unknown;
}

export interface InventoryIndex {
  db: MasterDB;
  vocab: VocabEntry[];
  vocabKeys: Set<string>;
  experience: EntrySlice[];
  projects: EntrySlice[];
  globalTechKeys: Set<string>;
  globalNumbers: Set<string>;
  skillItems: string[];
  skillKeys: Set<string>;
  certifications: string[];
  awards: string[];
  volunteering: string[];
  publications: string[];
}

function flattenStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => flattenStrings(v, out));
  else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((v) => flattenStrings(v, out));
  }
  return out;
}

function skillStrings(db: MasterDB): string[] {
  const s = db.skills;
  return [
    ...s.programming_languages,
    ...s.frameworks_and_libraries,
    ...s.infrastructure_and_tools,
    ...s.databases,
  ];
}

/**
 * Precomputes per-entry text, technology keys and number sets from the
 * inventory. `jdTerms` (the posting's required/nice-to-have skills) are added
 * to the detection vocabulary because injecting job-description technology is
 * the failure this evaluation is looking for.
 */
export function buildIndex(db: MasterDB, jdTerms: readonly string[] = []): InventoryIndex {
  const inventoryTech = [
    ...db.experience.flatMap((e) => e.technologies_used),
    ...db.projects.flatMap((p) => p.technologies_used),
    ...skillStrings(db),
  ];
  const vocab = buildVocabulary([
    ...inventoryTech,
    ...COMMON_TECH,
    ...jdTerms.filter((t) => t.length <= 30 && looksLikeTechTerm(t)),
  ]);
  const vocabKeys = new Set(vocab.map((v) => v.key));

  const slice = (
    type: EntrySlice['type'],
    index: number,
    label: string,
    entry: { technologies_used: string[] },
  ): EntrySlice => {
    const text = flattenStrings(entry).join('\n');
    const techKeys = new Set(entry.technologies_used.map(techKey));
    detectTech(text, vocab).forEach((k) => techKeys.add(k));
    return { type, index, label, text, techKeys, numbers: numberSet(text), json: entry };
  };

  const experience = db.experience.map((e, i) => slice('experience', i, e.company, e));
  const projects = db.projects.map((p, i) => slice('project', i, p.name, p));

  const globalText = flattenStrings(db).join('\n');
  const globalTechKeys = new Set(inventoryTech.map(techKey));
  detectTech(globalText, vocab).forEach((k) => globalTechKeys.add(k));
  // Spoken languages are legitimate skills-section items but not technologies.
  const skillItems = [...skillStrings(db), ...db.skills.spoken_languages.map((l) => l.language)];

  return {
    db,
    vocab,
    vocabKeys,
    experience,
    projects,
    globalTechKeys,
    globalNumbers: numberSet(globalText),
    skillItems,
    // A skill is grounded if it appears anywhere in the inventory (skills lists, entry
    // technologies, or entry text), not only in the skills section.
    skillKeys: new Set([...skillItems.map(techKey), ...globalTechKeys]),
    certifications: db.certifications.map((c) => c.name),
    awards: db.awards_and_honors.map((a) => a.title),
    volunteering: db.volunteering_and_leadership.map((v) => v.organization),
    publications: db.publications_and_speaking.map((p) => p.title),
  };
}

export interface EntryMatch {
  slice: EntrySlice | null;
  titleMatches: boolean;
}

function findByName(slices: EntrySlice[], name: string): EntrySlice | null {
  const n = normalizeText(name);
  return (
    slices.find((s) => normalizeText(s.label) === n) ??
    slices.find((s) => phraseMatches(s.label, name)) ??
    null
  );
}

export function resolveExperience(index: InventoryIndex, company: string, role: string): EntryMatch {
  const slice = findByName(index.experience, company);
  if (!slice) return { slice: null, titleMatches: false };
  const inventoryRole = index.db.experience[slice.index].role;
  return { slice, titleMatches: phraseMatches(role, inventoryRole) };
}

/**
 * A project name that is not a project entry but is named inside an experience
 * entry (e.g. a deliverable listed under an internship) is a mis-sectioned real
 * item, not a fabrication: it resolves to that experience entry.
 */
export function resolveProject(index: InventoryIndex, name: string): EntrySlice | null {
  const direct = findByName(index.projects, name);
  if (direct) return direct;
  const n = normalizeText(name);
  if (n.length < 4) return null;
  return index.experience.find((e) => ` ${normalizeText(e.text)} `.includes(` ${n} `)) ?? null;
}
