import { BANNED_FOLLOW_UP_PHRASES, BANNED_PHRASES, BODY_WORD_BANDS, FOLLOW_UP_WORD_BAND, MAX_SUBJECT_LENGTH } from '../core/critic';
import type { AppConfig } from '../config/app-config';
import type { MasterDB } from '../resume/master-db';

import { RunLayout, writeJsonAtomic } from './run-layout';

/**
 * What the writer and researcher agents may know about the candidate. It is
 * written inside runs/<id>/ so the agents never need to read outside the
 * outreach/ folder, and it leaves out phone and email: neither belongs in an
 * email body (the sender appends the signature) and neither is needed to
 * judge fit.
 */
export function buildCandidateBrief(config: AppConfig, db: MasterDB): Record<string, unknown> {
  const { personal_info: person, ...profile } = db;
  return {
    candidate: { name: person.name, location: person.location, links: person.links },
    // Every fact about the candidate comes from this object and nowhere else.
    data_inventory: profile,
    availability: {
      hours_per_week: config.outreach.hours_per_week,
      start_date: config.outreach.start_date,
      summer_internship: config.outreach.summer_internship,
      lines: config.outreach.availability,
    },
    // The one-page budget of tailoring.json; the guard rejects anything over it and a 2-page render is sent back.
    tailoring_limits: {
      max_entries: config.tailoringLimits.maxEntries,
      max_bullets_experience: config.tailoringLimits.maxBulletsExperience,
      max_bullets_project: config.tailoringLimits.maxBulletsProject,
      max_skills_per_category: config.tailoringLimits.maxSkillsPerCategory,
    },
    tracks: Object.fromEntries(Object.entries(config.tracks).map(([track, rules]) => [track, rules.label])),
    critic_rules: {
      subject_max_chars: MAX_SUBJECT_LENGTH,
      body_words: BODY_WORD_BANDS,
      follow_up_words: FOLLOW_UP_WORD_BAND,
      banned_phrases: BANNED_PHRASES,
      banned_follow_up_phrases: BANNED_FOLLOW_UP_PHRASES,
    },
  };
}

export async function writeCandidateBrief(layout: RunLayout, config: AppConfig, db: MasterDB): Promise<string> {
  const path = layout.candidateFile;
  await writeJsonAtomic(path, buildCandidateBrief(config, db));
  return path;
}
