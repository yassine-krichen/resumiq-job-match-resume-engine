import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { isInside } from '../services/run-layout';

/** The PDF a draft points at, resolved against outreach/ and refused if it escapes that folder or is missing. */
export function resolveResumePath(root: string, relativePath: string): string {
  const absolute = resolve(root, relativePath);
  if (!isInside(root, absolute)) throw new Error(`Resume path is outside the outreach folder: ${relativePath}`);
  if (!existsSync(absolute)) throw new Error(`Resume file not found: ${relativePath}`);
  return absolute;
}

export async function readResumeFile(root: string, relativePath: string): Promise<Buffer> {
  return readFile(resolveResumePath(root, relativePath));
}
