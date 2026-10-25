import { isAbsolute, resolve } from 'path';

import { z } from 'zod';

import { sanitizeMessage } from './sanitize';

/** Repo root, whether this runs from src/ (ts-jest) or dist/ (node). */
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const EnvSchema = z.object({
  RESUMIQ_INVENTORY_PATH: z
    .string()
    .trim()
    .min(1, 'must not be empty')
    .max(1000, 'is too long')
    .refine((p) => p.toLowerCase().endsWith('.json'), 'must point to a .json file')
    .optional(),
});

export interface Config {
  /** Absolute path of the career inventory JSON. */
  inventoryPath: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Validates the environment once at startup; fails fast with a sanitized message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse({ RESUMIQ_INVENTORY_PATH: env.RESUMIQ_INVENTORY_PATH });
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
    throw new ConfigError(sanitizeMessage(`Invalid configuration: ${detail}`, env));
  }
  const configured = parsed.data.RESUMIQ_INVENTORY_PATH;
  const inventoryPath = configured
    ? isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured)
    : resolve(REPO_ROOT, 'data_inventory.json');
  return { inventoryPath };
}
