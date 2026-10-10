import { loadExampleInventory, FakeRenderer, writerTailoring } from '../testing/test-env';
import type { OutreachTailoring } from '../schemas/outreach';

import { ResumeRenderError, ResumeTooLongError, bulletsToRemove, renderTailoring } from './resume.service';

describe('bulletsToRemove', () => {
  it.each([
    [1, 1],
    [24, 1],
    [25, 2],
    [120, 5],
  ])('asks to remove ceil(%d pt / 24) bullets: %d', (points, expected) => {
    expect(bulletsToRemove(points)).toBe(expected);
  });

  it('asks for at least two when the overflow could not be measured', () => {
    expect(bulletsToRemove(undefined)).toBe(2);
  });
});

describe('renderTailoring', () => {
  const db = loadExampleInventory();
  const tailoring = writerTailoring() as OutreachTailoring;

  it('throws ResumeTooLongError with the page count and a precise instruction for a two-page resume', async () => {
    const error = await renderTailoring(tailoring, db, new FakeRenderer({ pageCount: 2, overflowPoints: 60 })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResumeTooLongError);
    expect(error).toBeInstanceOf(ResumeRenderError);
    expect((error as ResumeTooLongError).message).toBe('resume is 2 pages, expected 1');
    expect((error as ResumeTooLongError).advice).toBe(
      'resume is 2 pages: about 5 lines spill onto page 2; remove at least 3 bullets or one whole entry, and keep every bullet to one line',
    );
  });

  it('gives a generic instruction when the overflow was not measured', async () => {
    const error = (await renderTailoring(tailoring, db, new FakeRenderer({ pageCount: 2 })).catch((e: unknown) => e)) as ResumeTooLongError;

    expect(error.advice).toBe('resume is 2 pages: remove at least 2 bullets or one whole entry, and keep every bullet to one line');
  });

  it('keeps a plain ResumeRenderError for other failures', async () => {
    const error = await renderTailoring(tailoring, db, new FakeRenderer({ fail: 'tectonic missing' })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResumeRenderError);
    expect(error).not.toBeInstanceOf(ResumeTooLongError);
  });
});
