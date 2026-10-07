import { dedupeRows } from './dedupe';
import { normalizeRows } from './normalize-input';

function rows(...entries: Array<[string, string, string?]>) {
  return normalizeRows(entries.map(([company, email, website]) => ({ company, email, website }))).valid;
}

describe('dedupeRows', () => {
  it('keeps the first row per domain regardless of case, www and the local part', () => {
    const { kept, dropped } = dedupeRows(
      rows(['Acme', 'a@acme.com'], ['Acme Again', 'B@ACME.com'], ['Acme Web', 'c@gmail.com', 'https://www.acme.com']),
    );

    expect(kept.map((row) => row.company)).toEqual(['Acme']);
    expect(dropped.map((entry) => entry.reason)).toEqual(['duplicate_in_list', 'duplicate_in_list']);
  });

  it('drops companies that are already in the database', () => {
    const { kept, dropped } = dedupeRows(rows(['Acme', 'a@acme.com'], ['Beta', 'b@beta.com']), {
      existingDomainKeys: new Set(['acme.com']),
    });

    expect(kept.map((row) => row.company)).toEqual(['Beta']);
    expect(dropped[0].reason).toBe('already_in_database');
  });

  it('reports a suppressed address as suppressed even when the company is also already known', () => {
    const { dropped } = dedupeRows(rows(['Acme', 'stop@acme.com']), {
      existingDomainKeys: new Set(['acme.com']),
      suppressedEmails: new Set(['stop@acme.com']),
    });

    expect(dropped[0].reason).toBe('suppressed_email');
  });

  it('drops every address on a suppressed domain', () => {
    const { kept, dropped } = dedupeRows(rows(['Acme', 'a@acme.com'], ['Beta', 'b@beta.com']), {
      suppressedDomains: new Set(['acme.com']),
    });

    expect(kept.map((row) => row.company)).toEqual(['Beta']);
    expect(dropped[0].reason).toBe('suppressed_domain');
  });

  it('does not merge two unrelated free-mail addresses', () => {
    const { kept } = dedupeRows(rows(['Solo One', 'one@gmail.com'], ['Solo Two', 'two@gmail.com']));

    expect(kept).toHaveLength(2);
  });

  it('lowercases the suppression and database inputs itself', () => {
    const { dropped } = dedupeRows(rows(['Acme', 'stop@acme.com'], ['Beta', 'b@beta.com'], ['Gamma', 'c@gamma.com']), {
      suppressedEmails: new Set(['STOP@Acme.com']),
      suppressedDomains: ['BETA.com'],
      existingDomainKeys: new Set(['Gamma.COM']),
    });

    expect(dropped.map((entry) => entry.reason)).toEqual(['suppressed_email', 'suppressed_domain', 'already_in_database']);
  });

  it('blocks subdomains of a suppressed domain but not look-alike domains', () => {
    const { kept, dropped } = dedupeRows(rows(['Sub', 'a@cs.acme.com'], ['Lookalike', 'b@notacme.com']), {
      suppressedDomains: new Set(['acme.com']),
    });

    expect(dropped.map((entry) => entry.row.company)).toEqual(['Sub']);
    expect(kept.map((row) => row.company)).toEqual(['Lookalike']);
  });
});
