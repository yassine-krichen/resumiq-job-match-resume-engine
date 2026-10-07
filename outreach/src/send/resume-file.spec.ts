import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readResumeFile, resolveResumePath } from './resume-file';

describe('resume file', () => {
  const parent = mkdtempSync(join(tmpdir(), 'resume-file-'));
  const root = join(parent, 'outreach');
  mkdirSync(join(root, 'storage', 'tracks'), { recursive: true });
  writeFileSync(join(root, 'storage', 'tracks', 'ai.pdf'), '%PDF-fake');

  it('resolves a stored relative path against the outreach folder', async () => {
    expect(resolveResumePath(root, 'storage/tracks/ai.pdf')).toBe(join(root, 'storage', 'tracks', 'ai.pdf'));
    expect((await readResumeFile(root, 'storage/tracks/ai.pdf')).toString()).toBe('%PDF-fake');
  });

  it('refuses a path that escapes the folder, even when the file exists', () => {
    writeFileSync(join(parent, 'outside-resume.pdf'), '%PDF');
    expect(() => resolveResumePath(root, '../outside-resume.pdf')).toThrow(/outside the outreach folder/);
  });

  it('reports a missing file by its stored path', () => {
    expect(() => resolveResumePath(root, 'storage/tracks/none.pdf')).toThrow(/not found: storage\/tracks\/none\.pdf/);
  });
});
