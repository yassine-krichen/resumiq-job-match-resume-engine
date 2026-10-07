import { readFileSync } from 'node:fs';

import { MasterDBSchema } from './master-db';
import type { MasterDB } from './master-db';

export class InventoryError extends Error {}

/** Reads and validates the candidate's data_inventory.json. Fails with every invalid path listed. */
export function loadDataInventory(path: string): MasterDB {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''));
  } catch (error) {
    throw new InventoryError(`Cannot read data inventory at ${path}: ${(error as Error).message}`);
  }
  const parsed = MasterDBSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.slice(0, 20).map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new InventoryError(`Data inventory ${path} does not match the schema:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
