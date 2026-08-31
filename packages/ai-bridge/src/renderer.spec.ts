import { render } from './renderer';
import type { AISelection, MasterDB } from './types';

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

const SKELETON = '%%CONTENT%%';

// Extracts every `\href{ARG}` first-argument string from a rendered document,
// in document order. An href argument is a run of: the atomic `\textbackslash{}`
// macro (a legitimate, balanced brace pair that isn't a simple 2-char escape
// pair), an escaped pair (`\` followed by any character — e.g. `\{`, `\}`,
// `\%`), or any character that isn't a raw brace; that's exactly the shape
// `texUrl()` guarantees its output has, so this mirrors how a real LaTeX
// engine would find the closing `}` of the argument.
function hrefArgs(doc: string): string[] {
  const pattern = /\\href\{((?:\\textbackslash\{\}|\\.|[^{}])*)\}/g;
  return [...doc.matchAll(pattern)].map((m) => m[1]);
}

function dbWithLinkUrl(url: string): MasterDB {
  return baseDB({
    personal_info: {
      name: 'Jane Doe',
      location: 'Remote',
      phone: '555-0100',
      email: 'jane@example.com',
      work_authorization: [],
      clearances: [],
      links: [{ platform: 'Portfolio', url }],
    },
  });
}

describe('render', () => {
  it('throws when the skeleton is missing the %%CONTENT%% placeholder', () => {
    expect(() => render(baseSelection(), baseDB(), 'no placeholder here')).toThrow(
      'skeleton.tex missing %%CONTENT%% placeholder',
    );
  });

  it('escapes a crafted personal-info link URL so it cannot break out of the \\href{} argument', () => {
    const db = baseDB({
      personal_info: {
        name: 'Jane Doe',
        location: 'Remote',
        phone: '555-0100',
        email: 'jane@example.com',
        work_authorization: [],
        clearances: [],
        links: [{ platform: 'Portfolio', url: 'https://evil.example/}{\\input{/etc/passwd}}%comment' }],
      },
    });

    const doc = render(baseSelection(), db, SKELETON);

    // The raw URL must never appear unescaped inside the \href{} argument —
    // unescaped `}`, `{`, and `%` would otherwise close the argument early,
    // start a new group, or comment out the remainder of the line.
    expect(doc).not.toContain('\\href{https://evil.example/}{\\input{/etc/passwd}}%comment}');
    expect(doc).toContain('\\%comment');
    expect(doc).toContain('\\}');
    expect(doc).toContain('\\{');
  });

  it('escapes a crafted email address so it cannot break out of the mailto \\href{} argument', () => {
    const db = baseDB({
      personal_info: {
        name: 'Jane Doe',
        location: 'Remote',
        phone: '555-0100',
        email: 'jane@example.com}{\\textbf{injected}}%',
        work_authorization: [],
        clearances: [],
        links: [],
      },
    });

    const doc = render(baseSelection(), db, SKELETON);

    expect(doc).not.toContain('\\href{mailto:jane@example.com}{\\textbf{injected}}%}');
    expect(doc).toContain('\\%');
  });

  it('escapes a crafted project repository link URL', () => {
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
          links: [{ type: 'Repository', url: 'https://evil.example/}{\\malicious}%' }],
        },
      ],
    });
    const selection = baseSelection({
      section_order: ['projects'],
      projects: [{ name: 'Cool Project', bullets: ['Did stuff'] }],
    });

    const doc = render(selection, db, SKELETON);

    expect(doc).not.toContain('\\href{https://evil.example/}{\\malicious}%}');
    expect(doc).toContain('\\%');
  });

  it('escapes a crafted publication URL', () => {
    const db = baseDB({
      publications_and_speaking: [
        {
          title: 'My Paper',
          venue: 'Conf',
          date: 'Jan 2020',
          url: 'https://evil.example/}{\\malicious}%',
        },
      ],
    });
    const selection = baseSelection({
      section_order: ['publications'],
      publications: ['My Paper'],
    });

    const doc = render(selection, db, SKELETON);

    expect(doc).not.toContain('\\href{https://evil.example/}{\\malicious}%}');
    expect(doc).toContain('\\%');
  });

  it('escapes a summary containing a literal backslash immediately followed by braces via tex(), with no double-escaping', () => {
    const selection = baseSelection({
      section_order: ['experience'],
      summary: 'Shipped \\{evil\\} features on time',
    });

    const doc = render(selection, baseDB(), SKELETON);

    // If tex() re-scanned its own output (double-escaping), the `{`/`}`
    // inserted by escaping `\` into `\textbackslash{}` would themselves get
    // escaped into `\textbackslash\{\}`, corrupting the macro. A single-pass
    // replace must instead escape every original character exactly once, in
    // place, regardless of what any other escape produced.
    expect(doc).toContain(
      'Shipped \\textbackslash{}\\{evil\\textbackslash{}\\} features on time',
    );
  });

  it('renders a normal URL unchanged aside from escaping', () => {
    const db = baseDB({
      personal_info: {
        name: 'Jane Doe',
        location: 'Remote',
        phone: '555-0100',
        email: 'jane@example.com',
        work_authorization: [],
        clearances: [],
        links: [{ platform: 'GitHub', url: 'https://github.com/janedoe' }],
      },
    });

    const doc = render(baseSelection(), db, SKELETON);

    expect(doc).toContain('\\href{https://github.com/janedoe}');
  });

  describe('href argument tokenization safety', () => {
    it('escapes a brace-breakout payload (}, {, %, &, #, _) into an exact, fully-escaped href argument', () => {
      const db = dbWithLinkUrl('https://evil.example/}{injected}%comment&more#frag_score');

      const doc = render(baseSelection(), db, SKELETON);
      const [, linkHrefArg] = hrefArgs(doc);

      // Full string equality — not a substring check — proves every special
      // character in the payload was escaped, in order, with nothing left
      // unescaped and nothing double-escaped.
      expect(linkHrefArg).toBe(
        'https://evil.example/\\}\\{injected\\}\\%comment\\&more\\#frag\\_score',
      );
    });

    it('leaves no unescaped { or } inside the href argument for a payload combining every character texUrl() escapes', () => {
      const db = dbWithLinkUrl('https://evil.example/}{\\input{/etc/passwd}}%c&d#e_f');

      const doc = render(baseSelection(), db, SKELETON);
      const [, linkHrefArg] = hrefArgs(doc);

      // A brace not immediately preceded by a backslash — and not part of the
      // atomic, balanced `\textbackslash{}` macro — would close (or open) the
      // \href{} group early, letting the rest of the payload escape into raw
      // LaTeX. Strip out legitimate `\textbackslash{}` occurrences first so
      // their required, safe braces aren't mistaken for raw ones; this still
      // directly proves brace-balance can't be broken, rather than inferring
      // it from substring presence/absence.
      expect(linkHrefArg.replaceAll('\\textbackslash{}', '')).not.toMatch(
        /(?<!\\)[{}]/,
      );
    });

    it('escapes a literal backslash as \\textbackslash{}, matching tex()\'s convention, not the raw \\\\ line-break token', () => {
      const db = dbWithLinkUrl('https://evil.example/a\\b');

      const doc = render(baseSelection(), db, SKELETON);
      const [, linkHrefArg] = hrefArgs(doc);

      // `\\` on its own is LaTeX's line-break command, not a literal
      // backslash — using it here would corrupt the URL rather than render
      // the character. `\textbackslash{}` is the safe, correct escape.
      expect(linkHrefArg).toBe('https://evil.example/a\\textbackslash{}b');
    });
  });
});
