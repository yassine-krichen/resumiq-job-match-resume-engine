import { join, resolve } from 'node:path';

/**
 * The outreach/ folder. Resolved from this file so it is the same under
 * ts-node (src/config) and the compiled build (dist/config), and never
 * depends on the shell's working directory.
 */
export function outreachRoot(): string {
  return resolve(__dirname, '..', '..');
}

export interface OutreachPaths {
  root: string;
  runsDir: string;
  storageDir: string;
}

export function outreachPaths(root: string = outreachRoot()): OutreachPaths {
  return { root, runsDir: join(root, 'runs'), storageDir: join(root, 'storage') };
}
