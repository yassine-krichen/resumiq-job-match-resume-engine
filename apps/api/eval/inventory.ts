import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

import type { MasterDB } from '@resumiq/ai-bridge';
import { MasterDBSchema } from '@resumiq/schemas';

import { PATHS } from './config';

export interface LoadedInventory {
  db: MasterDB;
  rawSha256: string;
  redactedSha256: string;
  normalizations: string[];
}

/**
 * Loads the owner's real career data and prepares it for the eval:
 * - phone and email are replaced before anything is sent to a third-party
 *   model (they cannot influence bullet grounding);
 * - projects that lack startDate/endDate get '' because MasterDBSchema
 *   requires the keys (the inventory file predates that requirement).
 */
export function loadInventory(): LoadedInventory {
  const rawText = fs.readFileSync(PATHS.inventory, 'utf8').replace(/^﻿/, '');
  const rawSha256 = crypto.createHash('sha256').update(rawText).digest('hex');
  const raw = JSON.parse(rawText) as Record<string, unknown>;
  const normalizations: string[] = [];

  const personal = raw.personal_info as Record<string, unknown>;
  personal.phone = '';
  personal.email = 'redacted@example.com';
  normalizations.push('personal_info.phone and email redacted before any LLM call');

  const projects = raw.projects as Array<Record<string, unknown>>;
  let filled = 0;
  for (const p of projects) {
    for (const k of ['startDate', 'endDate']) {
      if (p[k] === undefined) {
        p[k] = '';
        filled++;
      }
    }
  }
  if (filled > 0) normalizations.push(`${filled} missing project startDate/endDate set to ''`);

  const db = MasterDBSchema.parse(raw) as MasterDB;
  const redactedSha256 = crypto.createHash('sha256').update(JSON.stringify(db)).digest('hex');
  return { db, rawSha256, redactedSha256, normalizations };
}
