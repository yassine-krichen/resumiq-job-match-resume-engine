import { z } from 'zod';

export const SECTIONS = [
  'summary',
  'experience',
  'education',
  'projects',
  'certifications',
  'awards',
  'volunteering',
  'skills',
] as const;

export type Section = (typeof SECTIONS)[number];

export const SectionSchema = z.enum(SECTIONS);

/** Where each section lives in data_inventory.json. `personal_info` is deliberately absent. */
export const SECTION_KEYS: Record<Exclude<Section, 'skills'>, string> = {
  summary: 'summaries',
  experience: 'experience',
  education: 'education',
  projects: 'projects',
  certifications: 'certifications',
  awards: 'awards_and_honors',
  volunteering: 'volunteering_and_leadership',
};

export type RawEntry = Record<string, unknown>;

/** Every section as a flat list of entries (skills: one entry per category). */
export type InventoryView = Record<Section, RawEntry[]>;

const rawEntries = z.array(z.record(z.unknown())).default([]);

/**
 * Tolerant reader. It only mentions the sections the server may expose, so
 * `personal_info` (and anything unknown) is dropped at parse time and can never
 * reach a tool. Strict validation against MasterDBSchema runs separately and is
 * reported as gaps instead of blocking reads.
 */
export const InventoryReadSchema = z.object({
  summaries: rawEntries,
  experience: rawEntries,
  education: rawEntries,
  projects: rawEntries,
  certifications: rawEntries,
  awards_and_honors: rawEntries,
  volunteering_and_leadership: rawEntries,
  skills: z.record(z.unknown()).default({}),
});
