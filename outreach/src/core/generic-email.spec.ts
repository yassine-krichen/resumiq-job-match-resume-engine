import { loadExampleConfig, loadExampleInventory } from '../testing/test-env';

import { critiqueDraft } from './critic';
import { buildGenericEmail, countryFromDomain, greetingName, languageFromDomain } from './generic-email';
import type { GenericEmailInput } from './generic-email';
import { countWords } from './text-utils';

const config = loadExampleConfig();
const masterDb = loadExampleInventory();

function input(overrides: Partial<GenericEmailInput> = {}): GenericEmailInput {
  return {
    language: 'en',
    companyName: 'Acme Robotics',
    availability: config.outreach.availability.en,
    region: 'europe',
    track: 'ai',
    project: { name: 'DocuAsk', technologies: ['Python', 'FastAPI', 'pgvector', 'Next.js'] },
    ...overrides,
  };
}

function critique(email: ReturnType<typeof buildGenericEmail>, language: 'en' | 'fr', timezone: string) {
  return critiqueDraft({
    draft: { ...email, hook_claim_id: null, anchor_phrase: null, mentioned_projects: ['DocuAsk'], generic: true },
    language,
    companyName: 'Acme Robotics',
    timezone,
    config: config.outreach,
    verifiedClaims: [],
    masterDb,
  });
}

describe('buildGenericEmail', () => {
  it.each([
    ['en', 'europe', 'Europe/Paris'],
    ['en', 'us', 'America/New_York'],
    ['en', 'other', 'Asia/Tokyo'],
    ['fr', 'europe', 'Europe/Paris'],
    ['fr', 'us', 'America/Montreal'],
    ['fr', 'other', 'Africa/Casablanca'],
  ] as const)('passes the critic for %s in the %s overlap region', (language, region, timezone) => {
    const email = buildGenericEmail(
      input({ language, region, availability: config.outreach.availability[language], contactName: 'Claire Martin' }),
    );
    expect(critique(email, language, timezone).failures).toEqual([]);
  });

  it('names the company, the track focus and the project, with the verbatim availability lines', () => {
    const email = buildGenericEmail(input({ track: 'swe' }));
    expect(email.body).toContain('Acme Robotics');
    expect(email.body).toContain('backend and systems engineering');
    expect(email.body).toContain('DocuAsk with Python, FastAPI and pgvector');
    expect(email.body).toContain(config.outreach.availability.en.hours_line);
    expect(email.body).toContain(config.outreach.availability.en.overlap.europe);
  });

  it('puts the call to action in the body exactly once', () => {
    const email = buildGenericEmail(input());
    expect(email.body.split(email.cta)).toHaveLength(2);
  });

  it('adds a short one-liner in parentheses and leaves out a long one', () => {
    const short = buildGenericEmail(input({ oneLiner: 'open-source fleet scheduling.' }));
    expect(short.body).toContain('Acme Robotics (open-source fleet scheduling)');
    const long = buildGenericEmail(input({ oneLiner: Array.from({ length: 30 }, () => 'word').join(' ') }));
    expect(long.body).not.toContain('(word');
  });

  it('keeps the body inside the word band and the follow-up inside its band', () => {
    const email = buildGenericEmail(input());
    expect(countWords(email.body)).toBeGreaterThanOrEqual(50);
    expect(countWords(email.body)).toBeLessThanOrEqual(120);
    expect(countWords(email.follow_up_body)).toBeGreaterThanOrEqual(25);
    expect(countWords(email.follow_up_body)).toBeLessThanOrEqual(70);
  });

  it('falls back to a short subject when the company name makes it too long', () => {
    const email = buildGenericEmail(input({ companyName: 'The International Society of Very Long Company Names' }));
    expect(email.subject.length).toBeLessThanOrEqual(60);
  });

  it('skips a technology that is a bare number so the critic does not see an invented number', () => {
    const email = buildGenericEmail(input({ project: { name: 'DocuAsk', technologies: ['Python 3', 'FastAPI'] } }));
    expect(email.body).toContain('with FastAPI');
    expect(email.body).not.toContain('Python 3');
  });
});

describe('greetingName', () => {
  it('uses the first name and skips titles', () => {
    expect(greetingName('Claire Martin')).toBe('Claire');
    expect(greetingName('Dr. Jean Dupont')).toBe('Jean');
  });

  it('returns null for missing, role-like or odd values', () => {
    expect(greetingName(undefined)).toBeNull();
    expect(greetingName('Recrutement & Talents Team Europe')).toBeNull();
    expect(greetingName('HR/Careers')).toBeNull();
  });
});

describe('country and language from the domain', () => {
  it('reads two-letter country TLDs and maps uk to GB', () => {
    expect(countryFromDomain('acme.fr')).toBe('FR');
    expect(countryFromDomain('acme.co.uk')).toBe('GB');
    expect(countryFromDomain('acme.com')).toBeNull();
    expect(countryFromDomain(null)).toBeNull();
  });

  it('chooses French for .fr and English otherwise', () => {
    expect(languageFromDomain('acme.fr')).toBe('fr');
    expect(languageFromDomain('acme.com')).toBe('en');
    expect(languageFromDomain('acme.de')).toBe('en');
  });
});
