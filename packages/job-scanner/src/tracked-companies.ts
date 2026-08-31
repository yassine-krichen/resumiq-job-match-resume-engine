import { readFileSync } from 'fs';
import path from 'path';
import type { TrackedCompany } from './types';

const CONFIG_PATH = path.join(__dirname, '../tracked-companies.json');

/** Narrows an unknown parsed-JSON entry down to TrackedCompany, or throws. */
function assertTrackedCompany(value: unknown, index: number): TrackedCompany {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`tracked-companies.json[${index}]: expected an object`);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    throw new Error(`tracked-companies.json[${index}]: "name" must be a non-empty string`);
  }
  if (typeof entry.provider !== 'string' || entry.provider.trim() === '') {
    throw new Error(`tracked-companies.json[${index}]: "provider" must be a non-empty string`);
  }
  if (entry.careers_url !== undefined && typeof entry.careers_url !== 'string') {
    throw new Error(`tracked-companies.json[${index}]: "careers_url" must be a string when present`);
  }
  if (entry.api !== undefined && typeof entry.api !== 'string') {
    throw new Error(`tracked-companies.json[${index}]: "api" must be a string when present`);
  }
  if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
    throw new Error(`tracked-companies.json[${index}]: "enabled" must be a boolean when present`);
  }
  return entry as unknown as TrackedCompany;
}

/**
 * Reads and validates tracked-companies.json. Entries default to enabled;
 * callers that only want active entries should filter on `enabled !== false`.
 */
export function getTrackedCompanies(): TrackedCompany[] {
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('tracked-companies.json must contain a JSON array');
  }
  return parsed.map((entry, index) => assertTrackedCompany(entry, index));
}
