import { typ } from './escape';

describe('typ', () => {
  it('returns an empty string for undefined, null, and empty-string input', () => {
    expect(typ(undefined)).toBe('');
    expect(typ(null)).toBe('');
    expect(typ('')).toBe('');
  });

  it('leaves plain text without Typst-special characters untouched', () => {
    expect(typ('Senior Software Engineer')).toBe('Senior Software Engineer');
  });

  it.each([
    ['#', '\\#'],
    ['*', '\\*'],
    ['_', '\\_'],
    ['`', '\\`'],
    ['[', '\\['],
    [']', '\\]'],
    ['<', '\\<'],
    ['@', '\\@'],
    ['$', '\\$'],
  ])('escapes the Typst special character %p', (char, escaped) => {
    expect(typ(`a${char}b`)).toBe(`a${escaped}b`);
  });

  it('escapes a literal backslash first so subsequently-inserted escape backslashes are not re-escaped', () => {
    // A single backslash followed by a hash: the backslash must become \\
    // and the # must become \# — not \\\# (double-escaped).
    expect(typ('C:\\path#tag')).toBe('C:\\\\path\\#tag');
  });

  it('escapes every special character in a string containing several of them', () => {
    expect(typ('Achieved $50k* savings via #automation [see_details]')).toBe(
      'Achieved \\$50k\\* savings via \\#automation \\[see\\_details\\]',
    );
  });
});
