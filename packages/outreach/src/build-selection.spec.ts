import type { OutreachTailoring } from '@resumiq/schemas';

import { masterDb } from './__fixtures__/outreach-fixtures';
import { buildSelection } from './build-selection';

const tailoring: OutreachTailoring = {
  summary: 'Full-stack engineer who ships reliable internal tools.',
  entries: [
    {
      kind: 'experience',
      name: 'orange tunisie',
      bullets: [{ text: 'Built an internal dashboard in Java for field operations.', source_entry: 'Orange Tunisie' }],
    },
    {
      kind: 'project',
      name: 'TickIT',
      bullets: [{ text: 'Replaced a manual workflow for a 40-person team.', source_entry: 'TickIT' }],
    },
  ],
  skills: {
    programming_languages: ['TypeScript', 'Java'],
    frameworks_and_libraries: ['Spring Boot'],
    infrastructure_and_tools: ['Docker'],
    databases: ['PostgreSQL'],
  },
};

describe('buildSelection', () => {
  it('maps the tailoring into the AISelection shape the renderer takes', () => {
    const selection = buildSelection(tailoring, masterDb);

    expect(selection.summary).toBe(tailoring.summary);
    expect(selection.experience).toEqual([
      {
        company: 'Orange Tunisie',
        role: 'Software Engineering Intern',
        bullets: ['Built an internal dashboard in Java for field operations.'],
      },
    ]);
    expect(selection.projects).toEqual([
      { name: 'TickIT', bullets: ['Replaced a manual workflow for a 40-person team.'] },
    ]);
    expect(selection.skills).toEqual({
      languages: ['TypeScript', 'Java'],
      frameworks_and_libraries: ['Spring Boot'],
      infrastructure_and_tools: ['Docker'],
      databases: ['PostgreSQL'],
    });
    expect(selection.certifications).toEqual([]);
    expect(selection.awards).toEqual([]);
  });

  it('resolves names to the data_inventory spelling so the renderer finds them', () => {
    const selection = buildSelection(tailoring, masterDb);

    expect(selection.experience[0].company).toBe('Orange Tunisie');
  });

  it('orders sections by what the writer listed first, then skills', () => {
    const experienceFirst = buildSelection(tailoring, masterDb);
    const projectFirst = buildSelection({ ...tailoring, entries: [...tailoring.entries].reverse() }, masterDb);

    expect(experienceFirst.section_order).toEqual(['experience', 'projects', 'skills']);
    expect(projectFirst.section_order).toEqual(['projects', 'experience', 'skills']);
  });

  it('throws on an entry name that is not in data_inventory instead of letting the renderer skip it', () => {
    const unknown: OutreachTailoring = {
      ...tailoring,
      entries: [{ ...tailoring.entries[1], name: 'Imaginary Project' }, tailoring.entries[0]],
    };

    expect(() => buildSelection(unknown, masterDb)).toThrow(/Imaginary Project/);
  });

  it('does not match an entry by substring (the renderer fuzzy-matches, this must not)', () => {
    const partial: OutreachTailoring = { ...tailoring, entries: [{ ...tailoring.entries[1], name: 'Tick' }, tailoring.entries[0]] };

    expect(() => buildSelection(partial, masterDb)).toThrow(/Tick/);
  });
});
