import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import type { TailoringLimits } from '../core/bullet-guard';
import { DEFAULT_PRICING, PricingSchema } from '../cost/pricing';
import type { Pricing } from '../cost/pricing';
import { OutreachConfigSchema, OutreachTrackSchema, TimezoneSchema } from '../schemas/outreach';
import type { OutreachConfig, OutreachTrack } from '../schemas/outreach';

const shortList = (max: number) => z.array(z.string().trim().min(1).max(100)).max(max);

// Track resumes are built without an LLM: these rules pick the entries and
// skills by keyword hits in the candidate's own data_inventory.
export const TrackRulesSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    // Written by the candidate; only technologies the profile really lists may appear (bullet-guard checks it).
    summary: z.string().trim().min(20).max(500),
    // Matched as whole words, case-insensitive, against an entry's name, technologies, context and achievements.
    keywords: shortList(60).refine((list) => list.length > 0, 'needs at least one keyword'),
    max_experiences: z.number().int().min(0).max(3).default(1),
    max_projects: z.number().int().min(1).max(4).default(3),
    bullets_per_entry: z.number().int().min(1).max(3).default(3),
    skills_per_category: z.number().int().min(3).max(12).default(8),
    // Project named in the generic email of this track; defaults to the best-scoring project.
    proof_project: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((rules, ctx) => {
    const total = rules.max_experiences + rules.max_projects;
    if (total < 2 || total > 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_projects'],
        message: 'max_experiences + max_projects must be 2-4 (a tailoring holds 2-4 entries)',
      });
    }
  });

// How much a tailored resume may hold so it still fits one page. The schema's own bounds (4 entries, 4/3 bullets)
// are the hard ceiling; a candidate with education and certifications needs tighter ones. The writer gets these
// in candidate.json and the guard rejects a tailoring over them.
export const TailoringLimitsSchema = z
  .object({
    max_entries: z.number().int().min(2).max(4).default(3),
    max_bullets_experience: z.number().int().min(1).max(4).default(3),
    max_bullets_project: z.number().int().min(1).max(3).default(2),
    max_skills_per_category: z.number().int().min(3).max(12).default(6),
  })
  .default({});

const ExtrasSchema = z.object({
  // Relative paths resolve against the folder holding the config file.
  data_inventory_path: z.string().trim().min(1),
  tracks: z.object({ ai: TrackRulesSchema, swe: TrackRulesSchema, fullstack: TrackRulesSchema }),
  // Used by the generic email when neither research nor the domain gives a timezone.
  fallback_timezone: TimezoneSchema.default('America/New_York'),
  // Writer retries allowed per company before the generic fallback (SPEC diagram: max 2 retries).
  draft_retry_limit: z.number().int().min(0).max(5).default(2),
  tailoring_limits: TailoringLimitsSchema,
  // Price per model id prefix (USD per MTok); see src/cost/pricing.ts. `pricing_source` is a free-text note.
  pricing: PricingSchema.default(DEFAULT_PRICING),
  pricing_source: z.string().trim().max(400).optional(),
  // The /outreach command stops starting research/write waves once the run's API-equivalent cost passes this.
  run_budget_usd: z.number().positive().max(10_000).optional(),
});

export type TrackRules = z.infer<typeof TrackRulesSchema>;

export interface AppConfig {
  outreach: OutreachConfig;
  tracks: Record<OutreachTrack, TrackRules>;
  /** Absolute path of the candidate's data_inventory.json. */
  dataInventoryPath: string;
  fallbackTimezone: string;
  draftRetryLimit: number;
  tailoringLimits: TailoringLimits;
  pricing: Pricing;
  pricingSource?: string;
  /** Soft per-run spend limit in API-equivalent USD; absent means no limit. */
  runBudgetUsd?: number;
}

export class ConfigError extends Error {}

function issues(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join('.') || 'config'}: ${issue.message}`).join('\n');
}

/**
 * Parses the config text. Throws ConfigError listing every invalid field, so
 * a bad config fails at startup instead of mid-run.
 */
export function parseAppConfig(text: string, configDir: string): AppConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Config is not valid JSON: ${(error as Error).message}`);
  }
  const outreach = OutreachConfigSchema.safeParse(raw);
  const extras = ExtrasSchema.safeParse(raw);
  if (!outreach.success || !extras.success) {
    const lines = [
      ...(outreach.success ? [] : [issues(outreach.error)]),
      ...(extras.success ? [] : [issues(extras.error)]),
    ];
    throw new ConfigError(`Invalid config:\n${lines.join('\n')}`);
  }
  return {
    outreach: outreach.data,
    tracks: extras.data.tracks,
    dataInventoryPath: resolve(configDir, extras.data.data_inventory_path),
    fallbackTimezone: extras.data.fallback_timezone,
    draftRetryLimit: extras.data.draft_retry_limit,
    tailoringLimits: {
      maxEntries: extras.data.tailoring_limits.max_entries,
      maxBulletsExperience: extras.data.tailoring_limits.max_bullets_experience,
      maxBulletsProject: extras.data.tailoring_limits.max_bullets_project,
      maxSkillsPerCategory: extras.data.tailoring_limits.max_skills_per_category,
    },
    pricing: extras.data.pricing,
    ...(extras.data.pricing_source === undefined ? {} : { pricingSource: extras.data.pricing_source }),
    ...(extras.data.run_budget_usd === undefined ? {} : { runBudgetUsd: extras.data.run_budget_usd }),
  };
}

/** Reads and validates the config file; relative paths inside it resolve against its folder. */
export function loadAppConfig(configPath: string, root: string): AppConfig {
  const absolute = resolve(root, configPath);
  let text: string;
  try {
    text = readFileSync(absolute, 'utf-8');
  } catch {
    throw new ConfigError(
      `Config file not found: ${absolute}. Copy outreach.config.example.json to outreach.config.json and edit it.`,
    );
  }
  return parseAppConfig(text, dirname(absolute));
}

export const TRACKS: readonly OutreachTrack[] = OutreachTrackSchema.options;
