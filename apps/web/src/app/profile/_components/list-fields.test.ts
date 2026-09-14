import { describe, it, expect } from 'vitest';
import { joinCommaList, joinLines, parseCommaList, parseLines } from './list-fields';

describe('parseCommaList', () => {
  it('splits a comma-separated string into trimmed items', () => {
    expect(parseCommaList('TypeScript, Python,Go')).toEqual(['TypeScript', 'Python', 'Go']);
  });

  it('drops empty segments caused by trailing/leading/double commas', () => {
    expect(parseCommaList(', TypeScript,, Python ,')).toEqual(['TypeScript', 'Python']);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseCommaList('')).toEqual([]);
  });

  it('returns an empty array for a whitespace-only string', () => {
    expect(parseCommaList('   ')).toEqual([]);
  });

  it('returns a single-item array when there is no comma', () => {
    expect(parseCommaList('TypeScript')).toEqual(['TypeScript']);
  });
});

describe('joinCommaList', () => {
  it('joins a string list with ", " separators', () => {
    expect(joinCommaList(['TypeScript', 'Python', 'Go'])).toBe('TypeScript, Python, Go');
  });

  it('returns an empty string for an empty array', () => {
    expect(joinCommaList([])).toBe('');
  });

  it('returns the bare item for a single-item array', () => {
    expect(joinCommaList(['TypeScript'])).toBe('TypeScript');
  });
});

describe('parseLines', () => {
  it('splits a newline-separated string into trimmed lines', () => {
    expect(parseLines('Led migration\nCut latency by 40%')).toEqual([
      'Led migration',
      'Cut latency by 40%',
    ]);
  });

  it('drops blank lines caused by trailing/leading/double newlines', () => {
    expect(parseLines('\nLed migration\n\nCut latency\n')).toEqual(['Led migration', 'Cut latency']);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseLines('')).toEqual([]);
  });

  it('returns a single-item array when there is no newline', () => {
    expect(parseLines('Led migration')).toEqual(['Led migration']);
  });

  it('keeps commas inside a single line intact instead of splitting on them', () => {
    expect(parseLines('Saved $1,000 in cloud spend\nOnboarded 3,200 users')).toEqual([
      'Saved $1,000 in cloud spend',
      'Onboarded 3,200 users',
    ]);
  });
});

describe('joinLines', () => {
  it('joins a string list with newline separators', () => {
    expect(joinLines(['Led migration', 'Cut latency by 40%'])).toBe(
      'Led migration\nCut latency by 40%',
    );
  });

  it('returns an empty string for an empty array', () => {
    expect(joinLines([])).toBe('');
  });
});

describe('parseLines / joinLines round trip', () => {
  it('preserves an item containing a comma through a full parse -> join -> parse cycle', () => {
    const original = ['Saved $1,000 in cloud spend', 'Onboarded 3,200 users'];
    const joined = joinLines(original);
    expect(parseLines(joined)).toEqual(original);
  });
});

describe('parseCommaList / joinCommaList round trip', () => {
  it('preserves a plain tag list through a full parse -> join -> parse cycle', () => {
    const original = ['TypeScript', 'Python', 'Go'];
    expect(parseCommaList(joinCommaList(original))).toEqual(original);
  });
});
