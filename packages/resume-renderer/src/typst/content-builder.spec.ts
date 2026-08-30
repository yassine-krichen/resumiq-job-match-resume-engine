import { buildTypstDocument } from './content-builder';
import type { AISelection, MasterDB } from '@resumiq/ai-bridge';

function baseDB(overrides: Partial<MasterDB> = {}): MasterDB {
  return {
    personal_info: {
      name: 'Jane Doe',
      location: 'Remote',
      phone: '555-0100',
      email: 'jane@example.com',
      work_authorization: [],
      clearances: [],
      links: [],
    },
    summaries: [],
    experience: [],
    education: [],
    projects: [],
    skills: {
      programming_languages: [],
      frameworks_and_libraries: [],
      infrastructure_and_tools: [],
      databases: [],
      spoken_languages: [],
      soft_skills: [],
    },
    certifications: [],
    awards_and_honors: [],
    publications_and_speaking: [],
    volunteering_and_leadership: [],
    interests: [],
    ...overrides,
  };
}

function baseSelection(overrides: Partial<AISelection> = {}): AISelection {
  return {
    reasoning: 'test',
    section_order: ['experience'],
    experience: [],
    projects: [],
    skills: { languages: [], frameworks_and_libraries: [], infrastructure_and_tools: [], databases: [] },
    certifications: [],
    awards: [],
    ...overrides,
  };
}

describe('buildTypstDocument', () => {
  it('throws when the skeleton is missing the %%CONTENT%% placeholder', () => {
    expect(() => buildTypstDocument(baseSelection(), baseDB(), 'no placeholder here')).toThrow(
      'Typst skeleton missing %%CONTENT%% placeholder',
    );
  });

  it('injects generated content into the %%CONTENT%% slot while preserving the rest of the skeleton', () => {
    const skeleton = 'HEADER\n%%CONTENT%%\nFOOTER';

    const doc = buildTypstDocument(baseSelection(), baseDB(), skeleton);

    expect(doc.startsWith('HEADER\n')).toBe(true);
    expect(doc.endsWith('\nFOOTER')).toBe(true);
  });

  it('always renders an Education section even when section_order omits it', () => {
    const db = baseDB({
      education: [
        {
          institution: 'MIT',
          degree_type: 'BSc',
          major: 'CS',
          minor: '',
          location: '',
          startDate: 'Sep 2016',
          endDate: 'Jun 2020',
          gpa: '',
          honors: [],
          relevant_coursework: [],
          thesis_or_capstone: '',
          extracurriculars: [],
          description: '',
        },
      ],
    });
    const selection = baseSelection({ section_order: ['skills'] });

    const doc = buildTypstDocument(selection, db, 'X%%CONTENT%%X');

    expect(doc).toContain('Education');
    expect(doc).toContain('MIT');
  });

  it('escapes Typst-special characters appearing in resume bullet text', () => {
    const db = baseDB({
      experience: [
        {
          company: 'Acme Corp',
          company_industry: '',
          role: 'Engineer',
          location: '',
          location_type: '',
          startDate: 'Jan 2020',
          endDate: 'Jan 2022',
          isCurrent: false,
          core_competencies: [],
          technologies_used: [],
          raw_achievements: [],
          quantifiable_metrics: [],
        },
      ],
    });
    const selection = baseSelection({
      section_order: ['experience'],
      experience: [
        { company: 'Acme Corp', role: 'Engineer', bullets: ['Improved throughput using #caching and *indexing*'] },
      ],
    });

    const doc = buildTypstDocument(selection, db, '%%CONTENT%%');

    expect(doc).toContain('\\#caching');
    expect(doc).toContain('\\*indexing\\*');
    // The raw, unescaped bullet text must not appear verbatim.
    expect(doc).not.toContain('using #caching and *indexing*');
  });

  it('escapes a double quote in a personal-info link URL so it cannot break out of the Typst string literal', () => {
    const db = baseDB({
      personal_info: {
        name: 'Jane Doe',
        location: 'Remote',
        phone: '555-0100',
        email: 'jane@example.com',
        work_authorization: [],
        clearances: [],
        links: [{ platform: 'Portfolio', url: 'https://evil.example/")[#malicious content]#link("https://x' }],
      },
    });

    const doc = buildTypstDocument(baseSelection(), db, '%%CONTENT%%');

    // The raw URL must never appear unescaped inside the string literal — the
    // embedded `"` would otherwise close the Typst string early and let the
    // rest of the value be interpreted as markup.
    expect(doc).not.toContain('#link("https://evil.example/")[#malicious content]#link("https://x")');
    expect(doc).toContain('\\"');
  });

  it('escapes a double quote in a project repository link URL', () => {
    const db = baseDB({
      projects: [
        {
          name: 'Cool Project',
          context: '',
          startDate: 'Jan 2021',
          endDate: 'Jan 2022',
          technologies_used: [],
          raw_achievements: [],
          quantifiable_metrics: [],
          links: [{ type: 'Repository', url: 'https://evil.example/")[#malicious]' }],
        },
      ],
    });
    const selection = baseSelection({
      section_order: ['projects'],
      projects: [{ name: 'Cool Project', bullets: ['Built things'] }],
    });

    const doc = buildTypstDocument(selection, db, '%%CONTENT%%');

    expect(doc).not.toContain('#link("https://evil.example/")[#malicious]")');
    expect(doc).toContain('\\"');
  });

  it('silently skips an AI-selected experience entry that has no matching company in the candidate DB', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const db = baseDB({ experience: [] });
    const selection = baseSelection({
      section_order: ['experience'],
      experience: [{ company: 'Ghost Company', role: 'Engineer', bullets: ['Did things'] }],
    });

    const doc = buildTypstDocument(selection, db, '%%CONTENT%%');

    expect(doc).not.toContain('Ghost Company');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
