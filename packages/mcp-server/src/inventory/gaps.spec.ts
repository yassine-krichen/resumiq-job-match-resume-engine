import { loadSnapshot, validInventory } from '../test-support/fixture';

import { findGaps } from './gaps';

function gapsOf(data: unknown, section?: Parameters<typeof findGaps>[3]) {
  const { view, schemaIssues, readWarnings } = loadSnapshot(data);
  return findGaps(view, schemaIssues, readWarnings, section);
}

describe('findGaps', () => {
  it('reports no gaps for a valid fixture', () => {
    expect(gapsOf(validInventory())).toEqual([]);
  });

  it('reports empty raw_achievements with the path of the entry', () => {
    const data = validInventory();
    (data.projects as Record<string, unknown>[])[1].raw_achievements = [];

    const gaps = gapsOf(data);

    expect(gaps).toEqual([expect.objectContaining({ path: 'projects[1].raw_achievements' })]);
    expect(gaps[0].message).toContain('Notes App');
  });

  it('reports empty technologies_used and missing quantifiable_metrics', () => {
    const data = validInventory();
    const experience = (data.experience as Record<string, unknown>[])[0];
    experience.technologies_used = [];
    experience.quantifiable_metrics = [];

    expect(gapsOf(data).map((g) => g.path)).toEqual([
      'experience[0].technologies_used',
      'experience[0].quantifiable_metrics',
    ]);
  });

  it('reports a project without sources', () => {
    const data = validInventory();
    delete (data.projects as Record<string, unknown>[])[0].sources;

    expect(gapsOf(data).map((g) => g.path)).toEqual(['projects[0].sources']);
  });

  it('reports an invalid date', () => {
    const data = validInventory();
    (data.experience as Record<string, unknown>[])[0].startDate = '03/2024';

    expect(gapsOf(data)).toEqual([
      expect.objectContaining({ path: 'experience[0].startDate', message: expect.stringContaining('invalid format') }),
    ]);
  });

  it('reports schema failures as gaps without echoing personal_info values', () => {
    const data = validInventory();
    (data.personal_info as Record<string, unknown>).email = 'not-an-email';
    delete (data.projects as Record<string, unknown>[])[0].startDate;

    const gaps = gapsOf(data);

    expect(gaps.map((g) => g.path)).toEqual(expect.arrayContaining(['personal_info.email', 'projects[0].startDate']));
    expect(JSON.stringify(gaps)).not.toContain('not-an-email');
  });

  it('limits results to one section when asked', () => {
    const data = validInventory();
    (data.projects as Record<string, unknown>[])[0].raw_achievements = [];
    (data.experience as Record<string, unknown>[])[0].technologies_used = [];

    expect(gapsOf(data, 'projects').map((g) => g.path)).toEqual(['projects[0].raw_achievements']);
  });

  it('flags a skills list that is a string split into characters', () => {
    const data = validInventory();
    (data.skills as Record<string, unknown>).note = [...'Some prose note'];

    expect(gapsOf(data).map((g) => g.path)).toContain('skills.note');
  });
});
