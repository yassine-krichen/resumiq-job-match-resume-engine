import type { MasterDB } from '../resume/master-db';
import type { AISelection, SectionType } from '../resume/types';
import type { OutreachTailoring } from '../schemas/outreach';

import { findSourceEntry } from './bullet-guard';

// The renderer fuzzy-matches names and silently skips an entry it cannot find,
// which would ship a resume missing the section the tailoring was built around.
// Resolve exactly here and fail loudly instead.

/**
 * Converts a tailoring into the AISelection the existing resume renderer takes.
 * Names are resolved to the data_inventory spelling; throws on an unknown entry.
 */
export function buildSelection(tailoring: OutreachTailoring, db: MasterDB): AISelection {
  const experience: AISelection['experience'] = [];
  const projects: AISelection['projects'] = [];
  const sections: SectionType[] = [];

  for (const entry of tailoring.entries) {
    const source = findSourceEntry(db, entry.kind, entry.name);
    if (!source) {
      throw new Error(`Unknown ${entry.kind} "${entry.name}": not found in data_inventory`);
    }
    const bullets = entry.bullets.map((bullet) => bullet.text);

    if ('company' in source) {
      experience.push({ company: source.company, role: source.role, bullets });
      if (!sections.includes('experience')) sections.push('experience');
    } else {
      projects.push({ name: source.name, bullets });
      if (!sections.includes('projects')) sections.push('projects');
    }
  }

  return {
    reasoning: 'Tailored by the outreach writer; guarded by bullet-guard.',
    // The section the writer listed first leads, and the renderer prepends education itself.
    section_order: [...sections, 'skills'],
    summary: tailoring.summary,
    experience,
    projects,
    skills: {
      languages: tailoring.skills.programming_languages,
      frameworks_and_libraries: tailoring.skills.frameworks_and_libraries,
      infrastructure_and_tools: tailoring.skills.infrastructure_and_tools,
      databases: tailoring.skills.databases,
    },
    certifications: [],
    awards: [],
  };
}
