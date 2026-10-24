import { normalizeText, phraseMatches, techKey } from './normalize';

describe('normalizeText', () => {
  it('lowercases, strips diacritics and punctuation, and collapses whitespace', () => {
    expect(normalizeText('  Adéquia,  S.A. ')).toBe('adequia s a');
    expect(normalizeText('R&D')).toBe('r and d');
  });
});

describe('techKey', () => {
  it.each([
    ['Node.js', 'node'],
    ['nodejs', 'node'],
    ['React.js', 'react'],
    ['React 19', 'react'],
    ['Next.js 16', 'next'],
    ['Postgres', 'postgresql'],
    ['PostgreSQL', 'postgresql'],
    ['K8s', 'kubernetes'],
    ['TypeScript', 'typescript'],
    ['C++', 'c++'],
    ['WebSocket (STOMP)', 'websocket'],
  ])('maps %s to %s', (name, key) => {
    expect(techKey(name)).toBe(key);
  });
});

describe('phraseMatches', () => {
  it('matches case, punctuation and whitespace variants', () => {
    expect(phraseMatches('Sofrecom  Tunisie', 'sofrecom tunisie')).toBe(true);
  });

  it('matches when one phrase contains the other as whole words', () => {
    expect(phraseMatches('Freelance', 'Freelance (partnership with Khalid)')).toBe(true);
    expect(phraseMatches('Arabic (Native)', 'Arabic')).toBe(true);
  });

  it('does not match partial words or unrelated phrases', () => {
    expect(phraseMatches('Sofrecom', 'Sofrecomm Tunisie')).toBe(false);
    expect(phraseMatches('Globex Corporation', 'ST2i')).toBe(false);
  });

  it('does not match very short strings by containment', () => {
    expect(phraseMatches('ai', 'AI Engineer Intern')).toBe(false);
  });

  it('never matches empty input', () => {
    expect(phraseMatches('', 'anything')).toBe(false);
  });
});
