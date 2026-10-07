import { contactConfidence, pageQuoteConfidence, quoteContainsEmail, registrableDomain } from './sourced-contact';

describe('contactConfidence', () => {
  it('trusts an address read on a page', () => {
    expect(contactConfidence('page_quote')).toBe('normal');
  });

  it('always flags a guessed address as low confidence', () => {
    expect(contactConfidence('pattern_guess')).toBe('low');
  });

  it('trusts a confident Hunter address and flags a shaky or unscored one', () => {
    expect(contactConfidence('hunter', 92)).toBe('normal');
    expect(contactConfidence('hunter', 80)).toBe('normal');
    expect(contactConfidence('hunter', 79)).toBe('low');
    expect(contactConfidence('hunter', null)).toBe('low');
    expect(contactConfidence('hunter')).toBe('low');
  });
});

describe('quoteContainsEmail', () => {
  it('finds the address in a quote regardless of case and typographic variants', () => {
    expect(quoteContainsEmail('Write to us at Jobs@Acme.fr – we reply fast', 'jobs@acme.fr')).toBe(true);
  });

  it('finds the address when a word follows it', () => {
    expect(quoteContainsEmail('Write to jobs@acme.fr and we will answer', 'jobs@acme.fr')).toBe(true);
  });

  it('finds the address at the end of a sentence', () => {
    expect(quoteContainsEmail('Our contact is jobs@acme.fr.', 'jobs@acme.fr')).toBe(true);
  });

  it('does not accept an address that is only the tail of a longer one', () => {
    expect(quoteContainsEmail('Ask ceo-jobs@acme.fr today', 'jobs@acme.fr')).toBe(false);
    expect(quoteContainsEmail('Ask jobs@acme.fr.uk today', 'jobs@acme.fr')).toBe(false);
    expect(quoteContainsEmail('Ask jobs@acme.fra today', 'jobs@acme.fr')).toBe(false);
  });

  it('rejects a quote without the address', () => {
    expect(quoteContainsEmail('Write to us on our contact page for details', 'jobs@acme.fr')).toBe(false);
  });
});

describe('registrableDomain', () => {
  it.each([
    ['acme.fr', 'acme.fr'],
    ['www.acme.fr', 'acme.fr'],
    ['careers.eu.acme.com', 'acme.com'],
    ['ACME.Example.', 'acme.example'],
    ['acme.co.uk', 'acme.co.uk'],
    ['team.acme.co.uk', 'acme.co.uk'],
    ['acme.com.tn', 'acme.com.tn'],
    ['localhost', 'localhost'],
  ])('maps %s to %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });
});

describe('pageQuoteConfidence', () => {
  const base = { email: 'claire@acme.fr', pageUrls: ['https://www.acme.fr/careers'], website: 'https://acme.fr' };

  it('trusts an address quoted from a page of its own domain', () => {
    expect(pageQuoteConfidence(base)).toBe('normal');
    expect(pageQuoteConfidence({ ...base, pageUrls: ['https://jobs.acme.fr/team'], website: undefined })).toBe('normal');
  });

  it('trusts an address quoted from a page of the website the candidate names', () => {
    expect(pageQuoteConfidence({ email: 'claire@mail-acme.io', pageUrls: ['https://acme.fr/team'], website: 'https://www.acme.fr' })).toBe('normal');
  });

  it('downgrades an address read on a third-party page (a directory, a forum)', () => {
    expect(pageQuoteConfidence({ ...base, pageUrls: ['https://directory.example/companies/acme'] })).toBe('low');
  });

  it('accepts either the requested or the final URL of the page', () => {
    expect(pageQuoteConfidence({ ...base, pageUrls: ['https://short.example/x', 'https://acme.fr/team'] })).toBe('normal');
  });

  it('downgrades when the page URL is not readable', () => {
    expect(pageQuoteConfidence({ ...base, pageUrls: ['not a url'] })).toBe('low');
  });
});
