import type { AISelection } from '@resumiq/ai-bridge';

import { resolveExperience, resolveProject } from './inventory-index';
import type { EntrySlice, InventoryIndex } from './inventory-index';

export type ClaimKind = 'bullet' | 'summary' | 'header' | 'skill' | 'title';
export type ClaimSection =
  | 'experience'
  | 'projects'
  | 'summary'
  | 'skills'
  | 'certifications'
  | 'awards'
  | 'volunteering'
  | 'publications';

export interface Claim {
  id: string;
  kind: ClaimKind;
  section: ClaimSection;
  text: string;
  entryLabel: string;
  /** Inventory entry the claim is attributed to; null when the entry does not exist. */
  entry: EntrySlice | null;
  /** header claims only: the role/title matches the inventory entry. */
  titleMatches?: boolean;
}

/** Narrative claims (bullets and summary) are the headline unit; the rest are listing claims. */
export const isNarrative = (c: Pick<Claim, 'kind'>): boolean =>
  c.kind === 'bullet' || c.kind === 'summary';

/**
 * Flattens an AISelection into checkable claims. `reasoning`, `match_score`
 * and `match_reasoning` are meta-commentary, not resume content, and are skipped.
 */
export function extractClaims(selection: AISelection, index: InventoryIndex): Claim[] {
  const claims: Claim[] = [];

  if (selection.summary && selection.summary.trim()) {
    claims.push({
      id: 'sum',
      kind: 'summary',
      section: 'summary',
      text: selection.summary.trim(),
      entryLabel: 'summary',
      entry: null,
    });
  }

  selection.experience.forEach((exp, i) => {
    const match = resolveExperience(index, exp.company, exp.role);
    claims.push({
      id: `exp${i}.h`,
      kind: 'header',
      section: 'experience',
      text: `${exp.company} | ${exp.role}`,
      entryLabel: exp.company,
      entry: match.slice,
      titleMatches: match.titleMatches,
    });
    exp.bullets.forEach((b, j) =>
      claims.push({
        id: `exp${i}.b${j}`,
        kind: 'bullet',
        section: 'experience',
        text: b,
        entryLabel: exp.company,
        entry: match.slice,
      }),
    );
  });

  selection.projects.forEach((prj, i) => {
    const slice = resolveProject(index, prj.name);
    claims.push({
      id: `prj${i}.h`,
      kind: 'header',
      section: 'projects',
      text: prj.name,
      entryLabel: prj.name,
      entry: slice,
      titleMatches: true,
    });
    prj.bullets.forEach((b, j) =>
      claims.push({
        id: `prj${i}.b${j}`,
        kind: 'bullet',
        section: 'projects',
        text: b,
        entryLabel: prj.name,
        entry: slice,
      }),
    );
  });

  const skillLists: Array<[string, string[]]> = [
    ['languages', selection.skills.languages],
    ['frameworks', selection.skills.frameworks_and_libraries],
    ['tools', selection.skills.infrastructure_and_tools],
    ['databases', selection.skills.databases],
  ];
  for (const [name, items] of skillLists) {
    items.forEach((item, i) =>
      claims.push({
        id: `skill.${name}.${i}`,
        kind: 'skill',
        section: 'skills',
        text: item,
        entryLabel: name,
        entry: null,
      }),
    );
  }

  const titleLists: Array<[ClaimSection, string, string[]]> = [
    ['certifications', 'cert', selection.certifications],
    ['awards', 'award', selection.awards],
    ['volunteering', 'vol', selection.volunteering ?? []],
    ['publications', 'pub', selection.publications ?? []],
  ];
  for (const [section, prefix, items] of titleLists) {
    items.forEach((item, i) =>
      claims.push({
        id: `${prefix}.${i}`,
        kind: 'title',
        section,
        text: item,
        entryLabel: section,
        entry: null,
      }),
    );
  }

  return claims;
}
